import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryHederaClient } from '@agent-market/hedera-core';
import { createMcpServer, MarketplaceEngine } from '@agent-market/mcp-server';
import { DataProviderAgent } from '@agent-market/provider';
import { runConsumerAgent } from '../src/consumer.js';

async function bootMarketplace() {
  const hedera = new InMemoryHederaClient();
  const { topicId } = await hedera.createTopic();
  const { tokenId } = await hedera.createToken();
  const engine = new MarketplaceEngine({ hedera, topicId, tokenId });

  const provider = new DataProviderAgent({ tokenId, basePrice: 10, pricePerRow: 0.1 });
  const providerAccount = await hedera.createAccount('provider');
  engine.bindAccount(provider.providerId, providerAccount.accountId);
  engine.connectProvider(provider.profile, provider);

  const consumerAccount = await hedera.createAccount('consumer');
  hedera.grant(consumerAccount.accountId, 1000);
  engine.bindAccount('analysis-agent', consumerAccount.accountId);

  const server = createMcpServer({ engine });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'test-consumer', version: '0.1.0' });
  await mcp.connect(clientTransport);

  return { hedera, topicId, mcp, server, providerAccount, consumerAccount };
}

describe('Consumer agent via MCP', () => {
  it('completes discover → request → pay → deliver through MCP tools', async () => {
    const { hedera, topicId, mcp, server, providerAccount, consumerAccount } =
      await bootMarketplace();

    const result = await runConsumerAgent({
      mcp,
      consumerAgentId: 'analysis-agent',
      goal: { capability: 'dataset', spec: { rows: 100 } },
    });

    const toolNames = result.toolResults.map((t) => t.name);
    expect(toolNames).toEqual([
      'discover_providers',
      'request_service',
      'pay_for_job',
      'get_delivery',
      'log_decision',
    ]);

    const delivery = result.toolResults[3]?.result as { resultHash: string };
    expect(delivery.resultHash).toHaveLength(64);

    // Price = 10 + 100*0.1 = 20; funds moved accordingly.
    expect(await hedera.balanceOf(consumerAccount.accountId)).toBe(980);
    expect(await hedera.balanceOf(providerAccount.accountId)).toBe(20);

    // HCS captured the handshake (5) + the decision log (1).
    expect(hedera.hcsLog.history(topicId).length).toBe(6);

    await mcp.close();
    await server.close();
  });
});
