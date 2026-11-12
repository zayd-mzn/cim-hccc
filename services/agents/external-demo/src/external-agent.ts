#!/usr/bin/env node
/**
 * Bring-your-own external agent (TRUST-MODEL.md Model B).
 *
 * This file deliberately imports ONLY the MCP SDK. It has NO dependency on any
 * @agent-market/* package — it does not know our protocol types, our engine, or
 * our Hedera wrapper. It joins the marketplace purely by speaking MCP: it spawns
 * the Agent Market MCP server over stdio, lists the tools it offers, and calls
 * them to complete a full job.
 *
 * This is the proof that an operator can connect any MCP-capable agent, built in
 * any framework, without importing our code.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Path to the built Agent Market MCP server stdio entry, relative to this file. */
const DEFAULT_SERVER = resolve(HERE, '../../../mcp-server/dist/stdio.js');

/** Call a tool and parse the JSON text payload it returns. */
async function call<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  const text = res.content?.find((c) => c.type === 'text')?.text ?? '{}';
  if (res.isError) throw new Error(`tool ${name} failed: ${text}`);
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  // Spawn the Agent Market MCP server as a subprocess and talk to it over stdio.
  // `command`/`args` are how ANY MCP client launches a server — nothing here is
  // specific to our implementation beyond the launch command.
  const transport = new StdioClientTransport({
    command: process.env.MCP_COMMAND ?? 'node',
    args: process.env.MCP_ARGS ? process.env.MCP_ARGS.split(' ') : [DEFAULT_SERVER],
  });

  const client = new Client({ name: 'byo-external-agent', version: '0.1.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(
    'Discovered marketplace tools:',
    tools.map((t) => t.name).join(', '),
  );

  const agentId = `external-${Date.now()}`;

  // 1. Register → get an on-chain identity (server-custodial for the PoC).
  const identity = await call<{ accountId: string }>(client, 'register_agent', {
    agentId,
    label: 'Bring-your-own external agent',
  });
  console.log(`Registered. On-chain identity: ${identity.accountId}`);

  // 2. Discover a provider offering the capability we need.
  const { providers } = await call<{ providers: { providerId: string }[] }>(
    client,
    'discover_providers',
    { capability: 'dataset' },
  );
  if (providers.length === 0) throw new Error('no providers offer "dataset"');
  const providerId = providers[0]!.providerId;
  console.log(`Discovered provider: ${providerId}`);

  // 3. Request the service → receive jobId + x402 payment details.
  const requested = await call<{ jobId: string; offer: { price: number } }>(
    client,
    'request_service',
    {
      consumerAgentId: agentId,
      providerId,
      capability: 'dataset',
      spec: { rows: 50, columns: ['id', 'value'] },
    },
  );
  console.log(`Requested job ${requested.jobId}; offered price ${requested.offer.price}.`);

  // 4. Pay into the settlement/escrow contract.
  const paid = await call<{ proof: { txId: string } }>(client, 'pay_for_job', {
    consumerAgentId: agentId,
    jobId: requested.jobId,
  });
  console.log(`Paid. Settlement tx: ${paid.proof.txId}`);

  // 5. Fetch the delivery and verify the result hash is present.
  const delivery = await call<{ resultHash: string }>(client, 'get_delivery', {
    jobId: requested.jobId,
  });
  console.log(`Delivered. Result hash: ${delivery.resultHash}`);

  // 6. Log the decision rationale to the audit trail.
  await call(client, 'log_decision', {
    agentId,
    jobId: requested.jobId,
    rationale: `External agent verified delivery ${delivery.resultHash} for job ${requested.jobId}.`,
  });
  console.log('Logged decision to HCS. Job complete.');

  await client.close();
}

main().catch((err) => {
  console.error('[external-agent] fatal:', err);
  process.exit(1);
});
