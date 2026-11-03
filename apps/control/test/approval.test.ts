import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ElementIdentity, RunEvent } from '@earshot/shared';
import { Approvals } from '../src/runs/approval.js';

const el: ElementIdentity = { cssPath: 'button', backendNodeId: 1, snippet: '<button data-earshot-final>', isFinal: true, isFormSubmit: true };
let events: RunEvent[];
let approvals: Approvals;

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  approvals = new Approvals((e) => events.push(e));
});
afterEach(() => vi.useRealTimers());

const requested = () => events.find((e) => e.t === 'approval.requested') as Extract<RunEvent, { t: 'approval.requested' }>;

test('the correct token resolves to approved', async () => {
  const token = approvals.issueToken('r1');
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const p = approvals.request('r1', 'blind', el);
  expect(requested()).toMatchObject({ runId: 'r1', agent: 'blind', element: el });
  expect(approvals.resolve('r1', requested().approvalId, token, 'approved')).toBe('ok');
  expect(await p).toBe('approved');
  expect(events.at(-1)).toEqual({ t: 'approval.resolved', runId: 'r1', approvalId: requested().approvalId, decision: 'approved' });
});

test('a wrong token is forbidden and leaves the request pending', async () => {
  const token = approvals.issueToken('r1');
  const p = approvals.request('r1', 'blind', el);
  const id = requested().approvalId;
  expect(approvals.resolve('r1', id, 'not-the-token', 'approved')).toBe('forbidden');
  expect(approvals.resolve('r1', id, '', 'approved')).toBe('forbidden');
  expect(approvals.resolve('r2', id, token, 'approved')).toBe('not-found');
  expect(approvals.resolve('r1', id, token, 'denied')).toBe('ok');
  expect(await p).toBe('denied');
});

test('after 60 000 ms the request times out', async () => {
  const token = approvals.issueToken('r1');
  const p = approvals.request('r1', 'sighted', el);
  const id = requested().approvalId;
  await vi.advanceTimersByTimeAsync(59_999);
  expect(events.some((e) => e.t === 'approval.resolved')).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await p).toBe('timeout');
  expect(events.at(-1)).toMatchObject({ t: 'approval.resolved', decision: 'timeout' });
  expect(approvals.resolve('r1', id, token, 'approved')).toBe('already-resolved');
});

test('resolving twice is already-resolved; unknown id is not-found', async () => {
  const token = approvals.issueToken('r1');
  const p = approvals.request('r1', 'blind', el);
  const id = requested().approvalId;
  expect(approvals.resolve('r1', id, token, 'approved')).toBe('ok');
  expect(approvals.resolve('r1', id, token, 'denied')).toBe('already-resolved');
  expect(await p).toBe('approved');
  expect(approvals.resolve('r1', 'nope', token, 'approved')).toBe('not-found');
});

test('a run without an issued token can never be approved', async () => {
  const p = approvals.request('r9', 'blind', el);
  expect(approvals.resolve('r9', requested().approvalId, '', 'approved')).toBe('forbidden');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await p).toBe('timeout');
});
