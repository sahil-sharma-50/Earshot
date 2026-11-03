import { expect, test } from 'vitest';
import { checkTargetUrl } from '../src/http/guards.js';

test.each([
  'http://10.0.0.1/',
  'http://127.0.0.1:3000/',
  'http://[::1]/',
  'http://169.254.169.254/latest/meta-data',
  'http://localhost:8080/',
  'http://store:8080/',
  'http://proxy:3129/policy/1',
  'http://0x7f000001/',
  'http://2130706433/',
  'http://[::ffff:10.0.0.1]/',
  'http://[fd00::1]/',
  'http://100.64.0.1/',
  'ftp://example.com/',
  'https://user:pass@example.com/',
  'javascript:alert(1)',
  'not a url',
])('rejects %s', (u) => {
  expect(checkTargetUrl(u).ok).toBe(false);
});

test.each(['https://example.com/', 'http://shop.example.org/cart?x=1', 'https://93.184.216.34/'])('accepts %s', (u) => {
  expect(checkTargetUrl(u).ok).toBe(true);
});
