import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { decide, isAllowlisted, type DenyReason, type SandboxPolicy } from './policy.js';

export interface ProxyOptions {
  proxyPort: number;
  adminPort: number;
  host?: string;
  adminToken: string;
  eventsUrl?: string;
  eventsToken?: string;
  log?: (msg: string) => void;
}

export interface ProxyHandle {
  proxyPort: number;
  adminPort: number;
  policies: Map<string, SandboxPolicy>;
  close(): Promise<void>;
}

const BLOCK_BODY = 'Blocked by Earshot egress policy';

export function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function resolveAll(host: string): Promise<string[]> {
  if (net.isIP(host)) return [host];
  try {
    return (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    return [];
  }
}

export async function createProxy(opts: ProxyOptions): Promise<ProxyHandle> {
  const policies = new Map<string, SandboxPolicy>();
  const log = opts.log ?? (() => {});

  function report(ip: string, method: string, host: string, path: string, reason: DenyReason) {
    log(`BLOCKED ${ip} ${method} ${host}${path} (${reason})`);
    if (!opts.eventsUrl) return;
    fetch(opts.eventsUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-events-token': opts.eventsToken ?? '' },
      body: JSON.stringify({ ip, method, host, path, reason }),
    }).catch((e) => log(`event report failed: ${String(e)}`));
  }

  /** Returns the address to dial (the checked IP in any-url mode), or a deny reason. */
  async function check(ip: string, host: string, port: number): Promise<{ dial: string } | { deny: DenyReason }> {
    const policy = policies.get(ip);
    // Allowlisted hosts and non-any-url modes never trigger DNS for unlisted names.
    if (!policy || policy.mode !== 'any-url' || isAllowlisted(host, port, policy)) {
      const d = decide({ host, port, resolvedIps: [] }, policy);
      return d.allow ? { dial: host } : { deny: d.reason };
    }
    const resolvedIps = await resolveAll(host);
    const d = decide({ host, port, resolvedIps }, policy);
    return d.allow ? { dial: resolvedIps[0]! } : { deny: d.reason };
  }

  const proxy = http.createServer(async (req, res) => {
    const ip = normalizeIp(req.socket.remoteAddress);
    let url: URL;
    try {
      url = new URL(req.url ?? '');
      if (url.protocol !== 'http:') throw new Error('scheme');
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Earshot proxy expects absolute http:// URLs');
      return;
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const port = Number(url.port || 80);
    const path = url.pathname + url.search;
    const r = await check(ip, host, port);
    if ('deny' in r) {
      report(ip, req.method ?? 'GET', host, path, r.deny);
      res.writeHead(403, { 'content-type': 'text/plain' }).end(BLOCK_BODY);
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    headers.host = url.host;
    const upstream = http.request({ host: r.dial, port, method: req.method, path, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Upstream error');
    });
    req.pipe(upstream);
  });

  proxy.on('connect', async (req, client: net.Socket, head) => {
    const ip = normalizeIp(client.remoteAddress);
    client.on('error', () => {});
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? '');
    if (!m) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const host = m[1]!;
    const port = Number(m[2]);
    const r = await check(ip, host, port);
    if ('deny' in r) {
      report(ip, 'CONNECT', host, '', r.deny);
      client.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: ${BLOCK_BODY.length}\r\nConnection: close\r\n\r\n${BLOCK_BODY}`);
      return;
    }
    const upstream = net.connect(port, r.dial, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  });

  const admin = http.createServer((req, res) => {
    if (!safeEqual(String(req.headers['x-admin-token'] ?? ''), opts.adminToken)) {
      res.writeHead(401).end();
      return;
    }
    const m = /^\/policy\/([0-9a-fA-F:.]+)$/.exec(req.url ?? '');
    if (!m) {
      res.writeHead(404).end();
      return;
    }
    const ip = normalizeIp(m[1]);
    if (req.method === 'DELETE') {
      policies.delete(ip);
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'PUT') {
      res.writeHead(405).end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 16_384) req.destroy(); });
    req.on('end', () => {
      try {
        const p = JSON.parse(body) as SandboxPolicy;
        if (!p.runId || !p.agent || !['demo', 'drill', 'any-url'].includes(p.mode) || !Array.isArray(p.allowHosts)) throw new Error('bad policy');
        policies.set(ip, { runId: p.runId, agent: p.agent, mode: p.mode, allowHosts: p.allowHosts.map(String) });
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  });

  const listen = (s: http.Server, port: number) =>
    new Promise<number>((resolve) => s.listen(port, opts.host ?? '0.0.0.0', () => resolve((s.address() as AddressInfo).port)));
  const proxyPort = await listen(proxy, opts.proxyPort);
  const adminPort = await listen(admin, opts.adminPort);

  return {
    proxyPort,
    adminPort,
    policies,
    close: async () => {
      proxy.closeAllConnections();
      admin.closeAllConnections();
      await Promise.all([new Promise((r) => proxy.close(r)), new Promise((r) => admin.close(r))]);
    },
  };
}
