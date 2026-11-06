# Glossary

Domain terms used in code, docs and architecture reviews. Use these names for modules and seams.

- **Run**: one Earshot job. A sighted and a blind agent attempt the same goal in separate sandboxes. Earshot attributes where they diverge and, in demo mode, fixes and verifies the divergence.
- **Run mode**: `demo | drill | any-url`. The **run mode policy** (`packages/shared/src/modes.ts`, `modePolicy(mode)`) is the only place that knows how modes differ: the checkpoints and their labels, how many an agent reached, what triggers the approval gate, what counts as success, whether findings can be fixed, and how the divergence is found. Control and web ask it; neither branches on the mode for journey semantics. (Admission rules such as the any-url target check stay in the routes.)
- **Checkpoint**: a point in the journey that viewers see. Demo and drill have the seven store milestones. Any-url has two: Start (first step) and Submit (the gate).
- **Run phase**: where a run is: `queued → running → awaiting-fix ⇄ fixing → finished`. Only the run lifecycle changes it.
- **Run outcome**: how a run ended: `verified | unverified | stopped | error`. It is carried on `run.finished`. Clients read the outcome, never the error text.
- **Run lifecycle** (`apps/control/src/runs/lifecycle.ts`): the module that owns one run's state. That covers phase transitions, pause/stop, the Fix & verify deadline, live sandboxes, and which events still reach viewers after Stop.
- **Orchestrator**: sequences a run's stages (agents → attribution → wait for Fix & verify → fix loop). It holds no run state of its own.
- **Sandbox lease** (`apps/control/src/sandbox/lease.ts`): borrowing a fresh sandbox for one job. The lease destroys it exactly once, with a reason that matches how the job ended. A plain lease is used in tests; a run lease is owned by the run lifecycle.
- **Agent attempt** (`apps/control/src/runs/attempts.ts`, `attemptsFor(run, deps)`): the run-scoped way stages put an agent or the inspector in a sandbox. `agent(id, kind, patches?)` leases a fresh sandbox, opens the start page with the patches applied, runs the agent and returns its journey plus each patch's report. `attribute(sighted, blind, patches?)` runs attribution. The run's emit, screenshots, gate, checkpoint and lease are bound once. The Orchestrator and the fix loop both use it.
- **Stop**: the starter ends a run now. Live sandboxes are torn down before `run.finished`, and later steps, sandboxes and patches are refused.
- **Pause**: agents wait at their next checkpoint for at most 30 s. Only agents pause (`isPausableAgent`); the inspector and patch generation never do.
- **Finding**: a confirmed divergence attributed to one element, with WCAG mapping. `Finding.milestone` is always the checkpoint it blocks (in any-url mode, Submit). The element itself is on `Finding.element`. Its **status** (`open → fixing → verified | unverified`) changes only through `finding` events.
- **Patch** (`packages/shared/src/patch.ts`): an attribute-only fix for one finding: a selector, whitelisted attributes (values may use the tokens `$text` / `$label`), and a keyboard-shim flag. The module owns the vocabulary, the prompt wording, validation, the fixed in-page template, the **patch report** (elements matched, plus what the template wrote on the **anchor**, the finding's own element) and the diff **preview** built from that report.
- **Fix loop**: generates a patch, reruns the blind agent with the stacked patches, and verifies.
- **Inspector**: the sandbox that replays the sighted path to the divergence and inspects the element.
