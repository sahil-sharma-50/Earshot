# Earshot UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the run page into a transparent, controllable, plain-language control center (with real Pause/Stop), and align the home page with it.

**Architecture:** Backend adds a per-run `RunControl` (pause gate + stop flag) owned by the orchestrator, three starter-only routes, and three events (`run.phase`, `run.paused`, `run.resumed`). The web app keeps the event-fold model (`reduce.ts`); all plain-language text comes from pure, unit-tested derivations in `narrative.ts`; components only render view + selection state.

**Tech Stack:** TypeScript, Fastify, Vitest, React 19, Vite, lucide-react, Inter / Sora / JetBrains Mono (already installed). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-earshot-ui-redesign-design.md`

## Global Constraints

- No fake controls or simulated state: every button calls a real endpoint or changes real UI state; limitations are stated in copy.
- Starter-only controls authorize with header `x-approval-token` via `approvals.checkToken`, same as `/fix`.
- Sandbox hard cap (`AGENT_SANDBOX_TIMEOUT_MS = 210_000`) is never suspended or extended. Paused time counts against the agent's 120 s budget.
- Pause auto-resumes after `PAUSE_MAX_MS = 30_000`.
- Stop is immediate. Dialog copy: "Agents stop now and all sandboxes are destroyed." `run.finished.error` = `'Stopped by the person who started this run'`.
- Colors: tokens in `apps/web/src/styles.css` only. Accent `--accent` is used solely for "needs you" states, primary actions, selection indicator and focus. No colored pills/chips. Red only for small failure glyphs or 1 px borders. Sighted hue `--sighted: #8ea4c8`; blind uses `--text` + ear glyph.
- Type: Inter (UI), Sora 600/700 (headings only), JetBrains Mono only for snippets, AX, diffs, ids. Minimum UI text 13 px.
- Copy: plain language, no new market or legal claims.
- Accessibility: real buttons/links, focus-visible ring, polite live region for the Now banner (≤ 1 announcement / 3 s), color never the only signal, Esc closes overlays, focus returns to the opener.
- Breakpoints: ≥ 1200 full layout; 768–1199 one lane at a time + drawer; < 768 full-screen sheet, no page-level horizontal scroll.
- Keep `docs/video-script.md` flow working: two sandboxes created, streaming steps, Blind stalls, finding with WCAG, Listen, Fix & verify, Rerun 1/2, injection flag, BLOCKED row, approval → Deny, sandbox destroyed, "Journey verified end to end".

## Review Focus

- Late joiner (opens the run URL after it finished, or mid-pause): the replayed `run.phase` / `run.paused` events must leave the view in the correct current state, not "paused" forever. (Task 5 test: replay paused→resumed and paused-only-with-`resumeAt`-in-the-past.)
- Stop while an approval dialog is open: the pending approval must resolve (denied) and the dialog close. (Task 2 test + Task 12 UI.)
- Viewer who is not the starter: no Pause/Stop/Fix/Approve controls render; an explanatory line does. (Task 8 test on `controlsFor(view, isStarter)`.)
- Any URL run with empty milestones: journey track renders two checkpoints, nowLine never says "undefined". (Task 6 tests.)
- Step with `result.ok === false` and an unknown error code: plain text falls back to the raw code, never blank. (Task 6 test.)

---

### Task 1: Shared event and outcome types

**Files:**
- Modify: `packages/shared/src/types.ts` (RunEvent union, `AgentOutcome`)
- Modify: `apps/control/src/sandbox/docker.ts:8` (`DestroyReason`)
- Modify: `apps/web/src/labels.ts` (`OUTCOME_LABEL` gets `stopped: 'Stopped'`)

**Interfaces:**
- Produces:
  - `export type RunPhase = 'queued' | 'running' | 'awaiting-fix' | 'fixing' | 'finished'` moved to shared (re-export from `apps/control/src/runs/store.ts`).
  - `AgentOutcome` adds `'stopped'`; `sandbox.destroyed.reason` and `DestroyReason` add `'stopped'`.
  - New `RunEvent` members:
    - `{ t: 'run.phase'; runId: string; phase: RunPhase; fixDeadlineAt?: number }`
    - `{ t: 'run.paused'; runId: string; resumeAt: number }`
    - `{ t: 'run.resumed'; runId: string; by: 'user' | 'auto' }`

- [ ] **Step 1:** Make the type changes.
- [ ] **Step 2:** Run `pnpm -r exec tsc --noEmit -p tsconfig.json` (or each app's typecheck). Expected: only errors are exhaustive-switch/Record gaps; fix `OUTCOME_LABEL`. Then PASS.
- [ ] **Step 3:** Commit `feat(shared): run phase, pause/resume events, stopped outcome`.

### Task 2: RunControl and orchestrator pause/stop

**Files:**
- Create: `apps/control/src/runs/control.ts`
- Modify: `apps/control/src/runs/store.ts` (RunRecord gains `control: RunControl`)
- Modify: `apps/control/src/runs/orchestrator.ts`
- Modify: `apps/control/src/agents/loop.ts` (AgentContext gains `checkpoint?: () => Promise<void>`)
- Modify: `apps/control/src/runs/events.ts` (drop events after stop)
- Modify: `apps/control/src/runs/approval.ts` (add `denyAll(runId)`)
- Modify: `apps/control/src/runs/queue.ts` (add `remove(runId): boolean`)
- Test: `apps/control/test/control.test.ts`, `apps/control/test/orchestrator.test.ts`

**Interfaces:**
- Produces:
  - `class StoppedError extends Error`
  - `class RunControl { constructor(emit: (e: RunEvent) => void, runId: string, maxPauseMs = PAUSE_MAX_MS); readonly stopped: boolean; readonly paused: boolean; pause(): boolean; resume(by: 'user' | 'auto'): boolean; stop(): void; checkpoint(): Promise<void> }`. `checkpoint()` throws `StoppedError` if stopped, awaits while paused, then throws if stopped during the pause. `pause()` emits `run.paused` with `resumeAt = Date.now() + maxPauseMs` and arms the auto-resume timer; returns false if already paused/stopped. `stop()` releases waiters.
  - `export const PAUSE_MAX_MS = 30_000`
  - `Orchestrator.pauseRun(runId, token): ControlResult`, `resumeRun(runId, token): ControlResult`, `stopRun(runId, token): Promise<ControlResult>` where `type ControlResult = 'ok' | 'not-found' | 'not-allowed' | 'not-ready'`.
  - `Orchestrator` private `setPhase(run, phase, fixDeadlineAt?)` emits `run.phase` and sets `run.phase`; used everywhere `run.phase` is assigned today (queued on start, running, awaiting-fix with `fixDeadlineAt`, fixing, finished in `finish`).
  - `Approvals.denyAll(runId): void` finishes every pending approval of the run with `'denied'`.
  - `RunQueue.remove(runId): boolean` removes a waiting (not running) job.
- Rules: pause/resume allowed only when `run.phase` is `running` or `fixing` and `run.live.size > 0`; else `not-ready`. Stop allowed unless `finished`. `stopRun`: `control.stop()`, `queue.remove`, `approvals.denyAll`, destroy every `run.live` sandbox with `'stopped'` (in parallel, errors swallowed), clear `fixDeadline`, `finish(run, false, 'Stopped by the person who started this run')`. `runOne` maps a `StoppedError` (or any error while `control.stopped`) to outcome `'stopped'` and does not throw. `executeRun`/`executeFix` call `run.control.checkpoint()` between stages and return quietly when stopped. `RunBus.publish` drops events for a run whose `control.stopped` is true unless `e.t` is `sandbox.destroyed` or `run.finished`.

- [ ] **Step 1: Write failing tests** in `control.test.ts` (fake timers):
  - `pause then checkpoint waits until resume('user')` → emits `run.paused` then `run.resumed { by: 'user' }`.
  - `pause auto-resumes after 30_000 ms` → `run.resumed { by: 'auto' }`.
  - `stop releases a paused checkpoint with StoppedError`.
  - `pause returns false when already paused or stopped`.
  In `orchestrator.test.ts`:
  - `stopRun while agents run destroys live sandboxes with reason stopped and finishes with the stop error` (runAgentFn awaits `ctx.checkpoint` in a loop).
  - `stopRun resolves a pending approval as denied`.
  - `stopRun on a queued run removes it and finishes`.
  - `pauseRun returns not-ready when phase is awaiting-fix`; `returns not-allowed with a wrong token`.
  - `run.phase events are emitted in order queued, running, awaiting-fix (with fixDeadlineAt), fixing, finished`.
  - `events after stop are dropped except sandbox.destroyed and run.finished`.
- [ ] **Step 2:** Run `pnpm --filter control exec vitest run test/control.test.ts test/orchestrator.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per Interfaces. In `runAgent`, call `await ctx.checkpoint?.()` at the top of each loop iteration before the wall-clock check; catch `StoppedError` → `outcome = 'stopped'`, skip the error step event.
- [ ] **Step 4:** Run all control tests: `pnpm --filter control exec vitest run`. Expected: PASS (existing tests unchanged).
- [ ] **Step 5:** Commit `feat(control): real pause/resume/stop with phase events`.

### Task 3: Control routes

**Files:**
- Modify: `apps/control/src/http/routes.ts`
- Test: `apps/control/test/routes.test.ts`

**Interfaces:**
- Consumes: `Orchestrator.pauseRun/resumeRun/stopRun` (Task 2).
- Produces: `POST /api/runs/:id/pause`, `/resume`, `/stop`. Status codes: ok 200 `{ status }`, not-found 404, not-allowed 403 `{ error: 'only the person who started this run can control it' }`, not-ready 409. Rate limit 20/min each.

- [ ] **Step 1:** Failing tests: 404 unknown run; 403 without token; 200 pause on a running run; 409 pause on a finished run; 200 stop.
- [ ] **Step 2:** Run `pnpm --filter control exec vitest run test/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, mirroring the `/fix` handler.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(control): pause, resume and stop routes`.

### Task 4: Capture the focused element after key presses

**Files:**
- Modify: `apps/control/src/agents/loop.ts`
- Test: `apps/control/test/loop.test.ts`

**Interfaces:**
- Produces: for `action.type === 'press'` with key in `Tab | Shift+Tab | ArrowUp | ArrowDown | ArrowLeft | ArrowRight` and `result.ok`, `result.element` = `describe({ target: 'focused' })` result; describe failure leaves it undefined.

- [ ] **Step 1:** Failing test `press Tab records the focused element on the step result` (fake rpc returns an identity for `describe`).
- [ ] **Step 2:** Run `pnpm --filter control exec vitest run test/loop.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement (one extra RPC after `act`, `.catch(() => null)`).
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(agents): record focus target after key presses`.

### Task 5: Web API and reducer

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/reduce.ts`
- Test: `apps/web/test/reduce.test.ts`

**Interfaces:**
- Produces:
  - `pauseRun(runId: string): Promise<unknown>`, `resumeRun(runId)`, `stopRun(runId)` via existing `call()` with the token header.
  - `RunView` gains `phase?: RunPhase`, `fixDeadlineAt?: number`, `paused?: { resumeAt: number }`, `stopped?: boolean` (set when `run.finished.error` equals the stop error).
  - `reduce` handles `run.phase` (sets `phase`, `fixDeadlineAt` only when phase is `awaiting-fix`, else clears), `run.paused`, `run.resumed` (clears `paused`), `run.finished` (clears `paused`).
  - `isPaused(view: RunView, now: number): boolean` → `!!view.paused && view.paused.resumeAt > now && !view.finished`.

- [ ] **Step 1:** Failing tests: phase sequence; `run.paused` then `run.resumed` → not paused; replay of `run.paused` with `resumeAt` in the past → `isPaused` false; `run.finished` with stop error → `stopped: true`.
- [ ] **Step 2:** Run `pnpm --filter web exec vitest run`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(web): pause/stop api and phase-aware reducer`.

### Task 6: Plain-language derivations

**Files:**
- Create: `apps/web/src/narrative.ts`
- Test: `apps/web/test/narrative.test.ts`

**Interfaces:**
- Consumes: `RunView`, `isPaused` (Task 5); `MILESTONE_LABEL`, `agentName`, `actionText` (labels.ts).
- Produces:
  - `type PhaseKey = 'queue' | 'agents' | 'compare' | 'fix' | 'verify'`; `phaseSteps(view): { key: PhaseKey; label: string; state: 'done' | 'current' | 'upcoming' | 'skipped'; note?: string }[]`. Labels: Queue, Run agents, Compare & confirm, Fix, Verify. `compare` is current while an `inspector` sandbox is live or after both agents finished and no `run.phase` beyond `running`. Fix/Verify `skipped` with note "Not needed" when finished without a confirmed finding, "Findings only" for `any-url`.
  - `checkpointsFor(mode: RunMode): { id: MilestoneId; label: string }[]` → 7 demo milestones, or `[{ id: 'on_product_page', label: 'Start' }, { id: 'awaiting_final_approval', label: 'Submit' }]` for `any-url`.
  - `nextCheckpoint(view, agent): string | null`.
  - `plainAction(step: StepEvent): string`: e.g. click with `result.element` → `Clicked “Whole bean”`; unlabeled → `Clicked an unlabeled div`; type → `Typed “…” into …`; press → `Pressed Tab` + ` (focus moved to “X”)` when element present; scroll/navigate/done/stuck plain sentences; no element → falls back to `actionText`.
  - `plainResult(step): { ok: boolean; text: string }`: known codes `not-actionable` → "That element can't be operated", `unknown-target` → "The agent pointed at something that isn't on the page", `timeout` → "The page didn't respond in time", `navigation-blocked` → "Leaving the store is blocked", `approval-denied` / `approval-timeout` → "Purchase not approved", `approval-approved`… ; unknown → the raw code.
  - `agentState(view, agent): { label: string; reason: string; tone: 'live' | 'waiting' | 'done' | 'failed' | 'idle' }`. Covers: no sandbox yet ("Starting", "Waiting for a sandbox"), running ("Running · step n", "Heading for <next checkpoint>"), waiting approval, paused, each `AgentOutcome` with a reason sentence (e.g. `no-progress`: "Stalled: three actions in a row changed nothing on the page").
  - `nowLine(view, isStarter, now): { text: string; next?: string; needsYou?: 'approval' | 'fix'; }` covering every state listed in the spec's Now banner section; for non-starters "needs you" states read as "Waiting for the person who started this run to …".
  - `CATEGORY_EXPLAIN: Record<FailureCategory, { wrong: string; impact: string; fix: string }>` (plain, factual).
  - `GLOSSARY: Record<string, string>` for each phase, outcome and "checkpoint", "sandbox", "egress proxy", "accessibility tree".
  - `findingTitle(f: Finding): string` → e.g. "Grind options can't be chosen without sight" built from categories + checkpoint label; unconfirmed → "Not confirmed: …".

- [ ] **Step 1:** Failing tests (one per bullet above, plus Review Focus items: any-url empty milestones; unknown error code falls back to raw code; non-starter wording; paused line shows seconds left).
- [ ] **Step 2:** Run `pnpm --filter web exec vitest run test/narrative.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(web): plain-language narrative derivations`.

### Task 7: Tokens and shared UI primitives

**Files:**
- Modify: `apps/web/src/styles.css` (rewrite tokens and base; remove obsolete run-page rules as their components are replaced in later tasks)
- Create: `apps/web/src/ui/Dialog.tsx`, `apps/web/src/ui/Toggletip.tsx`, `apps/web/src/ui/Countdown.tsx`

**Interfaces:**
- Produces:
  - `<Dialog open title onClose initialFocus? children actions>` on native `<dialog>` with `showModal`, Esc to close (unless `dismissible={false}`), focus return to opener.
  - `<Toggletip label="About the journey">{text}</Toggletip>`: an ⓘ button toggling a popover, closes on Esc/outside click, `aria-expanded`, content in a `role="status"` region.
  - `<Countdown to={epochMs} />` renders `m:ss` / `Ns`, ticks every 250 ms, `aria-hidden` (the live region carries the text).
  - Tokens: `--bg #0a0a0a`, `--surface #111`, `--surface-2 #171717`, `--raised #1f1f1f`, `--line #222`, `--text #ededed`, `--text-2 #b4b4bb`, `--muted #8b8b94`, `--accent #f97316`, `--accent-ink #0a0a0a`, `--sighted #8ea4c8`, `--danger #f05252`. Remove `--rerun*`, `--ok-dim`, `--blind-dim`, colored badge/chip rules.
- [ ] **Step 1:** Implement primitives and tokens.
- [ ] **Step 2:** `pnpm --filter web build`. Expected: PASS.
- [ ] **Step 3:** Commit `feat(web): design tokens and dialog/toggletip/countdown primitives`.

### Task 8: Run shell: header, controls, Now banner, phase strip

**Files:**
- Create: `apps/web/src/run/RunHeader.tsx`, `apps/web/src/run/NowBanner.tsx`, `apps/web/src/run/PhaseStrip.tsx`, `apps/web/src/run/controls.ts`
- Modify: `apps/web/src/pages/Run.tsx` (new layout skeleton: header, now, phases, journey slot, main grid with lanes + detail, findings, safety)
- Test: `apps/web/test/controls.test.ts`

**Interfaces:**
- Consumes: Task 5 API + `isPaused`; Task 6 `nowLine`, `phaseSteps`, `GLOSSARY`; Task 7 primitives.
- Produces: `controlsFor(view, isStarter, now): { pause: boolean; resume: boolean; stop: boolean; note?: string }` (non-starter → all false, note "Watching. Only the person who started this run can control it."). Stop opens a Dialog with the spec copy. Errors render inline next to the control. Header also has: run title by mode ("Demo store run" / "Injection drill" / target host), the goal in a `Goal` disclosure button, and a `Safety · N blocked` button that selects the overview. NowBanner: `aria-live="polite"`, re-announces at most every 3 s, "needs you" variant shows the inline action button (`Review purchase` focuses/opens the approval dialog; `Start Fix & verify` opens the fix dialog from Task 12). Phase strip items have Toggletips with `GLOSSARY` text naming Vultr Cloud Compute, gVisor, Vultr Serverless Inference, egress proxy where true.
- [ ] **Step 1:** Failing tests for `controlsFor` (starter running → pause+stop; paused → resume+stop; finished → none; non-starter → none + note).
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run `pnpm --filter web exec vitest run && pnpm --filter web build`, expect PASS.
- [ ] **Step 5:** Commit `feat(web): run header controls, now banner and phase strip`.

### Task 9: Journey track

**Files:**
- Create: `apps/web/src/run/JourneyTrack.tsx`
- Test: `apps/web/test/journey.test.ts` (for the pure helper)

**Interfaces:**
- Consumes: `checkpointsFor`, `agentState`, `reruns`, findings.
- Produces: `journeyRows(view): { agent: AgentId; reached: number; endedAt?: { index: number; outcome: AgentOutcome }; blockedBy?: string /* finding id */ }[]` in order sighted, blind, rerun-1…; and `<JourneyTrack view onSelectCheckpoint(id: MilestoneId) onSelectFinding(id) />`. Rows: label (icon + name), filled dot = reached (sighted filled, blind ring-to-filled via shape not hue), stop marker + outcome word at the first unreached checkpoint of an ended agent, finding link when a confirmed finding's milestone equals that checkpoint. Checkpoint column headers are buttons. A Toggletip explains the track.
- [ ] **Step 1:** Failing tests for `journeyRows` (blind stalled at grind with finding; rerun rows ordered; any-url two columns).
- [ ] **Step 2–4:** FAIL → implement → PASS (+ build).
- [ ] **Step 5:** Commit `feat(web): journey track`.

### Task 10: Agent lanes, selection and follow-live

**Files:**
- Create: `apps/web/src/run/selection.ts`, `apps/web/src/run/AgentLane.tsx`
- Delete: `apps/web/src/components/AgentColumn.tsx`, `apps/web/src/components/MilestoneBar.tsx`
- Modify: `apps/web/src/pages/Run.tsx`
- Test: `apps/web/test/selection.test.ts`

**Interfaces:**
- Produces:
  - `type Selection = { kind: 'overview' } | { kind: 'step'; agent: AgentId; index: number } | { kind: 'finding'; id: string } | { kind: 'event'; i: number } | { kind: 'status'; key: string }`.
  - `useSelection(view)` returning `{ sel, select(s: Selection), follow: boolean, setFollow(b) }`; when `follow` is true, each new `step` event selects that step; any manual `select` sets `follow=false`.
  - `latestStep(view): { agent: AgentId; index: number } | null`.
  - `stepAtCheckpoint(view, agent, id: MilestoneId): number | null` (first step whose `milestones` includes `id`, else the agent's last step if it never reached it).
  - `<AgentLane id view selected onSelect />`: header (icon, name, perceives line, `agentState` label as a button opening the status explainer, sandbox chip with limits in a Toggletip), steps oldest-first as buttons `[n] plainAction · result glyph+word`, selected row raised with accent indicator, empty state text from spec. A "Verification" lane wraps rerun lanes with a segmented control when reruns exist. "Jump to live" pill when `follow=false` and the run is live.
- [ ] **Step 1:** Failing tests for `latestStep`, `stepAtCheckpoint`, and the follow-live reducer logic (pure function `nextSelection(prev, view, follow)`).
- [ ] **Step 2–4:** FAIL → implement → PASS (+ build).
- [ ] **Step 5:** Commit `feat(web): agent lanes with selection and follow-live`.

### Task 11: Detail panel

**Files:**
- Create: `apps/web/src/run/DetailPanel.tsx`, `apps/web/src/run/StepDetail.tsx`, `apps/web/src/run/FindingDetail.tsx`, `apps/web/src/run/EventDetail.tsx`, `apps/web/src/run/Overview.tsx`, `apps/web/src/run/Lightbox.tsx`
- Delete: `apps/web/src/components/FindingCard.tsx`

**Interfaces:**
- Consumes: `Selection`, narrative helpers, `shotUrl`, `ListenButton`, `wcagUrl`.
- Produces: `<DetailPanel view sel onSelect runId />` (labelled region `aria-label="Details"`, moves focus to its heading on selection change except under follow-live). StepDetail sections and order exactly as the spec "Step" bullet, prev/next buttons + ←/→ when focus is inside. FindingDetail sections exactly as the spec "Finding" bullet, using `CATEGORY_EXPLAIN`, fix attempts from `view.fixes`, status timeline Found → Confirmed by inspector → Fix proposed (attempt n) → Verified / Not verified. EventDetail: explanation per rail event type + raw fields. Overview: first-use card (dismiss stored under `earshot:intro-dismissed`, try/catch), safety summary (live/destroyed sandboxes, limits, blocked count, injection flags) and the Safety list (Task 12). Lightbox: native dialog, 1×/2× zoom toggle, Esc closes.
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `pnpm --filter web build` PASS.
- [ ] **Step 3:** Commit `feat(web): detail panel for steps, findings, events and overview`.

### Task 12: Findings, Fix dialog, Safety log, approval dialog

**Files:**
- Create: `apps/web/src/run/Findings.tsx`, `apps/web/src/run/SafetyLog.tsx`, `apps/web/src/run/FixDialog.tsx`
- Modify: `apps/web/src/components/ApprovalModal.tsx`
- Delete: `apps/web/src/components/ContainmentRail.tsx`

**Interfaces:**
- Produces:
  - `<Findings view isStarter onSelect />`: header "Findings: where the journeys diverged", Toggletip, counts by status in words, Listen as the blind agent, `Start Fix & verify` (opens FixDialog; enabled per existing `canFix` rule; shows `fixDeadlineAt` countdown). Rows = `findingTitle` + checkpoint + status text; unconfirmed grouped under "Not confirmed".
  - `<FixDialog>`: copy per spec (Vultr Serverless Inference, attribute-only patch, fresh sandbox, rerun blind agent, up to 2 attempts per finding, live store unchanged) listing the confirmed findings; confirm calls `startFix`.
  - `<SafetyLog events onSelect />`: plain one-line per event (e.g. "Blocked: request to 169.254.169.254 (cloud metadata address)"), raw line in mono below; a new `containment.blocked` shows a non-modal alert bar "Containment blocked a request from the <agent> sandbox" with a `View` button selecting it; alert auto-hides after 10 s, stays in the log.
  - ApprovalModal: four labelled sections (What's requested, Why you're asked, If you approve, If you deny or don't answer), Deny has initial focus, countdown; closes when the approval resolves (including via Stop). Non-starter banner copy unchanged in meaning.
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `pnpm --filter web build` PASS.
- [ ] **Step 3:** Commit `feat(web): findings list, fix dialog, safety log, approval explanations`.

### Task 13: Responsive layout

**Files:**
- Modify: `apps/web/src/styles.css`, `apps/web/src/pages/Run.tsx`, `apps/web/src/run/DetailPanel.tsx`

**Interfaces:**
- Produces: `useMedia(query: string): boolean` in `apps/web/src/ui/useMedia.ts`. 768–1199: lanes shown one at a time with a segmented control (Sighted · Blind · Verification); DetailPanel renders inside a right drawer (`Dialog` variant `drawer`) opened on selection. < 768: header controls in a menu button; journey track scrolls inside itself with sticky row labels; DetailPanel is a full-screen sheet with a Back button. Follow-live never auto-opens the drawer/sheet.
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Build PASS; in the browser at 390, 900 and 1440 widths `document.documentElement.scrollWidth <= innerWidth`.
- [ ] **Step 3:** Commit `feat(web): responsive run page`.

### Task 14: Home page

**Files:**
- Modify: `apps/web/src/pages/Home.tsx`, `apps/web/src/styles.css`

**Interfaces:**
- Produces: sections in spec order: hero + launch panel (unchanged functions), "Same page, different senses" specimen (existing), "What happens when you press Run" (four steps matching phase labels, each naming the real component), "Contained by design" (gVisor, no secrets in the sandbox, memory/CPU/pids/time caps, egress proxy allowlist, destroyed after each run), footer "Vultr Cloud Compute · Vultr Serverless Inference". Colors per Global Constraints (accent only on the primary button and headline highlight).
- [ ] **Step 1:** Implement. **Step 2:** Build PASS. **Step 3:** Commit `feat(web): home page explains the run before it starts`.

### Task 15: End-to-end verification

- [ ] **Step 1:** `pnpm -r exec vitest run` → all PASS; `pnpm --filter web build` → PASS.
- [ ] **Step 2:** Local preview against the live backend (temporary Vite config proxying `/api` to `https://104-238-159-1.sslip.io`, not committed). Run one demo: verify Now banner text through every phase, Pause → banner + countdown → Resume, journey track divergence, step detail (screenshot lightbox, AX), finding detail, approval dialog → Deny, keyboard-only pass, 390/900/1440 widths. Stop is verified only after the backend is redeployed (Step 3).
- [ ] **Step 3:** Ask the owner before redeploying (`bash infra/deploy.sh 104.238.159.1`); after deploy, run one demo and use Stop; confirm sandboxes destroyed in Safety.
- [ ] **Step 4:** Update README UI section if it describes the old columns; commit.
