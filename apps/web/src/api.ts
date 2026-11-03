import type { AgentId, RunMode } from '@earshot/shared';

const tokenKey = (runId: string) => `earshot:approval:${runId}`;

export function saveToken(runId: string, token: string): void {
  try { sessionStorage.setItem(tokenKey(runId), token); } catch { /* private mode: approvals unavailable */ }
}

export function getToken(runId: string): string | null {
  try { return sessionStorage.getItem(tokenKey(runId)); } catch { return null; }
}

async function call<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const msg = res.status === 429
      ? 'You have started 3 demo runs this hour. Try again later, or watch a run someone else started.'
      : data.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export async function createRun(body: { mode: RunMode; url?: string; goal?: string; accessCode?: string }): Promise<string> {
  const { runId, approvalToken } = await call<{ runId: string; approvalToken: string }>('/api/runs', body);
  saveToken(runId, approvalToken);
  return runId;
}

export function decide(runId: string, approvalId: string, decision: 'approved' | 'denied'): Promise<unknown> {
  return call(`/api/runs/${runId}/approvals/${approvalId}`, { decision }, { 'x-approval-token': getToken(runId) ?? '' });
}

export function startFix(runId: string): Promise<unknown> {
  return call(`/api/runs/${runId}/fix`, {}, { 'x-approval-token': getToken(runId) ?? '' });
}

export function listen(runId: string, body: { agent?: AgentId; findingId?: string }): Promise<{ audioUrl: string; script: string }> {
  return call(`/api/runs/${runId}/listen`, body);
}

export const shotUrl = (runId: string, shotId: string) => `/api/runs/${runId}/shots/${shotId}.png`;
