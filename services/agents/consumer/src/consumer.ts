/**
 * Consumer/Analysis agent.
 *
 * Drives an LLM tool-calling loop against the Agent Market MCP server to:
 *   discover_providers → request_service → pay_for_job → get_delivery → verify hash
 *
 * The LLM is provider-agnostic (agent-kit). For the PoC we supply a MockLlmClient
 * plan so the loop runs with no API key; a real LlmClient slots in unchanged.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MockLlmClient, runAgentLoop, type AgentRunResult, type LlmClient } from '@agent-market/agent-kit';

export const CONSUMER_SYSTEM_PROMPT = [
  'You are the Analysis agent in the Agent Market.',
  'You need to acquire a dataset from a provider, pay for it through the on-chain',
  'settlement contract, and verify the delivered result hash.',
  'Use the marketplace tools in this order: discover_providers, request_service,',
  'pay_for_job, get_delivery. Log a short rationale with log_decision when useful.',
  'Everything you do is recorded to the HCS audit log — act accountably.',
].join(' ');

export interface ConsumerGoal {
  capability: string;
  spec: Record<string, unknown>;
}

export interface RunConsumerOptions {
  mcp: Client;
  /** Agent id bound to this consumer's custodial account in the engine. */
  consumerAgentId: string;
  goal: ConsumerGoal;
  /** Real LLM client; if omitted a deterministic mock plan is used. */
  llm?: LlmClient;
  maxSteps?: number;
  /** Per-tool-call timeout (ms). Raise for slow on-chain (testnet) calls. */
  callTimeoutMs?: number;
}

/**
 * Build the deterministic mock plan that realises the consumer flow. Each step
 * chains off prior tool results (e.g. picks the first discovered provider, reuses
 * the jobId from request_service).
 */
function buildMockPlan(opts: RunConsumerOptions): LlmClient {
  const { consumerAgentId, goal } = opts;
  return new MockLlmClient({
    steps: [
      {
        toolName: 'discover_providers',
        arguments: () => ({ capability: goal.capability }),
      },
      {
        toolName: 'request_service',
        arguments: ({ toolResults }) => {
          const discovered = toolResults[0] as { providers: { providerId: string }[] };
          const providerId = discovered.providers[0]?.providerId;
          if (!providerId) throw new Error('no provider discovered for capability');
          return { consumerAgentId, providerId, capability: goal.capability, spec: goal.spec };
        },
      },
      {
        toolName: 'pay_for_job',
        arguments: ({ toolResults }) => {
          const requested = toolResults[1] as { jobId: string };
          return { consumerAgentId, jobId: requested.jobId };
        },
      },
      {
        toolName: 'get_delivery',
        arguments: ({ toolResults }) => {
          const requested = toolResults[1] as { jobId: string };
          return { jobId: requested.jobId };
        },
      },
      {
        toolName: 'log_decision',
        arguments: ({ toolResults }) => {
          const requested = toolResults[1] as { jobId: string };
          const delivery = toolResults[3] as { resultHash: string };
          return {
            agentId: consumerAgentId,
            jobId: requested.jobId,
            rationale: `Verified delivery hash ${delivery.resultHash}; job complete.`,
          };
        },
      },
    ],
    finalAnswer: 'Dataset acquired, paid for, and delivery hash verified.',
  });
}

export async function runConsumerAgent(opts: RunConsumerOptions): Promise<AgentRunResult> {
  const llm = opts.llm ?? buildMockPlan(opts);
  return runAgentLoop({
    llm,
    mcp: opts.mcp,
    systemPrompt: CONSUMER_SYSTEM_PROMPT,
    goal: `Acquire a "${opts.goal.capability}" dataset with spec ${JSON.stringify(opts.goal.spec)}.`,
    maxSteps: opts.maxSteps,
    callTimeoutMs: opts.callTimeoutMs,
  });
}
