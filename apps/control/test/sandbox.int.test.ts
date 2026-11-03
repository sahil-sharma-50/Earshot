import { expect, test } from 'vitest';
import Docker from 'dockerode';
import type { BlindObservation, RunEvent } from '@earshot/shared';
import { createSandboxFactory } from '../src/sandbox/docker.js';
import { reapOrphans } from '../src/sandbox/reaper.js';

// Needs: docker build -f sandbox/Dockerfile -t earshot-sandbox:latest .
//        docker compose -f infra/docker-compose.dev.yml up -d
const docker = new Docker();
const events: RunEvent[] = [];
const emit = (e: RunEvent) => events.push(e);
const createSandbox = createSandboxFactory({
  docker,
  emit,
  cfg: {
    sandboxRuntime: process.env.SANDBOX_RUNTIME || 'runc',
    sandboxImage: 'earshot-sandbox:latest',
    sandboxNetwork: 'earshot_sandnet',
    proxyUrl: 'http://proxy:3128',
    proxyAdminUrl: 'http://127.0.0.1:3129',
    proxyAdminToken: 'dev-admin-token',
  },
});

test.runIf(process.env.DOCKER_IT)('sandbox has no secrets, has limits, and is destroyed', async () => {
  const sb = await createSandbox({ runId: 'it', agent: 'blind', mode: 'demo', allowHosts: ['store:8080'] });
  try {
    const info = await docker.getContainer(sb.id).inspect();
    expect(info.Config.Env.filter(e => !e.startsWith('PATH=') && !e.startsWith('PLAYWRIGHT_') && !e.startsWith('HOME=') && !e.startsWith('LANG=') && !e.startsWith('LC_ALL='))).toEqual([expect.stringMatching(/^EARSHOT_PROXY=http:\/\/(\d+\.){3}\d+:3128$/), 'EARSHOT_MODE=demo']);
    // stricter: everything not baked into the image is exactly our two variables
    const imageEnv = new Set((await docker.getImage('earshot-sandbox:latest').inspect()).Config.Env ?? []);
    expect(info.Config.Env.filter(e => !imageEnv.has(e))).toEqual([expect.stringMatching(/^EARSHOT_PROXY=http:\/\/(\d+\.){3}\d+:3128$/), 'EARSHOT_MODE=demo']);
    expect(info.Config.Env.join(' ')).not.toMatch(/KEY|TOKEN|SECRET|ACCESS_CODE/i);
    expect(info.HostConfig).toMatchObject({ Memory: 1073741824, NanoCpus: 750000000, PidsLimit: 256, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'] });
    expect(info.Config.User).toBe('pwuser');
    expect(info.Config.Labels).toMatchObject({ 'earshot.sandbox': '1', 'earshot.run': 'it' });
    await sb.rpc.call({ m: 'open', url: 'http://store:8080/', patches: [] }, 60_000);
    const obs = await sb.rpc.call<BlindObservation>({ m: 'observe', kind: 'blind' });
    expect(obs.nodes.some(n => n.name === 'Ethiopia Guji')).toBe(true);
    // containment: a non-allowlisted host is blocked by the proxy
    const nav = await sb.rpc.call<{ ok: boolean; error?: string }>({ m: 'act', kind: 'blind', action: { type: 'navigate', url: 'http://cardcheck.attacker.invalid/verify?card=4242' } });
    expect(nav).toEqual({ ok: false, error: 'navigation-blocked' });
  } finally {
    await sb.destroy('finished');
  }
  await expect(docker.getContainer(sb.id).inspect()).rejects.toThrow();
  expect(events.map(e => e.t)).toEqual(['sandbox.created', 'sandbox.destroyed']);
  await sb.destroy('finished'); // idempotent
  expect(events).toHaveLength(2);
}, 120_000);

test.runIf(process.env.DOCKER_IT)('reaper removes orphans', async () => {
  const c = await docker.createContainer({ Image: 'earshot-sandbox:latest', Labels: { 'earshot.sandbox': '1' }, Entrypoint: ['sleep', '60'] });
  expect(await reapOrphans(docker)).toBeGreaterThanOrEqual(1);
  await expect(docker.getContainer(c.id).inspect()).rejects.toThrow();
});
