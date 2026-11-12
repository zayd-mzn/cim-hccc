/**
 * End-to-end demo: two agents transact through the Agent Market, every step
 * settled on (stub) Hedera and recorded to the HCS audit log.
 *
 * Wiring (all in-process, no testnet, no API key):
 *   InMemoryHederaClient  ← stub for Abdellah's hedera-core
 *   MarketplaceEngine + MCP server (stdio replaced by in-memory transport)
 *   DataProviderAgent     ← the Provider/Data agent
 *   runConsumerAgent      ← the Consumer/Analysis agent (mock LLM plan)
 *
 * Prints the consensus-ordered HCS log at the end — exactly what the dashboard
 * and reputation engine read from Mirror Node (the golden rule: read only from
 * Hedera, never from an agent's private store).
 */
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryHederaClient } from '@agent-market/hedera-core';
import { createMcpServer, MarketplaceEngine } from '@agent-market/mcp-server';
import { DataProviderAgent } from '@agent-market/provider';
import { runConsumerAgent } from './consumer.js';
import { contentHash } from '@agent-market/protocol';

async function main(): Promise<void> {
  // --- Hedera setup (stub) ------------------------------------------------
  const hedera = new InMemoryHederaClient();
  const { topicId } = await hedera.createTopic();
  const { tokenId } = await hedera.createToken();

  // --- Marketplace engine -------------------------------------------------
  const engine = new MarketplaceEngine({ hedera, topicId, tokenId });

  // --- Provider agent -----------------------------------------------------
  const provider = new DataProviderAgent({ tokenId, basePrice: 10, pricePerRow: 0.1 });
  const providerAccount = await hedera.createAccount('provider');
  engine.bindAccount(provider.providerId, providerAccount.accountId);
  engine.connectProvider(provider.profile, provider);

  // --- Consumer agent account (funded) -----------------------------------
  const consumerAgentId = 'analysis-agent';
  const consumerAccount = await hedera.createAccount('consumer');
  hedera.grant(consumerAccount.accountId, 1000);
  engine.bindAccount(consumerAgentId, consumerAccount.accountId);

  console.log('Starting balances:');
  console.log(`  consumer ${consumerAccount.accountId}: ${await hedera.balanceOf(consumerAccount.accountId)} credits`);
  console.log(`  provider ${providerAccount.accountId}: ${await hedera.balanceOf(providerAccount.accountId)} credits`);
  console.log();

  // --- MCP server over an in-memory transport ----------------------------
  const server = createMcpServer({ engine });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const mcp = new Client({ name: 'analysis-agent', version: '0.1.0' });
  await mcp.connect(clientTransport);

  // --- Run the consumer agent --------------------------------------------
  const result = await runConsumerAgent({
    mcp,
    consumerAgentId,
    goal: { capability: 'dataset', spec: { rows: 100, columns: ['id', 'score'] } },
  });

  console.log('Consumer tool calls:');
  for (const tr of result.toolResults) {
    console.log(`  → ${tr.name}: ${JSON.stringify(tr.result)}`);
  }
  console.log(`\nConsumer final answer: ${result.finalAnswer}\n`);

  console.log('Ending balances:');
  console.log(`  consumer ${consumerAccount.accountId}: ${await hedera.balanceOf(consumerAccount.accountId)} credits`);
  console.log(`  provider ${providerAccount.accountId}: ${await hedera.balanceOf(providerAccount.accountId)} credits`);
  console.log();

  // --- The HCS audit log (what the dashboard replays) --------------------
  console.log('HCS audit log (consensus order):');
  const history = hedera.hcsLog.history(topicId);
  for (const entry of history) {
    const m = entry.record.message;
    const integrity = entry.record.contentHash === contentHash(m) ? 'ok' : 'BAD';
    console.log(
      `  #${entry.sequenceNumber} [${m.type}] ${m.fromAgent} → ${m.toAgent}` +
        `  hash=${entry.record.contentHash.slice(0, 12)}… (${integrity})`,
    );
  }

  await mcp.close();
  await server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
