import type { VisionCheck } from '@earshot/shared';
import type { RailEvent } from '../reduce.js';
import { agentName, cpus, gib, shortId } from '../labels.js';

const BLOCK_REASON: Record<string, string> = {
  'not-allowlisted': 'that host is not on this sandbox’s allowlist',
  'private-address': 'it is a private or cloud-metadata address',
};

const host = (h: string) => (h === '169.254.169.254' ? '169.254.169.254 (cloud metadata address)' : h);

/** The vision check before an approval, in plain words. */
export function visionSummary(c: VisionCheck): { label: string; tone: 'ok' | 'warn' | 'none' } {
  if (c.verdict === 'consistent') return { label: 'Matches the goal', tone: 'ok' };
  if (c.verdict === 'inconsistent') return { label: 'Does not match the goal', tone: 'warn' };
  return { label: 'No vision verdict', tone: 'none' };
}

/** One plain line, an explanation, and raw fields for a containment / lifecycle / approval event. */
export function describeEvent(e: RailEvent): { title: string; explain: string; raw: string; tone: 'info' | 'alert' | 'warn' } {
  switch (e.t) {
    case 'sandbox.created':
      return {
        title: `${agentName(e.agent)} sandbox created`,
        explain: `A fresh ${e.limits.runtime} (gVisor) container for the ${agentName(e.agent).toLowerCase()} agent: ${gib(e.limits.memoryBytes)} memory, ${cpus(e.limits.nanoCpus)}, ${e.limits.pidsLimit} processes, hard stop after ${Math.round(e.limits.timeoutMs / 1000)} s. It holds no API keys; its only network path is the egress proxy.`,
        raw: `${shortId(e.containerId)} · ${e.limits.runtime} · ${gib(e.limits.memoryBytes)} · ${cpus(e.limits.nanoCpus)} · ${e.limits.pidsLimit} pids · ${Math.round(e.limits.timeoutMs / 1000)} s cap`,
        tone: 'info',
      };
    case 'sandbox.destroyed':
      return {
        title: `${agentName(e.agent)} sandbox destroyed`,
        explain: e.reason === 'stopped' ? 'Destroyed because the run was stopped.' : e.reason === 'timeout' ? 'Destroyed by its hard time cap.' : e.reason === 'error' ? 'Destroyed after an error. Nothing from it is reused.' : 'Destroyed after the agent finished. Every run starts from a clean container.',
        raw: `${shortId(e.containerId)} · ${e.reason}`,
        tone: 'info',
      };
    case 'containment.blocked':
      return {
        title: `Blocked: ${e.method} to ${host(e.host)}`,
        explain: `The egress proxy refused a request from the ${agentName(e.agent).toLowerCase()} sandbox because ${BLOCK_REASON[e.reason] ?? e.reason}. Code inside a sandbox can only reach the hosts this run allows.`,
        raw: `${e.method} ${e.host}${e.path} · ${e.reason}`,
        tone: 'alert',
      };
    case 'injection.flagged':
      return {
        title: 'Suspected prompt injection on the page',
        explain: `A content-safety model flagged text the ${agentName(e.agent).toLowerCase()} agent perceived as an attempt to give it instructions. It is left in place; containment, not the model, is what keeps the run safe.`,
        raw: e.text,
        tone: 'warn',
      };
    case 'approval.requested': {
      const disagrees = e.check?.verdict === 'inconsistent';
      const vision = e.check
        ? ` Before asking, a vision model looked at a screenshot of the page: ${visionSummary(e.check).label.toLowerCase()}. ${e.check.observed}${e.check.concerns.length ? ` Concerns: ${e.check.concerns.join('; ')}.` : ''}`
        : '';
      return {
        title: `${agentName(e.agent)} agent reached Place order${disagrees ? ' · vision check disagrees' : ''}`,
        explain: `Purchases always need a human. The run paused this agent and asked the person who started the run to approve or deny.${vision}`,
        raw: e.check ? `${e.element.snippet} · vision: ${e.check.verdict}` : e.element.snippet,
        tone: disagrees ? 'warn' : 'info',
      };
    }
    case 'approval.resolved':
      return {
        title: e.decision === 'approved' ? 'Purchase approved' : e.decision === 'denied' ? 'Purchase denied' : 'No answer in 60 s: purchase denied',
        explain: e.decision === 'approved' ? 'A demo order was placed. Nothing is charged.' : 'No order was placed. Reaching the button already counts as completing the journey.',
        raw: `approval ${e.approvalId} · ${e.decision}`,
        tone: 'info',
      };
  }
}
