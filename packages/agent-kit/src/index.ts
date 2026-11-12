/**
 * @agent-market/agent-kit — shared agent runtime.
 *
 * Provider-agnostic LLM tool-calling loop + MCP client wiring, used by both the
 * consumer and provider agents. A real LlmClient (OpenAI/Anthropic/etc.) can be
 * dropped in for the demo; MockLlmClient drives the loop with no API key.
 */
export * from './llm.js';
export * from './mock-llm.js';
export * from './openai-llm.js';
export * from './loop.js';

import { OpenAiLlmClient } from './openai-llm.js';
import type { LlmClient } from './llm.js';

/**
 * Return a real LLM client if one is configured via env (OPENAI_API_KEY), else
 * undefined so callers can fall back to a MockLlmClient. This lets the same demo
 * use a live model when a key is present and run offline (CI) when it isn't.
 */
export function resolveLlmFromEnv(): LlmClient | undefined {
  if (!process.env.OPENAI_API_KEY) return undefined;
  return new OpenAiLlmClient();
}
