/**
 * MockLlmClient — a scripted "LLM" that drives the agent loop deterministically.
 *
 * It follows a fixed plan of tool calls (provided at construction), emitting one
 * per turn and a final answer at the end. This lets the whole agent↔MCP↔Hedera
 * loop run and be tested with zero API key. Replace with a real LlmClient for
 * the demo; the agent code is identical.
 */
import type { LlmClient, LlmResponse, LlmMessage, LlmToolSpec } from './llm.js';

export interface MockStep {
  toolName: string;
  /**
   * Build the tool arguments from the current conversation. Receives prior tool
   * results (parsed JSON, newest last) so steps can chain (e.g. use the jobId
   * returned by request_service in pay_for_job).
   */
  arguments: (ctx: { toolResults: unknown[] }) => Record<string, unknown>;
}

export interface MockLlmClientOptions {
  steps: MockStep[];
  finalAnswer?: string;
}

export class MockLlmClient implements LlmClient {
  private index = 0;
  constructor(private readonly opts: MockLlmClientOptions) {}

  async next(input: { messages: LlmMessage[]; tools: LlmToolSpec[] }): Promise<LlmResponse> {
    const step = this.opts.steps[this.index];
    if (!step) {
      return { content: this.opts.finalAnswer ?? 'done' };
    }
    this.index += 1;
    const toolResults = input.messages
      .filter((m) => m.role === 'tool')
      .map((m) => {
        try {
          return JSON.parse(m.content);
        } catch {
          return m.content;
        }
      });
    return { toolCall: { name: step.toolName, arguments: step.arguments({ toolResults }) } };
  }
}
