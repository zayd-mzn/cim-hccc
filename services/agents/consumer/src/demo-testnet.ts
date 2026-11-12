/**
 * Testnet end-to-end demo: the SAME two-agent loop as demo.ts, but settled on
 * real Hedera testnet — real HTS transfers, the real AgentEscrow contract, and
 * the real HCS audit topic.
 *
 * Requires (gitignored, never committed):
 *   .env                → OPERATOR_ID / OPERATOR_KEY
 *   .hedera-state.json  → token/topic/escrow ids + custodial keys
 *
 * Uses the accounts Abdellah's setup provisioned:
 *   provider  = state.provider   consumer = state.consumer
 *
 * Run: pnpm demo:testnet
 */
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpServer, createSdkEngine } from '@agent-market/mcp-server';
import { DataProviderAgent } from '@agent-market/provider';
import { contentHash } from '@agent-market/protocol';
import { runConsumerAgent } from './consumer.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

async function main(): Promise<void> {
  // Load .env (Node >= 20.12 provides process.loadEnvFile).
  try {
    process.loadEnvFile(resolve(REPO_ROOT, '.env'));
  } catch {
    console.error('Could not load .env — set OPERATOR_ID / OPERATOR_KEY. Aborting.');
    process.exit(1);
  }

  console.log('Wiring engine to Hedera testnet (real token, escrow contract, HCS topic)…');
  const { engine, hedera, topicId, tokenId, state } = await createSdkEngine({ repoRoot: REPO_ROOT });

  const providerAccountId = state.provider.accountId;
  const consumerAccountId = state.consumer.accountId;

  console.log(`  token  ${tokenId}`);
  console.log(`  topic  ${topicId}`);
  console.log(`  escrow ${hedera.escrowAddress}`);
  console.log(`  provider ${providerAccountId} · consumer ${consumerAccountId}\n`);

  // Bind the provisioned testnet accounts to agent ids.
  const provider = new DataProviderAgent({ tokenId, basePrice: 10, pricePerRow: 0.1 });
  engine.bindAccount(provider.providerId, providerAccountId);
  engine.connectProvider(provider.profile, provider);

  const consumerAgentId = 'analysis-agent';
  engine.bindAccount(consumerAgentId, consumerAccountId);

  console.log('Starting balances (Mirror Node — may lag a few seconds):');
  console.log(`  consumer: ${await hedera.balanceOf(consumerAccountId)} credits`);
  console.log(`  provider: ${await hedera.balanceOf(providerAccountId)} credits\n`);

  // MCP server over an in-memory transport (the agent still speaks only MCP).
  const server = createMcpServer({ engine, registrationGrant: 0 });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'analysis-agent', version: '0.1.0' });
  await mcp.connect(clientTransport);

  console.log('Running the consumer agent against testnet (this takes ~30-60s)…\n');
  const result = await runConsumerAgent({
    mcp,
    consumerAgentId,
    goal: { capability: 'dataset', spec: { rows: 50, columns: ['id', 'score'] } },
    // On-chain tool calls chain several HCS writes + contract calls; give them room.
    callTimeoutMs: 120_000,
  });

  console.log('Consumer tool calls:');
  for (const tr of result.toolResults) {
    console.log(`  → ${tr.name}: ${JSON.stringify(tr.result)}`);
  }
  console.log(`\nConsumer final answer: ${result.finalAnswer}\n`);

  console.log('Ending balances (Mirror Node):');
  console.log(`  consumer: ${await hedera.balanceOf(consumerAccountId)} credits`);
  console.log(`  provider: ${await hedera.balanceOf(providerAccountId)} credits\n`);

  console.log('HCS audit log (consensus order):');
  // SdkHederaClient writes to the real topic; read it back from Mirror Node.
  const records = await fetchTopicMessages(topicId);
  for (const rec of records) {
    const m = rec.message;
    const integrity = rec.contentHash === contentHash(m) ? 'ok' : 'BAD';
    console.log(
      `  #${rec.sequenceNumber} [${m.type}] ${m.fromAgent} → ${m.toAgent}` +
        `  hash=${rec.contentHash.slice(0, 12)}… (${integrity})`,
    );
  }

  await mcp.close();
  await server.close();
  hedera.close();
}

/** Read the HCS topic back from the testnet Mirror Node. */
async function fetchTopicMessages(
  topicId: string,
): Promise<Array<{ message: ReturnType<typeof JSON.parse>; contentHash: string; sequenceNumber: number }>> {
  const url = `https://testnet.mirrornode.hedera.com/api/v1/topics/${topicId}/messages?limit=25&order=asc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mirror node ${res.status}`);
  const json = (await res.json()) as { messages?: Array<{ message: string; sequence_number: number }> };
  return (json.messages ?? []).map((m) => {
    const decoded = JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'));
    return {
      message: decoded.message,
      contentHash: decoded.contentHash,
      sequenceNumber: m.sequence_number,
    };
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
