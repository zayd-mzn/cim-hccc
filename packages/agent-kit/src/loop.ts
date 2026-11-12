/**
 * Agent tool-calling loop.
 *
 * An agent = an LlmClient driving a set of tools exposed by the Agent Market MCP
 * server. The loop: ask the LLM for the next step → if it's a tool call, execute
 * it against the MCP client and feed the result back → repeat until the LLM
 * returns a final answer (or a step budget is hit).
 *
 * Tools are reached through the MCP Client, so a provider/consumer agent here is
 * exactly as capable as any external bring-your-own agent (same surface).
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { LlmClient, LlmMessage, LlmToolSpec } from './llm.js';

export interface AgentRunResult {
  finalAnswer: string;
  toolResults: { name: string; result: unknown }[];
  transcript: LlmMessage[];
}

export interface AgentLoopOptions {
  llm: LlmClient;
  mcp: Client;
  systemPrompt: string;
  goal: string;
  /** Hard cap on tool calls to prevent runaway loops. Default 12. */
  maxSteps?: number;
}

/** Fetch the MCP server's tool list and adapt it to the LLM tool spec shape. */
async function loadTools(mcp: Client): Promise<LlmToolSpec[]> {
  const listed = await mcp.listTools();
  return listed.tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    parameters: (t.inputSchema as Record<string, unknown>) ?? {},
  }));
}

function parseToolResult(result: unknown): unknown {
  // MCP tool results come back as { content: [{ type: 'text', text }] }.
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const first = content?.[0];
  if (first?.type === 'text' && typeof first.text === 'string') {
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  }
  return result;
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentRunResult> {
  const tools = await loadTools(opts.mcp);
  const maxSteps = opts.maxSteps ?? 12;

  const messages: LlmMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    { role: 'user', content: opts.goal },
  ];
  const toolResults: { name: string; result: unknown }[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await opts.llm.next({ messages, tools });

    if (response.toolCall) {
      const { name, arguments: args } = response.toolCall;
      messages.push({ role: 'assistant', content: '', toolCall: { name, arguments: args } });

      const raw = await opts.mcp.callTool({ name, arguments: args });
      const parsed = parseToolResult(raw);
      toolResults.push({ name, result: parsed });
      messages.push({ role: 'tool', toolName: name, content: JSON.stringify(parsed) });
      continue;
    }

    const finalAnswer = response.content ?? '';
    messages.push({ role: 'assistant', content: finalAnswer });
    return { finalAnswer, toolResults, transcript: messages };
  }

  throw new Error(`agent loop exceeded ${maxSteps} steps without a final answer`);
}
