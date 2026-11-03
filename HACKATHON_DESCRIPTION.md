# Vultr: Agent Rush Hackathon

> **Submission deadline (checked 2026-11-03):** the lablab.ai event page lists the online build as 3–8 Nov 2026 with the schedule "To be announced" and no exact time or timezone. Until it is published, treat **Sat Nov 8, 12:00 CET** as the safe internal deadline, and re-check the page, the lablab Discord or the rule book.

> **Build AI agents that do real work — safely sandboxed on Vultr.**

Source: <https://lablab.ai/ai-hackathons/vultr-hackathon>

## Overview

| | |
|---|---|
| **Organizers** | lablab.ai × Vultr |
| **Community partner** | NativelyAI |
| **Format** | Hybrid: online build **3–8 November 2026**, on-site phase **8 November 2026** |
| **On-site venue** | Pierpont Place, 163 W Pierpont Ave, Salt Lake City, UT 84101, USA (travel and accommodation not covered) |
| **Team size** | 1–6 people, all experience levels welcome |
| **Credits** | $200 in free Vultr credits per participant |
| **Schedule** | To be announced |

### Goal

Build a **web-based agent that performs real work**, such as writing and running code or operating a real browser, with every action contained in a sandbox on Vultr.

### Required architecture

A **central control layer** that:
1. **Plans** a task,
2. **Dispatches** it to an isolated execution environment, and
3. **Returns verifiable output.**

### Expectations

- Multi-step agentic workflows
- Real executed results, not described ones
- A production-style web application deployed on Vultr
- **Containment-first is required.** Projects that only chat are treated as demos.

---

## Prizes (up to $15,000)

$14,000 in competition prizes ($9,000 cash + $5,000 Vultr credits), plus an on-site raffle.

| Place | Cash | Vultr Credits |
|---|---|---|
| 🥇 1st | $5,000 | $3,000 |
| 🥈 2nd | $3,000 | $1,000 |
| 🥉 3rd | $1,000 | $1,000 |

**On-site raffle** (up to $1,000, 3 individual winners, attendance required):
- PlayStation 5 Standard
- Apple AirPods 5 with Wireless Charging Case
- Razer DeathAdder V3 HyperSpeed

*Prize distribution may take up to 90 days. Prizes depend on eligibility, availability, and sponsors.*

---

## Challenges (choose one)

### Challenge 1: Blast Radius Zero

**Core idea:** Containment-first. The system plans, dispatches, and verifies real executed work.

**Best for:** Code execution, browser automation, autonomous agents, sandboxing, verification, safety.

**Stack:** Vultr VM backend · web app on Vultr · **Vultr Serverless Inference (required)** · isolated sandbox

#### Pattern A: Sandboxed code execution
User asks → model writes code → code runs in a container → real output returns → model explains it. Errors can feed back for retries.

#### Pattern B: Sandboxed browser use
User gives a goal → model plans → Playwright runs in a container → screenshots return → vision model verifies → **human approves** before final actions.

#### Example directions
CSV Analyst · Prove-It · Code Reviewer · Chart Anything · File Fixer · Self-Healing Runner · Comparison Shopper · Form Filler · Site QA Sweep · Research with Receipts · Page Watcher

#### Containment focus
- **Process isolation:** execution never touches the host or app runtime.
- **Secret hygiene:** no API keys or credentials inside the sandbox.
- **Resource limits:** time and memory caps on every run.
- **Lifecycle discipline:** reset or destroy the environment after each task.

**Submission extras:** The demo video must show **one containment moment**.

### Challenge 2: Powering the Future of Work

**Core idea:** Build a real platform or operational workflow, not a one-off demo.

**Best for:** Sales ops, finance, HR, customer support, procurement, workflow automation, enterprise AI.

**Stack:** Vultr VM backend · web app on Vultr · Serverless Inference (optional)

#### Focus areas
- **Sales Operations:** qualify leads, research prospects, update CRM, draft outreach, follow up.
- **Finance & Accounting:** process invoices, reconcile transactions, flag anomalies, manage payment follow-ups.
- **HR & Recruitment:** screen candidates, schedule interviews, coordinate onboarding, track employee workflows.
- **Customer Support:** resolve tickets across systems, investigate issues, take actions, escalate when needed.
- **Procurement:** monitor needs, compare vendors, request quotes, track orders, follow up on delays.

#### Product expectations
- Public web access
- Product-style experience with clear user flows
- Vultr as the central backend
- Platform thinking

---

## Technologies

| Technology | Status |
|---|---|
| **Vultr Cloud Compute** | Required (both challenges). Vultr must be the central control/orchestration system, not just static hosting. |
| **Vultr Serverless Inference** | OpenAI-compatible endpoint: `https://api.vultrinference.com/v1`. Required for Challenge 1, optional for Challenge 2. |
| **Agent sandboxing** (Challenge 1) | Docker strongly recommended. Alternatives: OpenSandbox, gVisor, E2B Sandboxes, Microsandbox. |
| **Vultr API** | Optional. Challenge 1 may use it to spin up throwaway instances. |
| **App acceleration** | Optional. Challenge 2 may use Supabase on Vultr or Coolify on Vultr. |
| **Vultr GPUs** | ❌ Not available |

---

## Resources

**Core**
- Vultr: <https://www.vultr.com>
- Serverless Inference docs: <https://docs.vultr.com/products/serverless/inference/provisioning>
- Live model list: <https://api.vultrinference.com/v1/models>
- Vultr API: <https://www.vultr.com/api>

**Sandboxing**
- Vultr sandboxing guide: <https://docs.vultr.com/how-to-set-up-agent-sandboxing-on-vultr-cloud-compute>
- OpenSandbox, gVisor, E2B, Microsandbox

**App deployment**
- Supabase on Vultr guide
- Coolify on Vultr guide

**Video guides** (by Sanskriti Harmukh, Junior Developer Relations at Vultr)
- Claim Vultr hackathon credits
- Deploy with Supabase on Vultr (Next.js with the Supabase Marketplace App)
- Deploy with Coolify on Vultr (Coolify Marketplace App)

---

## Claiming Vultr Credits

1. Create a Vultr account with an email **not previously linked** to Vultr.
2. Verify the email and sign in to the Vultr Console.
3. In **Billing**, open the hackathon promotion page, enter the gift code under **"Gift Code"**, and click **"Apply Gift Code"**.
4. Confirm **$200.00** in Remaining Credit.

- Credits stay active through the event. Add a payment method in Billing to keep deployments running afterward.
- Usable for Compute Instances, Managed Databases, Kubernetes, and other Vultr services.
- Claim link: <https://lablab.ai/redeem-coupon/vultr-ai-coupon-vultr-agent-rush-hackathon>

---

## Submission Requirements

> The official submission **must be made on lablab.ai** to be judged and eligible for prizes.

**Basic info**
- Project title
- Short and long descriptions
- Technology and category tags

**Presentation**
- Cover image
- Video presentation
- Slide presentation

**Hosting & repo**
- Public GitHub repo (with setup docs)
- Demo application platform
- Public application URL (deployed on a Vultr VM backend)

**Vultr documentation (in the public README)**
- Explain the Vultr services and infrastructure used
- Document the backend and deployment architecture
- Explain the agent's use case and how it executes real tasks
- Challenge 1 only: show **one containment moment** in the demo video
- No separate Vultr architecture report is needed

**Optional:** Showcase on Vultr Community (<https://community.vultr.com/e/vultr-agent-rush-hackathon>). This does not replace the lablab.ai submission, and exposure is not guaranteed.

---

## Judging Criteria

1. **Application of Technology:** how effectively the chosen models are integrated.
2. **Presentation:** clarity and effectiveness of the project presentation.
3. **Business Value:** impact and practical value, including fit for business areas.
4. **Originality:** uniqueness and creativity, including the ability to demonstrate behaviors.

---

## Participation & Rules

- Enroll via the **Enroll** button on lablab.ai; join both the lablab.ai platform and the lablab.ai Discord.
- Read the Hackathon Guidelines, Getting Started Guide, and lablab.ai Hackathon Rule Book.
- Find teammates on the dashboard or Discord.
- Submissions must be original and MIT-compliant.
- Participation is voluntary. Rules, prizes, and terms may change or be canceled at the organizers' discretion.
- Full terms: <https://lablab.ai/terms-of-use#16-participation-terms>
- Help: lablab.ai Help Center and Discord (mentors and team support).
