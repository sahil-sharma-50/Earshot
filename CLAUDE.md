# CLAUDE.md

This project is an entry for the **Vultr: Agent Rush Hackathon** (lablab.ai). The online build runs **Nov 3–8, 2026**, and the on-site final is on Nov 8 in Salt Lake City. The full brief is in [HACKATHON_DESCRIPTION.md](HACKATHON_DESCRIPTION.md). Read it before making product or architecture decisions.

## What we must build (non-negotiables)

- A **web-based agent that does real work**, such as running code or driving a real browser. Every action must run **inside a sandbox on Vultr**. Chat-only projects count as demos and lose.
- Architecture: **control layer (plan) → isolated execution environment (dispatch) → verifiable output (return)**.
- The **backend must run on a Vultr VM (Cloud Compute)**, and Vultr must be the real orchestration layer, not just static hosting. The app needs a **public URL**.
- **Challenge 1 (Blast Radius Zero):** **Vultr Serverless Inference is required.** Containment rules:
  - Process isolation: execution never touches the host or app runtime.
  - **No secrets inside the sandbox.** API keys stay in the control layer.
  - Time and memory caps on every run.
  - Reset or destroy the sandbox after each task.
  - The demo video must show **one containment moment**.
- **Challenge 2 (Future of Work):** A product-style business workflow platform for areas like sales, finance, HR, support or procurement. Serverless Inference is optional.
- **Vultr GPUs are NOT available.** Do not plan around them.
- The public README must explain which Vultr services are used, the backend and deployment architecture, and how the agent executes real tasks.
- Judging: Application of Technology · Presentation · Business Value · Originality.

## Vultr tooling in this project

There are three ways to reach Vultr. Pick the one that fits the job.

### 1. Vultr MCP server (`vultr`), for interactive account and infra operations

- Configured at project scope in [.mcp.json](.mcp.json): `https://mcp.vultr.com/mcp` (HTTP transport, **OAuth**).
- If its tools are missing or return 401, the user must run `/mcp`, select `vultr` and complete the browser login.
- Tools appear as `mcp__vultr__*`. **The MCP is READ-ONLY**: it can list and look things up but cannot create, change or delete anything. Use it for lookups, such as instances, regions, plans, inference subscriptions and usage, billing or firewall rules. Do every write through the CLI or the API.

### 2. Vultr CLI (`vultr-cli` v3.11.0), installed only for this project

- Binary: `.tools/bin/vultr-cli.exe`. It is **not** on the global PATH.
- **Always call it through the project wrapper**, which pins the config to `./.vultr-cli.yaml` and never uses `~/.vultr-cli.yaml`:
  - Bash: `./.tools/bin/vultr <command>`
  - PowerShell: `.\.tools\bin\vultr.cmd <command>`
- Auth: `api-key:` in `.vultr-cli.yaml` (gitignored). The `VULTR_API_KEY` env var also works. Check it with `./.tools/bin/vultr account info`.
- Use `-o json` when parsing output. Common commands: `instance`, `plans`, `regions`, `os`, `ssh-key`, `firewall`, `vpc`, `kubernetes`, `database`, `object-storage`, `inference`, `container-registry`, `script`. Run `--help` on each one.
- Prefer the CLI for scripted or repeatable steps, such as deploy scripts and creating or tearing down throwaway sandbox VMs.

### 3. Vultr REST API v2: spec in [openapi.json](openapi.json)

- Base URL `https://api.vultr.com/v2`. Auth header: `Authorization: Bearer $VULTR_API_KEY`. Pagination is cursor-based.
- Use the API from **application code**, for example when the control layer creates or destroys sandbox instances through the Vultr API.
- `openapi.json` is **about 2 MB with 387 paths. Never read the whole file.** Query it instead:
  ```bash
  python -I -c "import json;d=json.load(open('openapi.json',encoding='utf-8'));[print(m.upper(),p,o.get('summary')) for p,ops in d['paths'].items() for m,o in ops.items() if isinstance(o,dict) and 'instances' in p]"
  ```
  Or use Grep on a path such as `"/instances/{instance-id}"` with context.
- Relevant tags: `instances` (38 ops), `serverless-inference` (7 ops: `/inference`, `/inference/{id}`, `/inference/{id}/api-key`, `/inference/{id}/usage`), `firewall`, `VPCs`, `startup` (startup scripts), `snapshot`, `ssh`, `plans`, `region`, `os`, `marketplace`, `managed-databases`, `kubernetes`, `Container Registry`, `s3` (Object Storage), `load-balancer`, `dns`.

### Vultr Serverless Inference (the LLM)

- OpenAI-compatible endpoint: `https://api.vultrinference.com/v1`. Use any OpenAI SDK with `base_url` set to this endpoint.
- Live model list: `GET https://api.vultrinference.com/v1/models`. **Check it before hardcoding a model name.**
- The inference API key is separate from the account API key. Manage it through the `/inference` endpoints, the CLI `inference` command or the MCP.
- Docs: https://docs.vultr.com/products/serverless/inference/provisioning

### Sandboxing

- Docker is the recommended sandbox. Alternatives: gVisor (`runsc` for stronger isolation), OpenSandbox, E2B, Microsandbox.
- Guide: https://docs.vultr.com/how-to-set-up-agent-sandboxing-on-vultr-cloud-compute
- Baseline per run: `--network none` (unless browsing), `--memory`, `--cpus`, `--pids-limit`, `--read-only` plus a tmpfs workdir, a non-root user, a wall-clock timeout and `--rm`. Pass **no env secrets**.

## Rules for working on Vultr resources

- **Creating resources costs money.** The hackathon gives $200 in credits. Confirm with the user before creating instances, clusters, databases or anything billable. Pick the smallest plan that works.
- **Destroying resources is irreversible.** Before deleting, list the resource and show the user what will be deleted.
- Tag or label every resource this project creates (for example `agent-rush`) so it can be found and cleaned up.
- **Never commit or print secrets.** `.vultr-cli.yaml` and `.env*` are gitignored. Keep it that way. Use `.env.example` for templates.
- Regenerate inference model names, plan IDs and region IDs from live data (CLI, MCP or API), not from memory.

## Environment notes

- Windows 11. Both Git Bash and PowerShell 5.1 are available. Use the matching wrapper (`vultr` or `vultr.cmd`).
- Docker Desktop, Node, Python 3.14, Go and the `gh` CLI are installed locally.
