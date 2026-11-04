# Glossary

Domain terms used in code, docs and architecture reviews. Use these names for modules and seams.

- **Run**: one Earshot job. A sighted and a blind agent attempt the same goal in separate sandboxes. Earshot attributes where they diverge and, in demo mode, fixes and verifies the divergence.
- **Run phase**: where a run is: `queued → running → awaiting-fix ⇄ fixing → finished`. Only the run lifecycle changes it.
- **Run outcome**: how a run ended: `verified | unverified | stopped | error`. It is carried on `run.finished`. Clients read the outcome, never the error text.
- **Run lifecycle** (`apps/control/src/runs/lifecycle.ts`): the module that owns one run's state. That covers phase transitions, pause/stop, the Fix & verify deadline, live sandboxes, and which events still reach viewers after Stop.
- **Orchestrator**: sequences a run's stages (agents → attribution → wait for Fix & verify → fix loop). It holds no run state of its own.
- **Sandbox lease** (`apps/control/src/sandbox/lease.ts`): borrowing a fresh sandbox for one job. The lease destroys it exactly once, with a reason that matches how the job ended. A plain lease is used in tests; a run lease is owned by the run lifecycle.
- **Stop**: the starter ends a run now. Live sandboxes are torn down before `run.finished`, and later steps, sandboxes and patches are refused.
- **Pause**: agents wait at their next checkpoint for at most 30 s. Only agents pause (`isPausableAgent`); the inspector and patch generation never do.
- **Finding**: a confirmed divergence attributed to one element, with WCAG mapping. Its **status** (`open → fixing → verified | unverified`) changes only through `finding` events.
- **Fix loop**: generates a patch, reruns the blind agent with the stacked patches, and verifies.
- **Inspector**: the sandbox that replays the sighted path to the divergence and inspects the element.
