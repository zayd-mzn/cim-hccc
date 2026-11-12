/**
 * OpenAI-compatible LlmClient.
 *
 * Talks to any OpenAI-style `/chat/completions` endpoint with tool calling:
 * OpenAI, Groq, OpenRouter, Together, a local Ollama/llama.cpp server, or
 * Anthropic via its OpenAI-compatibility endpoint. Provider choice is just a
 * baseUrl + model + apiKey — no provider SDK dependency (uses fetch).
 *
 * This is the real LlmClient for the live demo. It implements the exact same
 * interface the MockLlmClient does, so the agent loop is unchanged.
 */
import type { LlmClient, LlmMessage, LlmResponse, LlmToolSpec } from './llm.js';

export interface OpenAiLlmClientOptions {
  /** API key. Falls back to OPENAI_API_KEY. */
  apiKey?: string;
  /** Chat-completions base URL. Default https://api.openai.com/v1. */
  baseUrl?: string;
  /** Model id. Default gpt-4o-mini. */
  model?: string;
  /** Sampling temperature. Default 0 (deterministic tool use). */
  temperature?: number;
  /** Request timeout (ms). Default 60s. */
  timeoutMs?: number;
  /** Optional fetch impl (for testing). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** OpenAI chat message shapes (the subset we emit/consume). */
interface OaiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
}

export class OpenAiLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiLlmClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAiLlmClient requires an apiKey (or OPENAI_API_KEY env var)');
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    );
    this.model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    this.temperature = options.temperature ?? 0;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async next(input: { messages: LlmMessage[]; tools: LlmToolSpec[] }): Promise<LlmResponse> {
    const body = {
      model: this.model,
      temperature: this.temperature,
      messages: toOaiMessages(input.messages),
      tools: input.tools.map(toOaiTool),
      tool_choice: 'auto' as const,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM request failed: ${res.status} ${res.statusText} ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: OaiMessage }>;
    };
    const message = json.choices?.[0]?.message;
    if (!message) throw new Error('LLM response had no message');

    const toolCall = message.tool_calls?.[0];
    if (toolCall) {
      let args: Record<string, unknown> = {};
      try {
        args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
      } catch {
        throw new Error(`LLM returned non-JSON tool arguments: ${toolCall.function.arguments}`);
      }
      return { toolCall: { name: toolCall.function.name, arguments: args } };
    }

    return { content: message.content ?? '' };
  }
}

/**
 * Translate our LlmMessage[] into OpenAI chat messages in one pass, assigning a
 * unique id to each assistant tool_call and pairing it with the tool result that
 * follows it (the loop always emits tool results in call order).
 */
function toOaiMessages(messages: LlmMessage[]): OaiMessage[] {
  const out: OaiMessage[] = [];
  const pendingIds: string[] = []; // tool_call ids awaiting a tool result
  let seq = 0;

  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCall) {
      const id = `call_${seq++}_${m.toolCall.name}`;
      pendingIds.push(id);
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: [
          {
            id,
            type: 'function',
            function: {
              name: m.toolCall.name,
              arguments: JSON.stringify(m.toolCall.arguments),
            },
          },
        ],
      });
    } else if (m.role === 'tool') {
      const id = pendingIds.shift() ?? `call_${seq++}_${m.toolName ?? 'tool'}`;
      out.push({ role: 'tool', content: m.content, tool_call_id: id });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/** Translate our LlmToolSpec into an OpenAI function tool. */
function toOaiTool(t: LlmToolSpec): {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
} {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      // The MCP inputSchema is already JSON Schema — pass it straight through.
      parameters:
        t.parameters && Object.keys(t.parameters).length > 0
          ? t.parameters
          : { type: 'object', properties: {} },
    },
  };
}
