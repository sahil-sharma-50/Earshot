/**
 * Model bake-off (plan Task 8, Step 4). Runs the SIGHTED agent against a local store with an
 * in-process runner (no Docker needed) for each candidate model, 3 tries each, and records
 * the gate-reach rate and mean seconds per step. Also tries each TTS model once.
 *
 *   pnpm tsx --env-file=.env scripts/bakeoff.ts [model ...]
 *
 * Writes docs/bakeoff.md. Needs VULTR_INFERENCE_API_KEY in .env.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateMilestones, type RpcCall } from '@earshot/shared';
import { createStoreServer } from '../apps/store/src/server.js';
import { Runner } from '../sandbox/runner/src/runner.js';
import { createInference } from '../apps/control/src/inference/client.js';
import { runAgent } from '../apps/control/src/agents/loop.js';
import { DEMO_GOAL } from '../apps/control/src/runs/goal.js';
import type { Sandbox } from '../apps/control/src/sandbox/docker.js';

const key = process.env.VULTR_INFERENCE_API_KEY;
if (!key) throw new Error('VULTR_INFERENCE_API_KEY missing');
const baseURL = process.env.INFERENCE_BASE_URL || 'https://api.vultrinference.com/v1';
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['glm-5.3', 'qwen3.8-27b', 'muse-glimmer-30b'];
const ttsModels = ['chatterbox', 'qwen3-tts-12hz-1.7b'];
const TRIES = 3;
const scratch = process.env.BAKEOFF_OUT || join(process.cwd(), '.superpowers', 'bakeoff');
mkdirSync(scratch, { recursive: true });

const live = await fetch(`${baseURL}/models`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.json()) as { data: { id: string }[] };
const liveIds = new Set(live.data.map((m) => m.id));
console.log('Live models:', [...liveIds].join(', '));

const app = createStoreServer();
const base = await app.listen({ port: 0, host: '127.0.0.1' });

function inProcessSandbox(runner: Runner): Sandbox {
  let id = 0;
  return {
    id: 'local', ip: '127.0.0.1', agent: 'sighted', destroyed: false,
    limits: { memoryBytes: 0, nanoCpus: 0, pidsLimit: 0, runtime: 'in-process', timeoutMs: 0 },
    rpc: { call: (req: RpcCall) => runner.handle({ ...req, id: ++id } as never) } as never,
    destroy: async () => { await runner.shutdown(); },
  } as Sandbox;
}

const rows: string[] = [];
for (const model of models) {
  if (!liveIds.has(model)) { rows.push(`| ${model} | not in live /v1/models | – | – |`); continue; }
  const inference = createInference({ inferenceKey: key, inferenceBaseUrl: baseURL, agentModel: model, ttsModel: 'unused' });
  let gates = 0;
  let stepSecs = 0;
  let stepCount = 0;
  const outcomes: string[] = [];
  for (let t = 0; t < TRIES; t++) {
    const runner = new Runner();
    await runner.handle({ id: 0, m: 'open', url: `${base}/`, patches: [] });
    const t0 = Date.now();
    const r = await runAgent({
      runId: `bake-${model}-${t}`, agent: 'sighted', kind: 'sighted', mode: 'demo', goal: DEMO_GOAL,
      sandbox: inProcessSandbox(runner), inference, storeShot: () => 'x',
      emit: (e) => { if (e.t === 'step' && !e.result.ok) console.log(`  step ${e.index + 1} ${e.action.type} failed: ${e.result.error}`); },
      gate: async () => 'denied', milestonesOf: evaluateMilestones,
    });
    await runner.shutdown();
    const secs = (Date.now() - t0) / 1000;
    if (r.outcome === 'gate') gates++;
    stepSecs += secs;
    stepCount += Math.max(1, r.steps.length);
    outcomes.push(`${r.outcome}@${r.milestones.at(-1) ?? 'start'}`);
    console.log(model, t, r.outcome, r.milestones.join(','), `${secs.toFixed(1)}s`);
  }
  rows.push(`| ${model} | ${gates}/${TRIES} | ${(stepSecs / stepCount).toFixed(1)} | ${outcomes.join(', ')} |`);
}

const ttsRows: string[] = [];
for (const tts of ttsModels) {
  if (!liveIds.has(tts)) { ttsRows.push(`| ${tts} | not in live /v1/models |`); continue; }
  try {
    const inf = createInference({ inferenceKey: key, inferenceBaseUrl: baseURL, agentModel: 'unused', ttsModel: tts });
    const mp3 = await inf.speech('button. button. link. image.');
    writeFileSync(join(scratch, `${tts}.mp3`), mp3);
    ttsRows.push(`| ${tts} | ok, ${mp3.length} bytes |`);
  } catch (e) {
    ttsRows.push(`| ${tts} | failed: ${String((e as Error).message).slice(0, 120)} |`);
  }
}
await app.close();

const md = `# Model bake-off

Run: ${new Date().toISOString()} · sighted agent · demo goal · ${TRIES} tries per model · local store, in-process runner.

| Model | Reached gate | Mean s/step | Outcomes |
|---|---|---|---|
${rows.join('\n')}

| TTS model | Result |
|---|---|
${ttsRows.join('\n')}
`;
writeFileSync(join(process.cwd(), 'docs', 'bakeoff.md'), md);
console.log(md);
