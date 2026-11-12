/**
 * Agent Market MCP server.
 *
 * Exposes marketplace operations as MCP tools (SPEC.md Layer 6):
 *   discover_providers(capability)
 *   request_service(providerId, spec)  → jobId + x402 payment details
 *   pay_for_job(jobId)                  → drives payment into settlement contract
 *   get_delivery(jobId)                 → result + hash after delivery
 *   log_decision(jobId, rationale)      → writes reasoning to HCS
 *
 * Any separately-built, MCP-capable agent connects and calls these tools without
 * importing our protocol code (TRUST-MODEL.md Model B).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MarketplaceEngine } from './engine.js';

/**
 * Identifies which connected agent is making the call. For the PoC the agent
 * passes its agentId; the server maps it to a custodial Hedera account.
 * (Agent-custodial identity is future work — TRUST-MODEL.md.)
 */
const agentIdField = z
  .string()
  .describe('Id of the calling agent (bound to a server-custodial Hedera account)');

export interface CreateMcpServerOptions {
  engine: MarketplaceEngine;
  name?: string;
  version?: string;
  /**
   * Credits granted to a newly registered agent's custodial account (PoC only).
   * Default 1000. Set 0 to disable auto-funding.
   */
  registrationGrant?: number;
}

export function createMcpServer(opts: CreateMcpServerOptions): McpServer {
  const { engine } = opts;
  const server = new McpServer({
    name: opts.name ?? 'agent-market-mcp',
    version: opts.version ?? '0.1.0',
  });

  function ok(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
  }

  server.registerTool(
    'register_agent',
    {
      description:
        'Register this agent with the marketplace. Provisions a server-custodial Hedera account and returns its identity. Call once before using other tools. Idempotent.',
      inputSchema: {
        agentId: z
          .string()
          .describe('A stable id you choose for this agent; present it on later calls'),
        label: z.string().optional().describe('Human-friendly label'),
      },
    },
    async ({ agentId, label }) => {
      const identity = await engine.registerAgent({
        agentId,
        label,
        initialGrant: opts.registrationGrant ?? 1000,
      });
      return ok(identity);
    },
  );

  server.registerTool(
    'discover_providers',
    {
      description: 'Find providers advertising a given capability.',
      inputSchema: { capability: z.string().describe('Capability to search for, e.g. "dataset"') },
    },
    async ({ capability }) => {
      const providers = engine.discoverProviders(capability).map((p) => ({
        providerId: p.providerId,
        name: p.name,
        capabilities: p.capabilities,
        basePrice: p.basePrice,
        tokenId: p.tokenId,
      }));
      return ok({ providers });
    },
  );

  server.registerTool(
    'request_service',
    {
      description:
        'Request a service from a provider. Logs request+offer to HCS and returns a jobId plus x402 payment details (402 Payment Required).',
      inputSchema: {
        consumerAgentId: agentIdField,
        providerId: z.string(),
        capability: z.string(),
        spec: z.record(z.unknown()).describe('Type-specific request spec'),
      },
    },
    async ({ consumerAgentId, providerId, capability, spec }) => {
      const result = await engine.requestService({ consumerAgentId, providerId, capability, spec });
      return ok(result);
    },
  );

  server.registerTool(
    'pay_for_job',
    {
      description:
        'Accept the offer and pay into the settlement/escrow contract for a job. Logs accept+pay to HCS and returns proof-of-payment.',
      inputSchema: {
        consumerAgentId: agentIdField,
        jobId: z.string(),
      },
    },
    async ({ consumerAgentId, jobId }) => {
      const result = await engine.payForJob({ consumerAgentId, jobId });
      return ok(result);
    },
  );

  server.registerTool(
    'get_delivery',
    {
      description:
        'Fetch the delivered result for a paid job. Provider delivers result+hash, escrow releases to provider, deliver is logged to HCS.',
      inputSchema: { jobId: z.string() },
    },
    async ({ jobId }) => {
      const result = await engine.getDelivery({ jobId });
      return ok(result);
    },
  );

  server.registerTool(
    'log_decision',
    {
      description: "Write an agent's decision rationale to the HCS audit log.",
      inputSchema: {
        agentId: agentIdField,
        jobId: z.string(),
        rationale: z.string(),
      },
    },
    async ({ agentId, jobId, rationale }) => {
      const result = await engine.logDecision({ agentId, jobId, rationale });
      return ok(result);
    },
  );

  return server;
}
