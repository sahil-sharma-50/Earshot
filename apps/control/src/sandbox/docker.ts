import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { randomBytes } from 'node:crypto';
import type { AgentId, RunEvent, RunMode, SandboxLimits } from '@earshot/shared';
import type { Config } from '../config.js';
import { RpcClient } from './rpc-client.js';

export type DestroyReason = 'finished' | 'timeout' | 'error';

export interface Sandbox {
  id: string;
  ip: string;
  agent: AgentId;
  limits: SandboxLimits;
  rpc: RpcClient;
  destroyed: boolean;
  destroy(reason: DestroyReason): Promise<void>;
}

export interface SandboxOpts { runId: string; agent: AgentId; mode: RunMode; allowHosts: string[] }
export type CreateSandbox = (opts: SandboxOpts) => Promise<Sandbox>;
export type SandboxConfig = Pick<Config, 'sandboxRuntime' | 'sandboxImage' | 'sandboxNetwork' | 'proxyUrl' | 'proxyAdminUrl' | 'proxyAdminToken'>;

export const MEMORY_BYTES = 1024 * 1024 * 1024;
export const NANO_CPUS = 750_000_000;
export const PIDS_LIMIT = 256;
/** Hard kill per sandbox: 120 s agent budget + 60 s approval wait + slack. Inspector gets 300 s. */
export const AGENT_SANDBOX_TIMEOUT_MS = 210_000;
export const INSPECTOR_SANDBOX_TIMEOUT_MS = 300_000;

/** The ONLY environment a sandbox ever receives. No keys, no tokens. */
export function sandboxEnv(proxyUrl: string, mode: RunMode): string[] {
  return [`EARSHOT_PROXY=${proxyUrl}`, `EARSHOT_MODE=${mode}`];
}

export function sandboxHostConfig(cfg: SandboxConfig): Docker.HostConfig {
  return {
    Memory: MEMORY_BYTES,
    MemorySwap: MEMORY_BYTES,
    NanoCpus: NANO_CPUS,
    PidsLimit: PIDS_LIMIT,
    ReadonlyRootfs: true,
    Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=256m', '/home/pwuser': 'rw,nosuid,nodev,size=256m' },
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges'],
    Runtime: cfg.sandboxRuntime,
    AutoRemove: false,
    NetworkMode: cfg.sandboxNetwork,
    ShmSize: 64 * 1024 * 1024,
  };
}

async function proxyPolicy(cfg: SandboxConfig, ip: string, method: 'PUT' | 'DELETE', body?: unknown): Promise<void> {
  const res = await fetch(`${cfg.proxyAdminUrl}/policy/${encodeURIComponent(ip)}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-token': cfg.proxyAdminToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`proxy policy ${method} failed: ${res.status}`);
}

export function createSandboxFactory(deps: {
  docker: Docker;
  cfg: SandboxConfig;
  emit: (e: RunEvent) => void;
  log?: (msg: string) => void;
}): CreateSandbox {
  const { docker, cfg, emit } = deps;
  const log = deps.log ?? (() => {});

  return async (opts) => {
    const timeoutMs = opts.agent === 'inspector' ? INSPECTOR_SANDBOX_TIMEOUT_MS : AGENT_SANDBOX_TIMEOUT_MS;
    const limits: SandboxLimits = { memoryBytes: MEMORY_BYTES, nanoCpus: NANO_CPUS, pidsLimit: PIDS_LIMIT, runtime: cfg.sandboxRuntime, timeoutMs };
    const name = `earshot-${opts.runId}-${opts.agent}-${randomBytes(3).toString('hex')}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
    const container = await docker.createContainer({
      name,
      Image: cfg.sandboxImage,
      User: 'pwuser',
      Env: sandboxEnv(cfg.proxyUrl, opts.mode),
      Labels: { 'earshot.sandbox': '1', 'earshot.run': opts.runId, 'earshot.agent': opts.agent, 'agent-rush': '1' },
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
      HostConfig: sandboxHostConfig(cfg),
    });

    let ip = '';
    let timer: NodeJS.Timeout | undefined;
    let destroyedFlag = false;
    let destroying: Promise<void> | null = null;
    const sandbox: Sandbox = {
      id: container.id,
      ip: '',
      agent: opts.agent,
      limits,
      rpc: undefined as unknown as RpcClient,
      get destroyed() { return destroyedFlag; },
      destroy(reason) {
        if (destroying) return destroying;
        destroying = (async () => {
          if (timer) clearTimeout(timer);
          sandbox.rpc?.close(`sandbox destroyed (${reason})`);
          if (ip) await proxyPolicy(cfg, ip, 'DELETE').catch((e) => log(`policy delete failed: ${String(e)}`));
          await container.remove({ force: true }).catch((e: { statusCode?: number }) => {
            if (e?.statusCode !== 404) log(`container remove failed: ${String(e)}`);
          });
          destroyedFlag = true;
          emit({ t: 'sandbox.destroyed', runId: opts.runId, agent: opts.agent, containerId: container.id, reason });
        })();
        return destroying;
      },
    } as Sandbox;

    try {
      const stream = await container.attach({ stream: true, stdin: true, stdout: true, stderr: true, hijack: true });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      docker.modem.demuxStream(stream, stdout, stderr);
      stream.on('end', () => { stdout.end(); stderr.end(); });
      stream.on('close', () => { stdout.end(); stderr.end(); });
      stderr.on('data', (c: Buffer) => log(`[${opts.agent}] ${c.toString('utf8').trimEnd()}`));
      sandbox.rpc = new RpcClient(stream, stdout);

      await container.start();
      const info = await container.inspect();
      ip = info.NetworkSettings.Networks?.[cfg.sandboxNetwork]?.IPAddress ?? '';
      if (!ip) throw new Error(`sandbox has no address on ${cfg.sandboxNetwork}`);
      sandbox.ip = ip;
      await proxyPolicy(cfg, ip, 'PUT', { runId: opts.runId, agent: opts.agent, mode: opts.mode, allowHosts: opts.allowHosts });
      timer = setTimeout(() => { void sandbox.destroy('timeout'); }, timeoutMs);
      timer.unref?.();
      emit({ t: 'sandbox.created', runId: opts.runId, agent: opts.agent, containerId: container.id, limits });
      return sandbox;
    } catch (e) {
      await sandbox.destroy('error');
      throw e;
    }
  };
}
