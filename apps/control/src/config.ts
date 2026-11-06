export interface Config {
  inferenceKey: string;
  inferenceBaseUrl: string;
  agentModel: string;
  ttsModel: string;
  ttsVoice?: string;
  safetyModel?: string;
  sandboxRuntime: string;
  sandboxImage: string;
  sandboxNetwork: string;
  proxyUrl: string;
  proxyAdminUrl: string;
  proxyAdminToken: string;
  eventsToken: string;
  storeUrl: string;
  publicOrigin: string;
  port: number;
  webDist?: string;
}

const REQUIRED = ['VULTR_INFERENCE_API_KEY', 'AGENT_MODEL', 'TTS_MODEL', 'PROXY_ADMIN_TOKEN', 'CONTROL_EVENTS_TOKEN'] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED.filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  return {
    inferenceKey: env.VULTR_INFERENCE_API_KEY!,
    inferenceBaseUrl: env.INFERENCE_BASE_URL || 'https://api.vultrinference.com/v1',
    agentModel: env.AGENT_MODEL!,
    ttsModel: env.TTS_MODEL!,
    ttsVoice: env.TTS_VOICE || undefined,
    safetyModel: env.SAFETY_MODEL || undefined,
    sandboxRuntime: env.SANDBOX_RUNTIME || 'runc',
    sandboxImage: env.SANDBOX_IMAGE || 'earshot-sandbox:latest',
    sandboxNetwork: env.SANDBOX_NETWORK || 'earshot_sandnet',
    proxyUrl: env.PROXY_URL || 'http://proxy:3128',
    proxyAdminUrl: env.PROXY_ADMIN_URL || 'http://proxy:3129',
    proxyAdminToken: env.PROXY_ADMIN_TOKEN!,
    eventsToken: env.CONTROL_EVENTS_TOKEN!,
    storeUrl: env.STORE_URL || 'http://store:8080',
    publicOrigin: env.PUBLIC_ORIGIN || '',
    port: Number(env.PORT || 3000),
    webDist: env.WEB_DIST || undefined,
  };
}
