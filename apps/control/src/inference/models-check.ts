import type { InferenceConfig } from './client.js';

/** Fetches the live model list and throws if any configured model is missing. */
export async function assertModelsAvailable(cfg: InferenceConfig): Promise<void> {
  const f = cfg.fetchImpl ?? fetch;
  const res = await f(`${cfg.inferenceBaseUrl}/models`, { headers: { authorization: `Bearer ${cfg.inferenceKey}` } });
  if (!res.ok) throw new Error(`model list request failed: ${res.status}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  const ids = new Set((body.data ?? []).map((m) => m.id));
  const wanted = [cfg.agentModel, cfg.ttsModel, cfg.safetyModel].filter((m): m is string => !!m);
  const missing = wanted.filter((m) => !ids.has(m));
  if (missing.length) throw new Error(`Models not available on Vultr Serverless Inference: ${missing.join(', ')}`);
}
