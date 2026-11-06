import Docker from 'dockerode';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { createInference } from './inference/client.js';
import { assertModelsAvailable } from './inference/models-check.js';
import { createSandboxFactory, type CreateSandbox } from './sandbox/docker.js';
import { reapOrphans } from './sandbox/reaper.js';
import { RunStore } from './runs/store.js';
import { RunBus } from './runs/events.js';
import { Approvals } from './runs/approval.js';
import { IpRegistry } from './runs/ip-registry.js';
import { RunQueue } from './runs/queue.js';
import { Orchestrator } from './runs/orchestrator.js';
import { createSynthesizer } from './tts/synthesize.js';
import { buildApp } from './http/routes.js';

async function main() {
  const cfg = loadConfig();
  const log = (m: string) => console.log(`[control] ${m}`);

  await assertModelsAvailable(cfg);
  const docker = new Docker();
  const reaped = await reapOrphans(docker);
  if (reaped) log(`reaped ${reaped} orphaned sandbox container(s)`);

  const store = new RunStore();
  const bus = new RunBus(store);
  const approvals = new Approvals((e) => bus.publish(e));
  const ips = new IpRegistry();
  const queue = new RunQueue((e) => bus.publish(e));
  const baseFactory = createSandboxFactory({ docker, cfg, emit: (e) => bus.publish(e), log });
  // map each sandbox IP to its run so proxy BLOCKED reports land on the right timeline
  const createSandbox: CreateSandbox = async (opts) => {
    const sb = await baseFactory(opts);
    ips.set(sb.ip, { runId: opts.runId, agent: opts.agent });
    const destroy = sb.destroy.bind(sb);
    sb.destroy = async (reason) => { await destroy(reason); ips.release(sb.ip); };
    return sb;
  };

  const inference = createInference(cfg);
  const synth = createSynthesizer(inference);
  const orchestrator = new Orchestrator({ store, bus, approvals, queue, createSandbox, inference, storeUrl: cfg.storeUrl, synth, log });

  const here = dirname(fileURLToPath(import.meta.url));
  const app = await buildApp({
    cfg: { eventsToken: cfg.eventsToken, storeUrl: cfg.storeUrl, webDist: resolve(cfg.webDist ?? join(here, '..', '..', 'web', 'dist')) },
    store, bus, approvals, ips, orchestrator, audio: (id) => synth.get(id), logger: true,
  });
  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  log(`listening on :${cfg.port} (runtime=${cfg.sandboxRuntime}, model=${cfg.agentModel})`);

  const shutdown = async () => {
    await app.close().catch(() => {});
    await reapOrphans(docker).catch(() => 0);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
