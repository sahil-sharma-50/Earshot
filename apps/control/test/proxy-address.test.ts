import { expect, test } from 'vitest';
import { resolveProxyUrl } from '../src/sandbox/docker.js';

const fakeDocker = (containers: Record<string, { Name: string; IPv4Address: string }>) => ({
  getNetwork: () => ({ inspect: async () => ({ Containers: containers }) }),
}) as never;

test('replaces the proxy hostname with its IP on the sandbox network (gVisor sandboxes have no Docker DNS)', async () => {
  const docker = fakeDocker({ a: { Name: 'earshot-store-1', IPv4Address: '172.18.0.3/16' }, b: { Name: 'earshot-proxy-1', IPv4Address: '172.18.0.2/16' } });
  expect(await resolveProxyUrl(docker, 'earshot_sandnet', 'http://proxy:3128')).toBe('http://172.18.0.2:3128');
});

test('an IP proxy URL is kept; an unknown proxy fails loudly', async () => {
  expect(await resolveProxyUrl(fakeDocker({}), 'n', 'http://10.1.2.3:3128')).toBe('http://10.1.2.3:3128');
  await expect(resolveProxyUrl(fakeDocker({}), 'earshot_sandnet', 'http://proxy:3128')).rejects.toThrow(/proxy/);
});
