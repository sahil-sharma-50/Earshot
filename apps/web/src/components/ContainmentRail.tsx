import { Ban, Box, CircleCheck, CircleX, Hand, Hourglass, Trash2, TriangleAlert } from 'lucide-react';
import type { RailEvent } from '../reduce.js';
import { agentName, cpus, gib, shortId } from '../labels.js';

function Row({ e }: { e: RailEvent }) {
  switch (e.t) {
    case 'sandbox.created':
      return (
        <li className="rail-row">
          <Box size={16} aria-hidden />
          <div><strong>{agentName(e.agent)} sandbox created</strong>
            <span className="mono small">{shortId(e.containerId)} · {e.limits.runtime} · {gib(e.limits.memoryBytes)} · {cpus(e.limits.nanoCpus)} · {e.limits.pidsLimit} pids · {Math.round(e.limits.timeoutMs / 1000)} s cap</span></div>
        </li>
      );
    case 'sandbox.destroyed':
      return (
        <li className="rail-row">
          <Trash2 size={16} aria-hidden />
          <div><strong>{agentName(e.agent)} sandbox destroyed</strong><span className="mono small">{shortId(e.containerId)} · {e.reason}</span></div>
        </li>
      );
    case 'containment.blocked':
      return (
        <li className="rail-row blocked">
          <Ban size={16} aria-hidden />
          <div><strong>BLOCKED by egress proxy</strong>
            <span className="mono small">{e.method} {e.host}{e.path}</span>
            <span className="small">{agentName(e.agent)} · {e.reason === 'not-allowlisted' ? 'host not on this sandbox’s allowlist' : e.reason === 'private-address' ? 'private or metadata address' : e.reason}</span></div>
        </li>
      );
    case 'injection.flagged':
      return (
        <li className="rail-row warn">
          <TriangleAlert size={16} aria-hidden />
          <div><strong>Suspected prompt injection</strong><span className="small">in page text the {agentName(e.agent)} agent perceived. Left in place; containment handles it.</span><span className="mono small clamp">{e.text}</span></div>
        </li>
      );
    case 'approval.requested':
      return (
        <li className="rail-row approval">
          <Hand size={16} aria-hidden />
          <div><strong>{agentName(e.agent)} reached Place order</strong><span className="small">Paused for human approval</span></div>
        </li>
      );
    case 'approval.resolved': {
      const Icon = e.decision === 'approved' ? CircleCheck : e.decision === 'denied' ? CircleX : Hourglass;
      return (
        <li className="rail-row approval">
          <Icon size={16} aria-hidden />
          <div><strong>{e.decision === 'approved' ? 'Purchase approved' : e.decision === 'denied' ? 'Purchase denied' : 'No answer in 60 s: denied'}</strong></div>
        </li>
      );
    }
  }
}

export function ContainmentRail({ events }: { events: RailEvent[] }) {
  const blocked = events.filter((e) => e.t === 'containment.blocked').length;
  return (
    <aside className="rail" aria-label="Containment log">
      <header className="rail-head">
        <h2>Containment</h2>
        <span className={blocked ? 'count bad' : 'count'}>{blocked} blocked</span>
      </header>
      <ol className="rail-list">
        {[...events].reverse().map((e, i) => <Row key={events.length - i} e={e} />)}
        {events.length === 0 && <li className="empty">Sandbox lifecycle, blocked requests and approvals appear here.</li>}
      </ol>
    </aside>
  );
}
