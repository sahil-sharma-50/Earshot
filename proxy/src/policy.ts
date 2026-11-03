import type { AgentId, RunMode } from '@earshot/shared';
import { isPrivate } from './ip.js';

export type SandboxPolicy = { runId: string; agent: AgentId; mode: RunMode; allowHosts: string[] };
export type DenyReason = 'no-policy' | 'not-allowlisted' | 'private-address';
export type Decision = { allow: true } | { allow: false; reason: DenyReason };

export function isAllowlisted(host: string, port: number, policy: SandboxPolicy): boolean {
  const key = `${host.toLowerCase()}:${port}`;
  return policy.allowHosts.some((h) => h.toLowerCase() === key);
}

/**
 * demo/drill: only allowlisted host:port pairs (no DNS needed).
 * any-url: public internet, but every resolved IP must be public; the server
 * then connects to the checked IP, never re-resolving (no DNS rebinding).
 */
export function decide(target: { host: string; port: number; resolvedIps: string[] }, policy: SandboxPolicy | undefined): Decision {
  if (!policy) return { allow: false, reason: 'no-policy' };
  if (isAllowlisted(target.host, target.port, policy)) return { allow: true };
  if (policy.mode !== 'any-url') return { allow: false, reason: 'not-allowlisted' };
  if (target.resolvedIps.length === 0) return { allow: false, reason: 'not-allowlisted' };
  if (target.resolvedIps.some(isPrivate)) return { allow: false, reason: 'private-address' };
  return { allow: true };
}
