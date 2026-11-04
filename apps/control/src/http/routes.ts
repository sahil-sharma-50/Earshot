import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { AgentId, RunEvent, RunMode } from '@earshot/shared';
import type { RunStore } from '../runs/store.js';
import type { RunBus } from '../runs/events.js';
import type { Approvals } from '../runs/approval.js';
import type { IpRegistry } from '../runs/ip-registry.js';
import type { ControlResult, FixRequest } from '../runs/orchestrator.js';
import { QueueFullError } from '../runs/queue.js';
import { DEMO_GOAL } from '../runs/goal.js';
import { checkTargetUrl, safeEqual } from './guards.js';

export interface OrchestratorPort {
  start(run: ReturnType<RunStore['create']>): void;
  requestFix(runId: string, token: string): FixRequest;
  pauseRun(runId: string, token: string): ControlResult;
  resumeRun(runId: string, token: string): ControlResult;
  stopRun(runId: string, token: string): Promise<ControlResult>;
  listen(runId: string, opts: { agent?: AgentId; cssPath?: string; findingId?: string }): Promise<{ audioUrl: string; script: string } | null>;
}

export interface AppDeps {
  cfg: { accessCode: string; eventsToken: string; storeUrl: string; webDist?: string };
  store: RunStore;
  bus: RunBus;
  approvals: Approvals;
  ips: IpRegistry;
  orchestrator: OrchestratorPort;
  audio: (id: string) => Buffer | undefined;
  rateLimit?: { max: number; timeWindow: string };
  logger?: boolean;
}

interface CreateRunBody { mode: RunMode; url?: string; goal?: string; accessCode?: string }

const AGENT_ID = /^(sighted|blind|inspector|rerun-\d{1,2})$/;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { cfg, store, bus, approvals, ips, orchestrator } = deps;
  // Caddy is the only thing in front of control, so X-Forwarded-For is trustworthy.
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true, bodyLimit: 64 * 1024 });
  const rl = deps.rateLimit ?? { max: 3, timeWindow: '1 hour' };

  await app.register(rateLimit, { global: false, hook: 'preHandler' });

  app.get('/api/health', async () => ({ ok: true }));

  app.post<{ Body: CreateRunBody }>('/api/runs', {
    schema: {
      body: {
        type: 'object',
        required: ['mode'],
        additionalProperties: false,
        properties: {
          mode: { type: 'string', enum: ['demo', 'drill', 'any-url'] },
          url: { type: 'string', maxLength: 2000 },
          goal: { type: 'string', maxLength: 500 },
          accessCode: { type: 'string', maxLength: 200 },
        },
      },
    },
    config: {
      rateLimit: {
        timeWindow: rl.timeWindow,
        // demo/drill: 3 per hour per IP; any-url has its own bucket (access-code guessing is still limited)
        keyGenerator: (req: { ip: string; body?: unknown }) => `${req.ip}:${(req.body as CreateRunBody | undefined)?.mode === 'any-url' ? 'any' : 'demo'}`,
        max: (_req: unknown, key: string) => (key.endsWith(':any') ? 20 : rl.max),
      },
    },
  }, async (req, reply) => {
    const { mode } = req.body;
    let goal = DEMO_GOAL;
    let startUrl = `${cfg.storeUrl}/`;
    let allowHosts = [new URL(cfg.storeUrl).host];
    if (mode === 'drill') startUrl = `${cfg.storeUrl}/checkout?seed=drill`;
    if (mode === 'any-url') {
      if (!safeEqual(req.body.accessCode ?? '', cfg.accessCode)) return reply.code(401).send({ error: 'access code required for any-URL runs' });
      const target = checkTargetUrl(req.body.url ?? '');
      if (!target.ok) return reply.code(400).send({ error: target.reason });
      if (!req.body.goal?.trim()) return reply.code(400).send({ error: 'goal required' });
      goal = req.body.goal.trim();
      startUrl = target.url.href;
      allowHosts = [];
    }
    const run = store.create({ mode, goal, startUrl, allowHosts });
    const approvalToken = approvals.issueToken(run.id);
    bus.publish({ t: 'run.created', runId: run.id, mode, goal, target: startUrl });
    try {
      orchestrator.start(run);
    } catch (e) {
      // the orchestrator has already finished the run
      if (e instanceof QueueFullError) {
        return reply.code(503).send({ error: 'Earshot is busy. Please try again in a few minutes.' });
      }
      throw e;
    }
    return { runId: run.id, approvalToken };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', (req, reply) => {
    const run = store.get(req.params.id);
    if (!run) return reply.code(404).send({ error: 'unknown run' });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let closed = false;
    let unsubscribe = () => {};
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsubscribe();
      res.end();
    };
    const send = (e: RunEvent) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (e.t === 'run.finished') setImmediate(close);
    };
    const ping = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15_000);
    ping.unref?.();
    unsubscribe = bus.subscribe(run.id, send);
    req.raw.on('close', close);
  });

  app.get<{ Params: { id: string; shot: string } }>('/api/runs/:id/shots/:shot', (req, reply) => {
    const png = store.get(req.params.id)?.shots.get(req.params.shot.replace(/\.png$/, ''));
    if (!png) return reply.code(404).send({ error: 'unknown screenshot' });
    return reply.type('image/png').header('cache-control', 'private, max-age=3600').send(png);
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/fix', async (req, reply) => {
    const token = String(req.headers['x-approval-token'] ?? '');
    if (!store.get(req.params.id)) return reply.code(404).send({ error: 'unknown run' });
    if (!approvals.checkToken(req.params.id, token)) return reply.code(403).send({ error: 'only the person who started this run can start Fix & verify' });
    const r = orchestrator.requestFix(req.params.id, token);
    const code = { ok: 202, 'not-found': 404, 'not-allowed': 403, 'not-ready': 409, busy: 503 }[r];
    return reply.code(code).send({ status: r });
  });

  for (const verb of ['pause', 'resume', 'stop'] as const) {
    app.post<{ Params: { id: string } }>(`/api/runs/:id/${verb}`, {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (req, reply) => {
      const token = String(req.headers['x-approval-token'] ?? '');
      if (!store.get(req.params.id)) return reply.code(404).send({ error: 'unknown run' });
      if (!approvals.checkToken(req.params.id, token)) return reply.code(403).send({ error: 'only the person who started this run can control it' });
      const r = verb === 'pause' ? orchestrator.pauseRun(req.params.id, token)
        : verb === 'resume' ? orchestrator.resumeRun(req.params.id, token)
          : await orchestrator.stopRun(req.params.id, token);
      const code = { ok: 200, 'not-found': 404, 'not-allowed': 403, 'not-ready': 409 }[r];
      return reply.code(code).send({ status: r });
    });
  }

  app.post<{ Params: { id: string; approvalId: string }; Body: { decision: 'approved' | 'denied' } }>('/api/runs/:id/approvals/:approvalId', {
    schema: { body: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approved', 'denied'] } } } },
  }, async (req, reply) => {
    const token = String(req.headers['x-approval-token'] ?? '');
    const r = approvals.resolve(req.params.id, req.params.approvalId, token, req.body.decision);
    const code = { ok: 200, forbidden: 403, 'already-resolved': 409, 'not-found': 404 }[r];
    return reply.code(code).send({ status: r });
  });

  app.post<{ Params: { id: string }; Body: { agent?: string; cssPath?: string; findingId?: string } }>('/api/runs/:id/listen', {
    schema: { body: { type: 'object', additionalProperties: false, properties: { agent: { type: 'string', maxLength: 20 }, cssPath: { type: 'string', maxLength: 500 }, findingId: { type: 'string', maxLength: 40 } } } },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!store.get(req.params.id)) return reply.code(404).send({ error: 'unknown run' });
    const agent = req.body?.agent && AGENT_ID.test(req.body.agent) ? (req.body.agent as AgentId) : undefined;
    try {
      const r = await orchestrator.listen(req.params.id, { agent, cssPath: req.body?.cssPath, findingId: req.body?.findingId });
      if (!r) return reply.code(409).send({ error: 'nothing to read yet' });
      return r;
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: 'speech synthesis failed' });
    }
  });

  app.get<{ Params: { file: string } }>('/api/audio/:file', (req, reply) => {
    const mp3 = deps.audio(req.params.file.replace(/\.mp3$/, ''));
    if (!mp3) return reply.code(404).send({ error: 'unknown audio' });
    return reply.type('audio/mpeg').header('cache-control', 'public, max-age=86400').send(mp3);
  });

  app.post<{ Body: { ip?: string; method?: string; host?: string; path?: string; reason?: string } }>('/internal/proxy-events', async (req, reply) => {
    if (!safeEqual(String(req.headers['x-events-token'] ?? ''), cfg.eventsToken)) return reply.code(401).send();
    const b = req.body ?? {};
    const owner = b.ip ? ips.get(b.ip) : undefined;
    if (owner) {
      bus.publish({
        t: 'containment.blocked', runId: owner.runId, agent: owner.agent,
        method: String(b.method ?? '').slice(0, 16), host: String(b.host ?? '').slice(0, 255), path: String(b.path ?? '').slice(0, 500), reason: String(b.reason ?? '').slice(0, 40),
      });
    }
    return reply.code(204).send();
  });

  if (cfg.webDist && existsSync(cfg.webDist)) {
    await app.register(fastifyStatic, { root: cfg.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/internal/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
