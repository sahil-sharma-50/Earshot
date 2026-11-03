import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

export type ChatMessage = ChatCompletionMessageParam;
export type ToolDef = ChatCompletionTool;

export interface InferenceConfig {
  inferenceKey: string;
  inferenceBaseUrl: string;
  agentModel: string;
  ttsModel: string;
  ttsVoice?: string;
  safetyModel?: string;
  fetchImpl?: typeof fetch;
}

export type ChooseResult =
  | { toolName: string; args: unknown; reasoning: string }
  | { error: 'no-tool-call' | 'bad-args'; raw: string };

export interface Inference {
  chooseAction(args: { system: string; messages: ChatMessage[]; tools: ToolDef[] }): Promise<ChooseResult>;
  json<T>(args: { system: string; user: string; schemaName: string; schema: object }): Promise<T>;
  speech(text: string): Promise<Buffer>;
  flagInjection?(text: string): Promise<boolean>;
}

/** Strips ```json fences and leading prose, then parses the first JSON object. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('model returned no JSON');
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('');
  return '';
}

/** Thin wrapper over the OpenAI SDK pointed at Vultr Serverless Inference. Lives in control only. */
export function createInference(cfg: InferenceConfig): Inference {
  const client = new OpenAI({
    apiKey: cfg.inferenceKey,
    baseURL: cfg.inferenceBaseUrl,
    fetch: cfg.fetchImpl,
    maxRetries: 2,
    timeout: 60_000,
  });

  const inference: Inference = {
    async chooseAction({ system, messages, tools }) {
      const res = await client.chat.completions.create({
        model: cfg.agentModel,
        messages: [{ role: 'system', content: system }, ...messages],
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 600,
      });
      const msg = res.choices[0]?.message;
      const reasoning = textOf(msg?.content).trim();
      const call = msg?.tool_calls?.find((c) => c.type === 'function');
      if (!call || call.type !== 'function') return { error: 'no-tool-call', raw: reasoning };
      try {
        const raw = call.function.arguments?.trim() || '{}';
        return { toolName: call.function.name, args: JSON.parse(raw), reasoning };
      } catch {
        return { error: 'bad-args', raw: call.function.arguments ?? '' };
      }
    },

    async json<T>({ system, user, schemaName, schema }: { system: string; user: string; schemaName: string; schema: object }) {
      const res = await client.chat.completions.create({
        model: cfg.agentModel,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: schemaName, schema: schema as Record<string, unknown>, strict: true } },
        temperature: 0.1,
        max_tokens: 800,
      });
      return parseJsonLoose(textOf(res.choices[0]?.message?.content)) as T;
    },

    async speech(text) {
      const res = await client.audio.speech.create({
        model: cfg.ttsModel,
        input: text,
        voice: (cfg.ttsVoice ?? 'alloy') as 'alloy',
        response_format: 'mp3',
      });
      return Buffer.from(await res.arrayBuffer());
    },
  };

  if (cfg.safetyModel) {
    const safetyModel = cfg.safetyModel;
    inference.flagInjection = async (text) => {
      const res = await client.chat.completions.create({
        model: safetyModel,
        messages: [{ role: 'user', content: `Text found on a web page:\n\n${text}` }],
        temperature: 0,
        max_tokens: 100,
      });
      return /\bunsafe\b/i.test(textOf(res.choices[0]?.message?.content));
    };
  }
  return inference;
}
