import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ElementIdentity, RunEvent } from '@earshot/shared';
import { buildApp, type OrchestratorPort } from '../src/http/routes.js';
import { RunStore } from '../src/runs/store.js';
import { RunBus } from '../src/runs/events.js';
import { Approvals } from '../src/runs/approval.js';
import { IpRegistry } from '../src/runs/ip-registry.js';

let app: FastifyInstance;
let store: RunStore;
let bus: RunBus;
let approvals: Approvals;
let ips: IpRegistry;
let orchestrator: OrchestratorPort & { started: string[] };

beforeEach(async () => {
  store = new RunStore();
  bus = new RunBus(store);
  approvals = new Approvals((e) => bus.publish(e));
  ips = new IpRegistry();
  orchestrator = {
    started: [],
    start: vi.fn(function (this: void, run) { orchestrator.started.push(run.id); }),
    requestFix: vi.fn(() => 'ok' as const),
    pauseRun: vi.fn(() => 'ok' as const),
    resumeRun: vi.fn(() => 'ok' as const),
    stopRun: vi.fn(async () => 'ok' as const),
    listen: vi.fn(async () => ({ audioUrl: '/api/audio/x.mp3', script: 'button.' })),
  };
  app = await buildApp({
    cfg: { accessCode: 'judge-code', eventsToken: 'ev-token', storeUrl: 'http://store:8080' },
    store, bus, approvals, ips, orchestrator, audio: () => undefined,
    rateLimit: { max: 3, timeWindow: '1 hour' },
  });
});
afterEach(async () => { await app.close(); });

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { 'content-type': 'application/json', ...headers } });

test('demo run returns runId and approval token and starts the orchestrator', async () => {
  const r = await post('/api/runs', { mode: 'demo' });
  expect(r.statusCode).toBe(200);
  const body = r.json();
  expect(body.runId).toMatch(/^[a-z0-9]+$/);
  expect(body.approvalToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(orchestrator.started).toEqual([body.runId]);
  expect(store.get(body.runId)!.events[0]).toMatchObject({ t: 'run.created', mode: 'demo', target: 'http://store:8080/' });
});

test('drill starts at checkout with the seeded cart', async () => {
  const r = await post('/api/runs', { mode: 'drill' });
  expect(store.get(r.json().runId)!.startUrl).toBe('http://store:8080/checkout?seed=drill');
});

test('any-url without access code → 401; wrong code → 401; right code → 200', async () => {
  expect((await post('/api/runs', { mode: 'any-url', url: 'https://example.com', goal: 'find the contact page' })).statusCode).toBe(401);
  expect((await post('/api/runs', { mode: 'any-url', url: 'https://example.com', goal: 'g', accessCode: 'nope' })).statusCode).toBe(401);
  expect((await post('/api/runs', { mode: 'any-url', url: 'https://example.com', goal: 'find it', accessCode: 'judge-code' })).statusCode).toBe(200);
});

test('invalid body → 400', async () => {
  expect((await post('/api/runs', { mode: 'evil' })).statusCode).toBe(400);
  expect((await post('/api/runs', { mode: 'any-url', url: 'ftp://x', goal: 'g', accessCode: 'judge-code' })).statusCode).toBe(400);
});

test('4th demo run in an hour from one IP → 429 (any-url is not counted)', async () => {
  for (let i = 0; i < 3; i++) expect((await post('/api/runs', { mode: 'demo' })).statusCode).toBe(200);
  expect((await post('/api/runs', { mode: 'drill' })).statusCode).toBe(429);
  expect((await post('/api/runs', { mode: 'any-url', url: 'https://example.com', goal: 'g', accessCode: 'judge-code' })).statusCode).toBe(200);
});

test('approval with wrong token → 403; twice → 409', async () => {
  const { runId, approvalToken } = (await post('/api/runs', { mode: 'demo' })).json();
  const el: ElementIdentity = { cssPath: 'b', backendNodeId: 1, snippet: '<b>', isFinal: true, isFormSubmit: true };
  const decision = approvals.request(runId, 'blind', el);
  const req = store.get(runId)!.events.find((e) => e.t === 'approval.requested') as Extract<RunEvent, { t: 'approval.requested' }>;
  const url = `/api/runs/${runId}/approvals/${req.approvalId}`;
  expect((await post(url, { decision: 'approved' }, { 'x-approval-token': 'wrong' })).statusCode).toBe(403);
  expect((await post(url, { decision: 'approved' })).statusCode).toBe(403);
  expect((await post(url, { decision: 'approved' }, { 'x-approval-token': approvalToken })).statusCode).toBe(200);
  expect((await post(url, { decision: 'denied' }, { 'x-approval-token': approvalToken })).statusCode).toBe(409);
  expect(await decision).toBe('approved');
  expect((await post(`/api/runs/${runId}/approvals/nope`, { decision: 'approved' }, { 'x-approval-token': approvalToken })).statusCode).toBe(404);
});

test('proxy event with bad token → 401; good token maps ip to containment.blocked on the right run', async () => {
  const { runId } = (await post('/api/runs', { mode: 'demo' })).json();
  ips.set('172.30.0.5', { runId, agent: 'rerun-1' });
  const ev = { ip: '172.30.0.5', method: 'CONNECT', host: 'cardcheck.attacker.invalid', path: '', reason: 'not-allowlisted' };
  expect((await post('/internal/proxy-events', ev, { 'x-events-token': 'bad' })).statusCode).toBe(401);
  expect((await post('/internal/proxy-events', ev, { 'x-events-token': 'ev-token' })).statusCode).toBe(204);
  expect(store.get(runId)!.events.at(-1)).toEqual({ t: 'containment.blocked', runId, agent: 'rerun-1', method: 'CONNECT', host: 'cardcheck.attacker.invalid', path: '', reason: 'not-allowlisted' });
  expect((await post('/internal/proxy-events', { ...ev, ip: '10.9.9.9' }, { 'x-events-token': 'ev-token' })).statusCode).toBe(204);
});

test('SSE replays earlier events to a late subscriber and ends after run.finished', async () => {
  const { runId } = (await post('/api/runs', { mode: 'demo' })).json();
  bus.publish({ t: 'run.queued', runId, position: 0 });
  bus.publish({ t: 'run.finished', runId, verified: false });
  const r = await app.inject({ method: 'GET', url: `/api/runs/${runId}/events` });
  expect(r.headers['content-type']).toContain('text/event-stream');
  const frames = r.body.split('\n\n').filter((f) => f.startsWith('data: ')).map((f) => JSON.parse(f.slice(6)));
  expect(frames.map((f) => f.t)).toEqual(['run.created', 'run.queued', 'run.finished']);
});

test('unknown run → 404; shots served as png', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/runs/nope/events' })).statusCode).toBe(404);
  const { runId } = (await post('/api/runs', { mode: 'demo' })).json();
  const shotId = store.addShot(runId, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const r = await app.inject({ method: 'GET', url: `/api/runs/${runId}/shots/${shotId}.png` });
  expect(r.statusCode).toBe(200);
  expect(r.headers['content-type']).toBe('image/png');
});

test('fix needs the starter token', async () => {
  const { runId, approvalToken } = (await post('/api/runs', { mode: 'demo' })).json();
  expect((await post(`/api/runs/${runId}/fix`, {})).statusCode).toBe(403);
  expect((await post(`/api/runs/${runId}/fix`, {}, { 'x-approval-token': approvalToken })).statusCode).toBe(202);
});

test('health', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
});

test('pause, resume and stop: 404 unknown run, 403 without the starter token', async () => {
  for (const verb of ['pause', 'resume', 'stop']) {
    expect((await post(`/api/runs/nope/${verb}`, {}, { 'x-approval-token': 'x' })).statusCode).toBe(404);
    const { runId } = (await post('/api/runs', { mode: 'demo' })).json();
    const r = await post(`/api/runs/${runId}/${verb}`, {});
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('only the person who started this run can control it');
  }
});

test('pause on a running run → 200; stop → 200', async () => {
  const { runId, approvalToken } = (await post('/api/runs', { mode: 'demo' })).json();
  const h = { 'x-approval-token': approvalToken };
  expect((await post(`/api/runs/${runId}/pause`, {}, h)).statusCode).toBe(200);
  expect(orchestrator.pauseRun).toHaveBeenCalledWith(runId, approvalToken);
  expect((await post(`/api/runs/${runId}/stop`, {}, h)).statusCode).toBe(200);
  expect(orchestrator.stopRun).toHaveBeenCalledWith(runId, approvalToken);
});

test('pause when the orchestrator says not-ready → 409', async () => {
  (orchestrator.pauseRun as any).mockReturnValueOnce('not-ready');
  const { runId, approvalToken } = (await post('/api/runs', { mode: 'demo' })).json();
  expect((await post(`/api/runs/${runId}/pause`, {}, { 'x-approval-token': approvalToken })).statusCode).toBe(409);
});
