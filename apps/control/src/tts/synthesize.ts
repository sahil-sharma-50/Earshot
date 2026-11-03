import { createHash } from 'node:crypto';
import type { Inference } from '../inference/client.js';

const MAX_ENTRIES = 50;

export interface Synthesizer {
  (script: string): Promise<{ id: string; mp3: Buffer }>;
  get(id: string): Buffer | undefined;
}

/** Vultr Serverless Inference TTS with an LRU cache keyed by sha1(script). */
export function createSynthesizer(inference: Inference): Synthesizer {
  const cache = new Map<string, Buffer>();
  const inflight = new Map<string, Promise<Buffer>>();

  const synth = (async (script: string) => {
    const id = createHash('sha1').update(script).digest('hex');
    const hit = cache.get(id);
    if (hit) {
      cache.delete(id);
      cache.set(id, hit);
      return { id, mp3: hit };
    }
    let p = inflight.get(id);
    if (!p) {
      p = inference.speech(script).finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    const mp3 = await p;
    cache.set(id, mp3);
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    return { id, mp3 };
  }) as Synthesizer;
  synth.get = (id) => cache.get(id);
  return synth;
}
