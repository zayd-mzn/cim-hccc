import { describe, it, expect } from 'vitest';
import { OpenAiLlmClient } from '../src/openai-llm.js';
import type { LlmMessage, LlmToolSpec } from '../src/llm.js';

const TOOLS: LlmToolSpec[] = [
  { name: 'discover_providers', description: 'find', parameters: { type: 'object', properties: {} } },
];

/** Build a fake fetch that returns a canned chat-completions response. */
function fakeFetch(response: unknown, capture?: (body: unknown) => void): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    if (capture && init?.body) capture(JSON.parse(init.body as string));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => response,
      text: async () => JSON.stringify(response),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('OpenAiLlmClient', () => {
  it('parses a tool call from the completion', async () => {
    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      fetchImpl: fakeFetch({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'x',
                  type: 'function',
                  function: { name: 'discover_providers', arguments: '{"capability":"dataset"}' },
                },
              ],
            },
          },
        ],
      }),
    });
    const res = await client.next({
      messages: [{ role: 'user', content: 'go' }],
      tools: TOOLS,
    });
    expect(res.toolCall).toEqual({
      name: 'discover_providers',
      arguments: { capability: 'dataset' },
    });
  });

  it('returns final content when no tool call', async () => {
    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      fetchImpl: fakeFetch({
        choices: [{ message: { role: 'assistant', content: 'all done' } }],
      }),
    });
    const res = await client.next({ messages: [], tools: TOOLS });
    expect(res.content).toBe('all done');
    expect(res.toolCall).toBeUndefined();
  });

  it('sends tools and pairs tool results with their call ids', async () => {
    let sent: { messages?: Array<{ role: string; tool_call_id?: string; tool_calls?: unknown[] }>; tools?: unknown[] } = {};
    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      fetchImpl: fakeFetch(
        { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
        (b) => {
          sent = b as typeof sent;
        },
      ),
    });
    const messages: LlmMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: '', toolCall: { name: 'discover_providers', arguments: {} } },
      { role: 'tool', toolName: 'discover_providers', content: '{"providers":[]}' },
    ];
    await client.next({ messages, tools: TOOLS });

    expect(sent.tools).toHaveLength(1);
    const assistantMsg = sent.messages!.find((m) => m.tool_calls);
    const toolMsg = sent.messages!.find((m) => m.role === 'tool');
    // The assistant tool_call id and the following tool result id must match.
    expect((assistantMsg!.tool_calls![0] as { id: string }).id).toBe(toolMsg!.tool_call_id);
  });

  it('throws without an api key', () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAiLlmClient()).toThrow(/apiKey/);
    if (prev) process.env.OPENAI_API_KEY = prev;
  });
});
