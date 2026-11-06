import { expect, test } from 'vitest';
import { DemoQuota } from '../src/runs/demo-quota.js';

const HOUR = 3_600_000;

test('allows three runs an hour per IP, then names when the next one is free', () => {
  let now = 1_000_000;
  const q = new DemoQuota(3, HOUR, () => now);
  for (const id of ['a', 'b', 'c']) { expect(q.check('1.1.1.1')).toBeNull(); q.record('1.1.1.1', id); now += 60_000; }
  expect(q.check('1.1.1.1')).toBe(1_000_000 + HOUR);
  expect(q.check('2.2.2.2')).toBeNull();
});

test('a run its starter stopped gives its slot back', () => {
  let now = 0;
  const q = new DemoQuota(3, HOUR, () => now);
  for (const id of ['a', 'b', 'c']) q.record('ip', id);
  expect(q.check('ip')).not.toBeNull();
  q.release('b');
  expect(q.check('ip')).toBeNull();
});

test('runs older than the window no longer count', () => {
  let now = 0;
  const q = new DemoQuota(3, HOUR, () => now);
  for (const id of ['a', 'b', 'c']) q.record('ip', id);
  now = HOUR + 1;
  expect(q.check('ip')).toBeNull();
});
