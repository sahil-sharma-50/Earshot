import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { RunEvent } from '@earshot/shared';
import { PAUSE_MAX_MS, RunControl, StoppedError } from '../src/runs/control.js';

let events: RunEvent[];
let ctl: RunControl;

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  ctl = new RunControl((e) => events.push(e), 'r1');
});
afterEach(() => vi.useRealTimers());

test('pause then checkpoint waits until resume by user', async () => {
  expect(ctl.pause()).toBe(true);
  let passed = false;
  const p = ctl.checkpoint().then(() => { passed = true; });
  await vi.advanceTimersByTimeAsync(1000);
  expect(passed).toBe(false);
  expect(ctl.resume('user')).toBe(true);
  await p;
  expect(passed).toBe(true);
  expect(events.map((e) => e.t)).toEqual(['run.paused', 'run.resumed']);
  expect(events[0]).toMatchObject({ resumeAt: Date.now() - 1000 + PAUSE_MAX_MS });
  expect(events[1]).toMatchObject({ by: 'user' });
});

test('pause auto-resumes after 30 seconds', async () => {
  expect(PAUSE_MAX_MS).toBe(30_000);
  ctl.pause();
  const p = ctl.checkpoint();
  await vi.advanceTimersByTimeAsync(30_000);
  await p;
  expect(ctl.paused).toBe(false);
  expect(events.at(-1)).toMatchObject({ t: 'run.resumed', by: 'auto' });
});

test('stop releases a paused checkpoint with StoppedError', async () => {
  ctl.pause();
  const p = ctl.checkpoint();
  ctl.stop();
  await expect(p).rejects.toBeInstanceOf(StoppedError);
  await expect(ctl.checkpoint()).rejects.toBeInstanceOf(StoppedError);
});

test('pause returns false when already paused or stopped', () => {
  expect(ctl.pause()).toBe(true);
  expect(ctl.pause()).toBe(false);
  ctl.stop();
  expect(ctl.pause()).toBe(false);
  expect(ctl.resume('user')).toBe(false);
});

test('checkpoint resolves immediately when not paused', async () => {
  await expect(ctl.checkpoint()).resolves.toBeUndefined();
});
