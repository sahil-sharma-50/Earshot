import { randomBytes } from 'node:crypto';
import type { AgentId, AxNodeView, Finding, RunEvent, RunMode } from '@earshot/shared';
import type { AgentResult } from '../agents/loop.js';
import type { RunLifecycle } from './lifecycle.js';

import type { RunPhase } from '@earshot/shared';
export type { RunPhase };

export interface RunRecord {
  id: string;
  mode: RunMode;
  goal: string;
  startUrl: string;
  allowHosts: string[];
  createdAt: number;
  phase: RunPhase;
  events: RunEvent[];
  shots: Map<string, Buffer>;
  lastAx: Map<AgentId, AxNodeView[]>;
  findings: Finding[];
  seenInjectionTexts: Set<string>;
  sighted?: AgentResult;
  firstFinding?: Finding;
  /** Phase transitions, pause/stop, fix deadline and live sandboxes; attached when the run starts. */
  lifecycle?: RunLifecycle;
}

const MAX_RUNS = 50;
const MAX_SHOTS_PER_RUN = 120;

/** In-memory LRU of the last 50 runs: events, screenshots, last AX excerpts. */
export class RunStore {
  private runs = new Map<string, RunRecord>();

  create(spec: { mode: RunMode; goal: string; startUrl: string; allowHosts: string[] }): RunRecord {
    const id = randomBytes(6).toString('hex');
    const run: RunRecord = {
      id, ...spec, createdAt: Date.now(), phase: 'queued', events: [], shots: new Map(), lastAx: new Map(),
      findings: [], seenInjectionTexts: new Set(),
    };
    this.runs.set(id, run);
    this.evict();
    return run;
  }

  get(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  addShot(runId: string, png: Buffer): string {
    const run = this.runs.get(runId);
    const shotId = randomBytes(6).toString('hex');
    if (!run) return shotId;
    run.shots.set(shotId, png);
    while (run.shots.size > MAX_SHOTS_PER_RUN) run.shots.delete(run.shots.keys().next().value!);
    return shotId;
  }

  private evict(): void {
    if (this.runs.size <= MAX_RUNS) return;
    for (const [id, r] of this.runs) {
      if (this.runs.size <= MAX_RUNS) break;
      if (r.phase === 'finished' || r.phase === 'awaiting-fix') {
        r.lifecycle?.dispose();
        this.runs.delete(id);
      }
    }
  }
}
