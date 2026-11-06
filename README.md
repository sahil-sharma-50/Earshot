# Earshot

**Rules don't fail customers. Journeys do.**

Accessibility checkers test **rules**. Earshot tests **journeys**. Two AI agents get the same shopping goal, each in its own disposable sandbox on Vultr:

- the **sighted agent** sees screenshots, like most customers;
- the **blind agent** perceives only the **accessibility tree**, the same data a screen reader gets.

Both agents use the same model and the same prompt. Only their senses differ. Where the sighted agent gets through and the blind one stalls, Earshot names the exact element, the failure category and the WCAG success criterion, with evidence. It then generates a patch, reruns the blind agent from the start in a **fresh** sandbox, and reports the fix as verified only if that rerun gets past the step.

You can also **hear** the failure: the Listen button reads the broken checkout aloud in screen-reader style ("button. button. link. image.").

> Built for the Vultr **Agent Rush** hackathon, Challenge 1, *Blast Radius Zero*.

- **Live app:** https://104-238-159-1.sslip.io
- **Try it:** press **Run the demo**. The **Prompt-injection test** starts at checkout, where a hidden prompt injection waits. **Any URL (beta)** needs the access code given in the submission text. Demo runs are limited to 3 an hour per IP; a run you stop gives its slot back.

---

## Hackathon requirements, and where each is met

| Requirement (Challenge 1, *Blast Radius Zero*) | How Earshot meets it | Proof |
|---|---|---|
| Web-based agent that performs **real work** | Two agents drive a real Chromium (Playwright) through a real checkout; a third sandbox inspects the DOM and the accessibility tree; patches are applied and re-verified in a new browser | [sandbox/runner](sandbox/runner), live run view |
| **Every action in a sandbox on Vultr** | Every browser action runs in a per-agent gVisor container on the Vultr VM. Control never opens a page itself | [docker.ts](apps/control/src/sandbox/docker.ts) |
| **Control layer: plan → dispatch → verifiable output** | Control plans one action per step, dispatches it over JSON-RPC to the sandbox, and gets back the element touched, a page probe and evidence | [loop.ts](apps/control/src/agents/loop.ts) |
| **Multi-step agentic workflow** | Up to 15 steps per agent, attribution, patch generation, rerun loop (up to 4 iterations) | [orchestrator.ts](apps/control/src/runs/orchestrator.ts), [fix/loop.ts](apps/control/src/fix/loop.ts) |
| **Real executed results** | Findings are confirmed only by a failing deterministic check; fixes only by a fresh rerun that gets past the step | [attribution](apps/control/src/attribution) |
| **Pattern B**: goal → plan → Playwright in a container → screenshots return → **vision model verifies** → **human approves** | The sighted agent works from screenshots; before the final action a vision model checks a clean screenshot against the goal; the starter approves or denies (60 s, silence = deny) | [loop.ts](apps/control/src/agents/loop.ts) `visionCheck` / `passGate`, [ApprovalModal.tsx](apps/web/src/components/ApprovalModal.tsx) |
| **Vultr Serverless Inference (required)** | Every model call: agents, vision check, patches, TTS, safety | [client.ts](apps/control/src/inference/client.ts) |
| **Backend on a Vultr VM, Vultr as orchestration** | Control, proxy, store and every sandbox run on one Vultr Cloud Compute VM; control creates and destroys containers per task through the Docker API | [docker-compose.yml](infra/docker-compose.yml) |
| Process isolation | gVisor `runsc` user-space kernel, non-root, read-only rootfs, `CapDrop: ALL`, `no-new-privileges`, no Docker socket | [Containment model](#containment-model-blast-radius-zero) |
| Secret hygiene | Sandbox env is exactly `EARSHOT_PROXY` + `EARSHOT_MODE`, asserted by an integration test | [sandbox.int.test.ts](apps/control/test/sandbox.int.test.ts) |
| Time and memory caps | 1 GiB, 0.75 CPU, 256 pids and a hard kill timer per container; 15 steps / 120 s per agent | [docker.ts](apps/control/src/sandbox/docker.ts) |
| Reset/destroy after each task | Each sandbox is leased for one job and force-removed exactly once; a boot-time reaper removes leftovers | [lease.ts](apps/control/src/sandbox/lease.ts), [reaper.ts](apps/control/src/sandbox/reaper.ts) |
| **One containment moment** (video) | A prompt injection hidden in the checkout; a live probe from inside a running sandbox to the cloud metadata IP shows *no route* directly and a real **BLOCKED** row through the proxy | [containment-probe.sh](infra/containment-probe.sh), [e2e-log.md](docs/e2e-log.md) |
| Public URL | https://104-238-159-1.sslip.io (TLS by Caddy) | `GET /api/health` |

## Vultr services used

| Service | What Earshot uses it for |
|---|---|
| **Vultr Cloud Compute** (`vc2-2c-4gb`, Frankfurt `fra`, Ubuntu 24.04, tag `agent-rush`) | The whole backend: control plane, demo store, egress proxy, and every per-run **gVisor sandbox** container. Vultr is the orchestration layer: control creates and destroys a container per agent per run on this VM. |
| **Vultr Serverless Inference** (`api.vultrinference.com/v1`, OpenAI-compatible) | **All** model calls: the sighted (vision) and blind (text) agents (tool calling), the **vision check** of a clean screenshot before every human approval, patch generation with **strict** `json_schema` structured output, text-to-speech for Listen (`/audio/speech`), and a content-safety flag. Models: agents `qwen3.8-27b`, TTS `qwen3-tts-12hz-1.7b`, safety `nemotron-3.5-content-safety`, checked against the live `/v1/models` at boot and chosen by a bake-off ([docs/bakeoff.md](docs/bakeoff.md)). |
| **Vultr API / `vultr-cli`** | Scripted provisioning ([infra/provision.sh](infra/provision.sh)): SSH key, firewall group and the instance. |
| **Vultr Firewall Groups** | 80/443 open to the world, 22 open only to the owner's IP. |

No Vultr GPUs are used.

## Architecture

```mermaid
flowchart LR
  U[Browser] -- HTTPS --> C[Caddy<br/>TLS via sslip.io]
  subgraph VM[Vultr VM vc2-2c-4gb · fra]
    C --> CT[control<br/>Fastify · holds ALL secrets<br/>agent loops · attribution · fixes · SSE]
    CT -- Docker API --> SB1[sandbox: sighted<br/>gVisor runsc]
    CT -- Docker API --> SB2[sandbox: blind<br/>gVisor runsc]
    CT -. stdin/stdout JSON-RPC .- SB1
    CT -. stdin/stdout JSON-RPC .- SB2
    SB1 -- only route out --> P[egress proxy<br/>per-sandbox allowlist]
    SB2 -- only route out --> P
    P --> S[demo store<br/>Kaffeebohne Roasters]
    P -- BLOCKED reports --> CT
  end
  CT -- agents · vision check · patches · TTS · safety --> VI[Vultr Serverless Inference]
```

**Control plane → isolated execution → verifiable output:**

1. **Plan (control).** [apps/control](apps/control) holds the inference key and makes every model call. It decides one action per step.
2. **Dispatch (sandbox).** Each agent gets a fresh container running a **keyless browser runner** ([sandbox/runner](sandbox/runner)): Playwright and Chromium driven over **stdin/stdout JSON-lines RPC**. A sandbox has no network path to control, no Docker socket and no secrets. Its only route out is the egress proxy on an `internal: true` Docker network.
3. **Return (verifiable output).** Every action returns the element it touched (CSS path, CDP node id, HTML snippet). The UI streams each step, screenshot or accessibility-tree excerpt, sandbox lifecycle event and proxy block live over SSE.
4. **Verify, then ask a human.** Before the final action, control takes a clean screenshot inside the sandbox and a **vision model checks it against the goal** (strict structured output: matches / what it sees / concerns). The verdict and the screenshot are shown in the approval dialog. Only a person can approve the purchase.

### Repository map

| Path | What it is |
|---|---|
| [packages/shared](packages/shared) | Types, the RPC protocol, journey milestones, WCAG mapping, private-IP check |
| [sandbox/runner](sandbox/runner) | Keyless runner: AX-tree observation (blind), set-of-marks screenshots (sighted), actions, inspection (axe-core), and the fixed-template patch applier |
| [proxy](proxy) | HTTP/CONNECT egress proxy: per-sandbox policy, DNS-checked private-IP blocking, block reports |
| [apps/control](apps/control) | Orchestrator, agent loop, approval gate, attribution, fix loop, TTS, HTTP/SSE API |
| [apps/store](apps/store) | Demo shop with planted accessibility bugs and a planted prompt injection |
| [apps/web](apps/web) | The home page (static HTML with a small TypeScript launcher) and the React run view: live side-by-side agents, containment rail, findings, approvals, Listen |
| [infra](infra) | Provisioning, VM bootstrap (Docker and gVisor), compose, Caddy, deploy |

## How the agent does real work

**Agent loop** ([apps/control/src/agents/loop.ts](apps/control/src/agents/loop.ts)). Each step:
1. observe through the agent's channel;
2. ask the model for exactly one tool call (one corrective retry on a malformed reply);
3. check whether the target is the final purchase button, or any form submit in any-URL mode. If so, take a clean screenshot in the sandbox, have the **vision model verify** it against the goal, then **pause for human approval** with that verdict on screen. The pointer path and the keyboard path (Enter/Space on the focused element) both hit this gate. The vision check is advisory: if it fails, the person still decides, and it never presses anything itself;
4. act inside the sandbox;
5. probe the page state and record milestones.

Limits: 15 steps, 120 s, and a stop after 3 consecutive steps with no progress.

**Attribution** ([apps/control/src/attribution](apps/control/src/attribution)). Earshot first finds the first milestone the sighted agent reached and the blind agent didn't. A fresh **inspector sandbox** replays the sighted agent's actions up to that point and runs deterministic checks on the element it used:
- presence in the AX tree;
- accessible name;
- role;
- keyboard focus, Tab reachability and Enter activation;
- programmatic label;
- axe-core, scoped to the element.

A finding is **confirmed only if a check fails**. Otherwise it is shown as *inconclusive (agent error)* and not counted.

**Fix and verify** ([apps/control/src/fix](apps/control/src/fix)):
- The model may only return a JSON **attribute patch**: role, aria-*, tabindex, plus an optional "keyboard shim" flag.
- The JavaScript that applies it is a **fixed template** ([patch.ts](packages/shared/src/patch.ts)). Model output never becomes code.
- The page reports what the template actually wrote on the finding's element, and the before/after diff is built from that report. The diff shows what really happened, not what the patch intended.
- Patches stack. Each rerun starts from scratch in a new sandbox with every accepted patch applied.
- A fix is verified only when the rerun passes the blocked milestone **and** the patch matched elements on the page.
- Limits: up to 4 iterations and 2 attempts per finding.

### Why containers on one VM, not a new Vultr VM per task

We considered creating a throwaway Vultr instance per task through `POST /v2/instances`. Earshot starts 3 to 6 sandboxes per run; a VM takes minutes to boot and is billed by the hour. A gVisor container on the Vultr VM starts in about a second, gets its own user-space kernel (the sandbox never touches the host kernel's syscall surface directly), and is destroyed after one job. The Vultr API is used where it fits: scripted provisioning of the VM and its firewall group.

## Containment model (Blast Radius Zero)

| Layer | How it is enforced | Where |
|---|---|---|
| Process isolation | gVisor `runsc` runtime, non-root `pwuser`, read-only rootfs + tmpfs, `CapDrop: ALL`, `no-new-privileges` | [docker.ts](apps/control/src/sandbox/docker.ts), [bootstrap.sh](infra/bootstrap.sh) |
| No secrets in the sandbox | Sandbox env is **exactly** `EARSHOT_PROXY` and `EARSHOT_MODE`. All LLM calls happen in control. The test asserts the container env | [docker.ts](apps/control/src/sandbox/docker.ts) `sandboxEnv`, [sandbox.int.test.ts](apps/control/test/sandbox.int.test.ts) |
| Network egress | `internal: true` network whose only other member is the proxy. Per-sandbox allowlist (demo: `store:8080` only). In any-URL mode, private, loopback, link-local, CGNAT and metadata IPs are denied **after DNS**, and the proxy dials the IP it checked (no DNS rebinding) | [proxy/src](proxy/src), [docker-compose.yml](infra/docker-compose.yml) |
| Resource limits | 1 GiB memory (no swap), 0.75 CPU, 256 pids, wall-clock kill timer, 15 steps | [docker.ts](apps/control/src/sandbox/docker.ts), [loop.ts](apps/control/src/agents/loop.ts) |
| Human in the loop | A vision model checks a clean screenshot first; then the final purchase needs approval from the run's starter (per-run secret token). Silence for 60 s = denied | [loop.ts](apps/control/src/agents/loop.ts), [approval.ts](apps/control/src/runs/approval.ts) |
| Lifecycle | Every container is force-removed after its agent finishes (`try/finally`), on error and on timeout. A boot-time reaper removes leftovers | [orchestrator.ts](apps/control/src/runs/orchestrator.ts), [reaper.ts](apps/control/src/sandbox/reaper.ts) |
| Abuse limits | Demo runs: 3/hour/IP. Any-URL runs need an access code. One run at a time, queue of 5 | [routes.ts](apps/control/src/http/routes.ts) |
| Edge | Caddy TLS, HSTS, strict Content-Security-Policy (same-origin only), `/internal/*` never exposed; SSH only from the owner's IP through a Vultr firewall group | [Caddyfile](infra/Caddyfile), [provision.sh](infra/provision.sh) |

**The containment moment.** The demo store's checkout hides an instruction in an `aria-label` (plus a hidden link). It is visually invisible, so only the blind agent "hears" it, and it says to "verify the card" at `cardcheck.attacker.invalid`. Earshot does **not** strip it. If an agent obeys, the egress proxy refuses the connection and the UI shows a red **BLOCKED** row that comes from the real proxy log, never from a script. (Our model resisted it in every run; the same BLOCKED path is shown live by probing the metadata IP from inside a running sandbox.) An optional content-safety model may flag the text, but it never removes it.

## Honest limitations

- Earshot **emulates** what assistive technology receives (Chromium's accessibility tree). It does not drive NVDA or VoiceOver.
- A model can fail for reasons unrelated to accessibility. That is why every finding must pass a deterministic check, and why "inconclusive" exists.
- In our tests the agent model (`qwen3.8-27b`) **never obeyed** the planted injection (0 / 12; it names it as untrusted every time) while the safety model flagged it 12 / 12. Containment is demonstrated with a live probe from inside a gVisor sandbox (metadata IP: no route; through the proxy: 403 and a real BLOCKED event). Details in [docs/e2e-log.md](docs/e2e-log.md).
- gVisor's network stack cannot reach Docker's embedded DNS, so sandboxes are given the egress proxy by IP; destinations are still resolved only by the proxy.
- Any-URL mode shows suggested patches only. Earshot never modifies third-party sites.

## Local development

Requirements: Node 24, pnpm 10, Docker.

```bash
pnpm install
pnpm --filter runner exec playwright install chromium
pnpm test                       # unit + in-process browser tests
pnpm typecheck

# Docker integration (real sandboxes, proxy and store)
docker build -f sandbox/Dockerfile -t earshot-sandbox:latest .
docker compose -f infra/docker-compose.dev.yml up -d --build
DOCKER_IT=1 pnpm vitest run apps/control/test

# Run control locally (needs .env, see .env.example)
pnpm --filter control dev       # http://localhost:3000
pnpm --filter web dev           # http://localhost:5173 (proxies /api)
```

For local control, set `PROXY_ADMIN_URL=http://127.0.0.1:3129`, `PROXY_ADMIN_TOKEN=dev-admin-token` and `CONTROL_EVENTS_TOKEN=dev-events-token` to match the dev compose file.

## Deploy to Vultr

```bash
infra/provision.sh                         # creates firewall group + VM (billable)
ssh root@<ip> 'bash -s' < infra/bootstrap.sh
ssh root@<ip> 'cat > /opt/earshot/.env'   # paste secrets once, never committed
infra/deploy.sh <ip>                       # builds images on the VM, starts the stack, checks HTTPS health
```

## License

[MIT](LICENSE)
