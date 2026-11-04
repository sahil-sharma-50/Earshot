# Earshot UI redesign: make every action visible, understandable and controllable

Date: 2026-11-04 · Status: draft for approval · Scope: `apps/web` (home + run page), small additions in `apps/control` and `packages/shared`

## Intent

The run page today is a dense developer dashboard: three equal columns, raw action strings (`click a19`), raw AX dumps and a findings tray that competes with everything else for attention. A first-time viewer (a hackathon judge, a store owner) cannot tell what is happening, why the two agents differ, what needs them, or what the containment log is protecting.

The redesign turns it into a **live, transparent control center**: at any moment the page answers *what is happening, what happened, what is next, what needs me, and why*. Plain language first, technical evidence one click away. Nothing fake: every control does something real, and every limitation is stated, never simulated.

The owner's full brief (pasted in the session on 2026-11-04) is the authority; this document records how it is met.

## Hackathon fit (non-negotiable)

Judging: Application of Technology · Presentation · Business Value · Originality. Challenge 1 requires a visible **containment moment** and real Vultr usage. The UI must make these legible without narration:

- **Architecture visible in the product.** A phase strip on the run page maps 1:1 to the required "control layer (plan) → isolated execution (dispatch) → verifiable output (return)": *Queue → Agents run in sandboxes → Compare & confirm → Fix → Verify*. Each phase's explainer names the real component (Vultr Cloud Compute VM, gVisor sandbox, Vultr Serverless Inference model calls, egress proxy).
- **Containment is first-class, not a side rail.** A dedicated *Safety* view lists sandbox lifecycle, limits, blocked requests and injection flags with plain explanations. A `containment.blocked` event raises a visible, non-blocking alert on the page (the video's 1:30–2:05 moment) and its row explains what was blocked and why it matters.
- **No secrets in sandbox** stays true; nothing in the UI reveals keys or the access code.
- **The video script** (`docs/video-script.md`) keeps working: Run the demo, two sandboxes created, streaming agents, Blind stalls, finding with WCAG, Listen, Fix & verify, Rerun 1/Rerun 2, injection flag, BLOCKED row, approval → Deny, sandbox destroyed, "Journey verified end to end". Every one of these remains on screen and more readable.
- **Business value** comes through the plain-language finding ("A customer using a screen reader cannot choose a grind, so they cannot buy") and the before/after verification. No new market or legal claims are added to UI copy beyond what exists today.

## Goals

1. A first-time user understands the page without explanation.
2. The user always knows the current phase, each agent's state and the reason for it.
3. The complete execution history of every agent is inspectable, step by step.
4. Findings are understandable without reading HTML or AX output; evidence is available on demand.
5. Consequential actions (approve purchase, Fix & verify, Pause, Stop) are explained before they happen and confirmed after.
6. A restrained, recognizable visual identity: fewer colors, clear hierarchy.
7. Works from 360 px phones to wide desktops.

## Non-goals

- No element highlight boxes drawn over screenshots: step events carry no element coordinates. The screenshot already contains the agent's numbered marks; the detail view says "the agent's marks are drawn into the screenshot" and names the mark the agent used.
- No "next action" prediction: the model decides each step live. We show the **next checkpoint** the agent is heading for (derived from milestones), labelled as such.
- No new run modes, no change to the agents, attribution, fix loop or the demo store.
- No resizable split panes (fixed proportions plus collapsible regions are enough and safer to ship by Nov 8).

## Anti-goals (failure even if it works)

- A button that does nothing, or a state that is simulated (fake progress, fake verified).
- More color, not less. Badges as decoration.
- Hiding the raw evidence a technical judge wants to see.
- Breaking the video flow or slowing the live stream.

## Backend additions (owner decided: real Stop + Pause)

All starter-only, authorized with the existing `x-approval-token`, same as approvals and Fix.

### Pause / Resume
- `POST /api/runs/:id/pause` and `POST /api/runs/:id/resume`.
- Orchestrator holds a per-run pause gate. `runAgent` awaits it at the top of each loop iteration (between steps; an in-flight model call or browser action finishes first).
- **Containment caps are not suspended.** The sandbox hard kill (210 s) keeps running; this is a Blast Radius Zero rule and the UI says so. To keep a pause from killing a run, a pause auto-resumes after **30 s** (builder's call on exact value, ≤ 30 s), and paused time **counts against** the agent's 120 s step budget. The UI shows the auto-resume countdown.
- Pause is only accepted while agents are running (phase `running` or `fixing`, at least one live agent sandbox). Otherwise 409.
- New events: `{ t: 'run.paused'; runId; resumeAt: number }`, `{ t: 'run.resumed'; runId; by: 'user' | 'auto' }`.

### Stop
- `POST /api/runs/:id/stop`. Allowed in any phase except `finished`.
- Sets a per-run abort flag checked with the pause gate; destroys every live sandbox for the run immediately (reason `'stopped'`), clears the fix deadline, resolves any pending approval as denied, and emits `run.finished` with `error: 'Stopped by the person who started this run'` and `verified: false`.
- `DestroyReason` and the `sandbox.destroyed` event gain `'stopped'`; `AgentOutcome` gains `'stopped'`. Queued (not yet started) runs are removed from the queue.

### Focus capture for key presses (cheap, answers "which element got focus")
- After a successful `press` of `Tab` / `Shift+Tab` / arrows, `runAgent` calls the existing `describe` RPC with `target: 'focused'` and puts the identity on `result.element`. Failure is ignored. No new event type.

### Tests
Orchestrator tests for pause gate, auto-resume, stop during running/awaiting-fix/queued, and authorization; route tests for 403/404/409.

## Information architecture: run page

Top to bottom on desktop (≥ 1200 px):

1. **Header bar.** Wordmark · run title ("Demo store run" / "Injection drill" / host for any-url) · the goal truncated with a *Goal* disclosure showing it in full · run controls (Pause/Resume, Stop) for the starter; for others a quiet line "Watching. Only the person who started this run can control it."
2. **Now banner** (one line, `aria-live="polite"`, throttled to one announcement per 3 s): a plain sentence for the current state and a second, muted clause for what happens next. Derived purely from the event stream, e.g.
   - "Waiting for a free sandbox slot (position 2)." → "Your run starts automatically."
   - "Blind agent, step 5: pressed Tab to reach a grind option." → "Next checkpoint: Grind chosen."
   - "**Needs you:** the sighted agent wants to place the order." → button *Review purchase*.
   - "Both agents finished. The blind agent got stuck at Grind chosen; a fresh inspector sandbox is confirming why."
   - "**Needs you:** 1 confirmed finding. Start *Fix & verify* to patch it and rerun the blind agent."
   - "Paused. Resumes automatically in 24 s. Sandbox time caps keep running."
   - Finished: "Journey verified end to end" or the honest failure reason.
   "Needs you" states use the accent color and carry the action button inline.
3. **Phase strip**: Queue · Run agents · Compare & confirm · Fix · Verify, each with done/current/upcoming state and a toggletip explaining what happens there and which Vultr component does it. Fix/Verify show "not needed" when no confirmed finding, "skipped (findings only)" for any-url.
4. **Journey track**: the seven checkpoints as columns, one row per agent (Sighted, Blind, and one row per Rerun when present). Each row shows reached checkpoints and, for an agent that ended early, a stop marker at the checkpoint it could not pass with its outcome in words ("stuck", "out of time"). Where a confirmed finding blocks a checkpoint, the marker links to the finding. Checkpoints are buttons: selecting one opens, in the detail panel, the first step of each agent that reached it (or the blind agent's last step before it, if never reached). This row-per-agent track is also the before/after comparison for fixes.
5. **Main area**, two regions:
   - **Agent lanes** (left, ~60%): Sighted and Blind side by side; when reruns exist, a third lane "Verification" with a segmented control *Rerun 1 · Rerun 2*. Each lane header: agent name and icon, a one-line "what it perceives" ("Sees screenshots, like a sighted shopper" / "Hears the accessibility tree, like a screen-reader user"), state in words + reason (Running · step 5 / Waiting for your approval / Stalled: no progress for 3 steps / Reached Place order), sandbox chip (short id, limits on hover/focus, "destroyed" state). Lane body: compact step rows, newest at the bottom, oldest first (reads like a story); each row = step number, plain-language action, result glyph + word. Rows are buttons that open the step in the detail panel. A **Follow live** toggle per page (default on) keeps the newest step selected and scrolled into view; manually selecting anything turns it off, and a "Jump to live" pill brings it back.
   - **Detail panel** (right, ~40%, sticky): what you selected. Default (nothing selected): **Run overview**, which is the Safety summary (see 7) plus a short "How to read this page" for first-time viewers.
6. **Findings** (below lanes, full width of the main area): header "Findings: where the journeys diverged" with counts by status, *Listen as the blind agent*, and the **Fix & verify** button. Each finding is a row (plain-language title, checkpoint, status) that opens the finding in the detail panel.
7. **Safety** (containment): reachable from a header tab/pill "Safety · 0 blocked" and shown in the Run overview. A chronological list of sandbox created/destroyed, blocked requests, injection flags and approvals, each in plain words with raw details below. Selecting a row opens it in the detail panel with an explanation ("The egress proxy refused a request to 169.254.169.254, the cloud metadata address. Sandboxes can only reach hosts on this run's allowlist.").

### Detail panel views
- **Step**: agent + step n of N with prev/next buttons (and ←/→ keys while the panel has focus). Sections in order: *What the agent did* (plain sentence + raw action), *Why* (the model's own reasoning, labelled "Agent's reasoning"), *Result* (success, or the error in words with the raw code), *Element* (visible text or "unlabeled <tag>", snippet on demand; for key presses the newly focused element when captured), *Checkpoint progress* (any checkpoint reached by this step), *What it perceived*: screenshot for sighted (click to open a lightbox with zoom 1×/2×, Esc closes) or the AX excerpt for blind, with actionable nodes marked by text and weight, not only color. URL of the page.
- **Finding**: plain-language first. *What's wrong* (from failure categories), *Where* (checkpoint + visible element name), *What the sighted agent experienced* (verb + element + step link), *What the blind agent experienced* (rendered AX excerpt as a readable list + step link), *Why it matters* (category → fixed explanation of user impact), *Guidelines* (WCAG SC with names + axe rule links), *How to fix* (category → standard remediation text; once a patch exists, the real attribute patch and diff), *Status timeline*: Found → Confirmed by inspector → Fix proposed (attempt n) → Verified / Not verified. *Evidence on demand*: snippet, sighted screenshot at the evidence step, Listen to this region. Inconclusive findings are visibly separate and say why ("agent error, not counted").
- **Safety event**: plain explanation + raw fields.
- **Status explainer**: clicking any state label (lane state, outcome, phase) opens a short explanation of what it means and why it happened, from a fixed glossary keyed by outcome/phase.

### Consequential action dialogs
- **Approve purchase** (existing modal, rewritten): What is requested (agent + element in words, snippet on demand) · Why approval is needed (purchases always need a human) · If approved (a demo order is placed; nothing is charged) · If denied or no answer in 60 s (no order; reaching this button already counts as completing the journey) · countdown. Deny is the default focus.
- **Fix & verify**: confirm dialog explaining: Earshot asks Vultr Serverless Inference for an attribute-only patch, applies it to the demo store inside a fresh sandbox, and reruns the blind agent; up to 2 attempts per finding; the live store is not changed. Shows which findings will be fixed.
- **Stop**: confirm dialog ("Agents stop after their current action, all sandboxes are destroyed, the run is marked stopped. This can't be undone.").
- **Pause** needs no confirmation; feedback is the Now banner and the button switching to Resume.
After each action: the Now banner reflects it within one event, and errors appear inline next to the control that failed.

### First-use guidance
- A dismissible 3-point "How to read this page" card in the Run overview (dismissal remembered per browser with try/catch'd `localStorage`): the two agents, the journey track, findings and safety.
- Toggletips (ⓘ buttons, keyboard and touch accessible, not hover-only) next to section titles: Journey, Findings, Safety, each phase.
- Empty states say what will appear and when ("Steps appear here as soon as the blind agent's sandbox starts.").

## Information architecture: home page

Keeps the product truth and launch functions (Demo store, Injection drill, Any URL with access code). Order:
1. Hero: headline and lede (existing copy), launch panel beside it.
2. **Same page, different senses**: the existing sighted-vs-blind grind picker specimen.
3. **What happens when you press Run**: four steps matching the phase strip (two sandboxed agents on a Vultr VM → compare → confirm with an inspector → fix & verify), each naming the real component. Text plus small line icons, not a card grid.
4. **Contained by design**: one compact section stating the containment guarantees already true today (gVisor, no secrets, caps, egress proxy, destroyed after each run).
Footer line: Vultr Cloud Compute · Vultr Serverless Inference.

## Visual identity

- **Color, reduced.** Neutral near-black surfaces (current tokens). Text in two levels plus muted. **One accent** (current orange) reserved for *needs you* states, primary actions and focus. Agent identity uses **shape and icon first** (eye vs ear glyph, filled dot vs ring on the journey track) with a single subdued hue each: sighted a desaturated blue-grey, blind the text color with the ear glyph. No green pills, no orange chips, no colored text runs. Semantic red only for blocked/failed, never as a fill larger than a small glyph or a 1 px border. Success is a check glyph plus words in normal text color.
- **Type.** Inter for UI, Sora 600/700 for the few headings, JetBrains Mono only for raw evidence (snippets, AX, diffs, ids). Minimum UI text 13 px; body 15–16 px.
- **Surfaces.** Structure from spacing and two surface levels, few borders. No cards inside cards: lanes and lists are rows separated by spacing or one hairline.
- **States.** Every interactive element has hover, focus-visible (accent ring), active, selected (raised surface + accent indicator), disabled and loading. Informational text never looks like a link.
- **Motion.** One subtle row entrance for new steps, panel content crossfade, reduced-motion respected. No pulsing decoration except the single live indicator.

## Responsive behavior

- ≥ 1200 px: layout as described.
- 768–1199 px: journey track full width; lanes become a segmented control (Sighted · Blind · Verification) showing one lane at a time; detail panel becomes a right drawer over the content.
- < 768 px: header controls collapse into a menu; journey track scrolls horizontally inside itself with sticky row labels; detail panel is a full-screen sheet with a clear Back button. No page-level horizontal scroll.

## Accessibility (this is an accessibility product)

All controls are real buttons/links with names; the detail panel is a labelled region that receives focus on open (drawer/sheet traps focus and returns it on close); the Now banner is a polite live region; color is never the only signal; contrast ≥ 4.5:1 for text; full keyboard operation including the lightbox and journey checkpoints.

## Data and code shape (builder's guidance, not prescriptive)

- New pure derivations in `apps/web/src` (unit-tested with vitest): `phaseOf(view)`, `nowLine(view, isStarter)`, `agentState(view, id)`, `plainAction(step)`, finding plain-language mapping (`CATEGORY_EXPLAIN`: what's wrong / why it matters / how to fix per `FailureCategory`), outcome/phase glossary.
- `reduce.ts` gains `paused?: { resumeAt }` and handles `run.paused`/`run.resumed`; the `'stopped'` outcome/reason flows through existing paths.
- Selection state (what the detail panel shows, follow-live) lives in the Run page; it is UI state only.
- Existing components are replaced as needed; no new runtime dependencies beyond what is installed.

## Left to the builder

Exact spacing scale, icon choices within lucide, the sighted hue value, toggletip implementation, auto-resume duration (≤ 30 s), glossary wording (plain, factual, no new claims), and the internal component split.

## Builder-check resolutions (Claude's calls)

1. **Stop is immediate.** It destroys live sandboxes at once (in-flight RPCs fail fast and the agent loop ends via its existing error path, outcome mapped to `'stopped'`), sets an abort flag that attribution and the fix loop check at stage boundaries (no signal threading into RPCs), and emits `run.finished` immediately. After stop, the bus drops further events for that run except `sandbox.destroyed`. Dialog copy: "Agents stop now and all sandboxes are destroyed."
2. **Server sends the phase.** New event `{ t: 'run.phase'; runId; phase: RunPhase; fixDeadlineAt?: number }` on every phase change, so late joiners replay it. The phase strip maps `queued→Queue`, `running→Run agents`, inspector sandbox present while `running` ends → `Compare & confirm` (derived from the inspector sandbox events), `awaiting-fix`/`fixing→Fix`, rerun agents → `Verify`.
3. **Unconfirmed findings** are shown as "Not confirmed" with generic, true wording: "The inspector could not confirm a defect on this element, so it isn't counted." No new backend field.
4. **Any URL runs** show the journey track collapsed to two checkpoints: Start → Submit (`awaiting_final_approval`). The "next checkpoint" line uses the same two points.
5. **Fix wait is visible.** `run.phase` with `awaiting-fix` carries `fixDeadlineAt`. The Now banner shows "Fix & verify available for mm:ss". Fix & verify keeps its confirm dialog (one extra click, acceptable).
6. **The calls below are adopted** (owner said proceed).
7. **Countdowns use server epoch timestamps** (`resumeAt`, `fixDeadlineAt`, approval `requestedAt`) and the client clock. Skew of a few seconds is acceptable for a demo.

## Calls made by Claude (owner to check)

- Paused time counts against the agent's step budget and the sandbox hard cap is never suspended (containment over convenience).
- Auto-resume after ≤ 30 s.
- Steps listed oldest-first (story order) with follow-live, replacing today's newest-first.
- Agent colors reduced to near-neutral; orange kept only for "needs you", primary actions and focus.
- No highlight overlays on screenshots (no coordinates in the data).
