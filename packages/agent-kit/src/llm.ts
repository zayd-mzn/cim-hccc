/**
 * Provider-agnostic LLM interface for the agent tool-calling loop.
 *
 * DEPENDENCY FLAG (to Zayd / team): a real LLM provider + API key is needed for
 * the live demo. This interface is the seam — implement LlmClient over OpenAI,
 * Anthropic, Vercel AI SDK, or a local model without touching agent logic. The
 * MockLlmClient below drives the full loop deterministically with no API key, so
 * CI and local runs never require a secret.
 */

export interface LlmToolSpec {
  name: string;
  description: string;
  /** JSON-schema-ish parameter description (kept loose; providers vary). */
  parameters: Record<string, unknown>;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant turns that call a tool. */
  toolCall?: { name: string; arguments: Record<string, unknown> };
  /** Present on tool-result turns. */
  toolName?: string;
}

export interface LlmResponse {
  /** Either a tool call to execute, or a final textual answer. */
  toolCall?: { name: string; arguments: Record<string, unknown> };
  content?: string;
}

export interface LlmClient {
  /** Given the conversation + available tools, decide the next step. */
  next(input: { messages: LlmMessage[]; tools: LlmToolSpec[] }): Promise<LlmResponse>;
}
