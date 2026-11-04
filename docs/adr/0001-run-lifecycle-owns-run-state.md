# ADR 0001: The run lifecycle owns run state; sandboxes are leased

- Status: accepted
- Date: 2026-11-04

## Context

Run state was spread across many modules:

- The run phase was written by both the Orchestrator and the event bus.
- The after-Stop event policy lived inside the bus.
- The Orchestrator rechecked `control.stopped` at many points.
- The pause rule was copied between control and web.
- "Stopped" reached the web as an error string compared byte for byte.
- Each of the four places that create a sandbox wrote its own create / try / finally-destroy code.
- The fix loop changed finding status in place without emitting an event.

Three recent fixes touched this spread (b314c84, 0e28946 and the pause-eligibility rule). A latent bug sat in it too: a busy queue on Fix & verify cleared the fix deadline and never re-armed it.

## Decision

- **`RunLifecycle`** (one per run, on `RunRecord.lifecycle`) is the only writer of the run phase. It applies a transition table and owns:
  - pause/stop (`RunControl` is now internal to it)
  - the Fix & verify deadline
  - live sandboxes
  - `admit(e)`, which decides what reaches viewers after Stop
- `RunBus` is plain replay pub/sub that asks the lifecycle before recording an event.
- `RunStore` holds data only.
- **`leaseWith(create, owner?)`** is the only way stages get a sandbox. It destroys each sandbox exactly once, with a reason derived from how the job ended. The fix loop and attribution take a `LeaseSandbox`, not a `CreateSandbox`.
- **`run.finished` carries `outcome`** (`verified | unverified | stopped | error`). `isPausableAgent` lives in shared.
- **Finding status changes are `finding` events**. The web reducer no longer infers status from `fix.result`.

## Consequences

- Stop and pause behaviour is tested at the lifecycle interface (via the Orchestrator) rather than across four modules.
- Viewers never see a `sandbox.destroyed` without its `sandbox.created`.
- The `run.finished` event shape changed (`outcome` added). The web and the control server ship together, so there are no external clients to migrate.
- Route handlers still pre-check the token for their own 403 messages. The lifecycle-backed Orchestrator checks it again, which is acceptable defence in depth.
