# Model bake-off

Run: 2026-11-03T22:48:31.217Z · sighted agent · demo goal · 3 tries per model · local store, in-process runner.

| Model | Reached gate | Mean s/step | Outcomes |
|---|---|---|---|
| glm-5.3 | 3/3 | 4.9 | gate@awaiting_final_approval, gate@awaiting_final_approval, gate@awaiting_final_approval |
| qwen3.8-27b | 3/3 | 1.4 | gate@awaiting_final_approval, gate@awaiting_final_approval, gate@awaiting_final_approval |
| muse-glimmer-30b | 1/3 | 2.1 | max-steps@on_checkout, gate@awaiting_final_approval, max-steps@in_cart |

| TTS model | Result (rerun with each model's own voice) |
|---|---|
| chatterbox (voice `default`) | ok · 31.8 kB mp3 · 1.4 s |
| **qwen3-tts-12hz-1.7b** (voice `ryan`) | ok · 37.5 kB mp3 · 1.5 s |

The first TTS attempt sent the OpenAI voice `alloy`, which neither Vultr model accepts (valid: chatterbox `default`/`clone`; qwen3-tts `vivian`, `serena`, `uncle_fu`, `dylan`, `eric`, `ryan`, …). `defaultVoice()` in the inference client now picks a valid voice per model.

Content safety: `nemotron-3.5-content-safety` flags the planted checkout injection as unsafe and a benign product description as safe.

## Decision

- **Agents (both sighted and blind, same model): `qwen3.8-27b`.** 3/3 reached the purchase gate at 1.4 s per step. `glm-5.3` also scored 3/3 but took 4.9 s per step; `muse-glimmer-30b` scored 1/3.
- **TTS: `qwen3-tts-12hz-1.7b`**, voice `ryan`.
- **Injection flag: `nemotron-3.5-content-safety`** (flags only; never removes text).
