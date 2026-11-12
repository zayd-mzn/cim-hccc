/**
 * @agent-market/agent-kit — shared agent runtime.
 *
 * Provider-agnostic LLM tool-calling loop + MCP client wiring, used by both the
 * consumer and provider agents. A real LlmClient (OpenAI/Anthropic/etc.) can be
 * dropped in for the demo; MockLlmClient drives the loop with no API key.
 */
export * from './llm.js';
export * from './mock-llm.js';
export * from './loop.js';
