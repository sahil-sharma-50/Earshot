# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary: judges of the Vultr Agent Rush hackathon (Challenge 1, Blast Radius Zero). They open the public URL, start one run, and need to see within minutes that real work happens inside a sandbox on Vultr, that a finding is real, and that a fix is verified. Secondary, framed but not courted: e-commerce and accessibility leads who would test their own checkout.

## Product Purpose
Earshot runs two AI agents through the same shopping goal: a sighted agent that sees screenshots and a blind agent that gets only the accessibility tree. Where the sighted agent gets through and the blind one stalls, Earshot names the element, the failure and the WCAG criterion, writes an attribute-only patch, and verifies it with a fresh blind run. Success for the home page: a visitor understands the idea in seconds and starts a run.

## Positioning
Accessibility checkers test rules; Earshot tests journeys, with a blind-versus-sighted comparison, a spoken screen-reader readout, and a fix that only counts once a fresh blind agent gets past the blocked step.

## Operating Context
Visitors start runs from the home page: the demo store run (Kaffeebohne Roasters, a demo shop with planted bugs), the injection drill (starts at checkout, where a hidden prompt injection waits), or Any URL (beta, needs an access code from the submission text). The run view streams both agents, the safety log, findings and approvals. Demo runs are rate limited to 3 per hour per IP.

## Capabilities and Constraints
- Every agent runs in its own gVisor container on a Vultr Cloud Compute VM; no secrets inside; 1 GiB, 0.75 CPU, 256 processes, 120 s and 15 steps per agent; destroyed after each run; one egress proxy with an allowlist.
- Models on Vultr Serverless Inference: qwen3.8-27b (agents, vision check), qwen3-tts (Listen), nemotron content safety (flag only).
- Any URL is findings only: patches are suggested, never applied to third-party sites; form submits wait for approval.
- Strict CSP: same-origin scripts, styles, fonts and images only; no inline scripts.

## Brand Commitments
Name: Earshot. Line used in the README: "Rules don't fail customers. Journeys do." No logo file exists.

## Evidence on Hand
docs/e2e-log.md: blind agent stalled on the grind picker in 8 of 8 runs; runs 7 and 8 verified end to end in about 97 s; injection obeyed 0 of 12 times; vision check 1.9 to 2.2 s. No customers, testimonials or press exist; never invent them.

## Product Principles
- Show the real mechanism, not a claim about it.
- Every number comes from a logged run.
- Containment is part of the product, not a footnote.
- One clear first action: start a run.

## Accessibility & Inclusion
An accessibility product must itself pass: WCAG 2.2 AA, axe-clean, full keyboard use, reduced motion respected.
