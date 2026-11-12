#!/usr/bin/env node
/**
 * stdio entry point — lets a separately-built MCP-capable agent connect to the
 * Agent Market over stdio (the bring-your-own-agent demo, TRUST-MODEL.md Model B).
 *
 * Boots an in-memory Hedera stub + a demo provider so the marketplace is usable
 * stand-alone. When Abdellah's real HederaClient + a real provider agent are
 * wired, swap the stub here — the tools and engine are unchanged.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryHederaClient } from '@agent-market/hedera-core';
import { sha256Hex } from '@agent-market/protocol';
import { createMcpServer } from './server.js';
import { MarketplaceEngine } from './engine.js';

async function main(): Promise<void> {
  const hedera = new InMemoryHederaClient();
  const { topicId } = await hedera.createTopic();
  const { tokenId } = await hedera.createToken();

  const engine = new MarketplaceEngine({ hedera, topicId, tokenId });

  // A demo provider so the server is useful on its own.
  const providerAccount = await hedera.createAccount('demo-provider');
  engine.bindAccount('demo-provider', providerAccount.accountId);
  engine.connectProvider(
    {
      providerId: 'demo-provider',
      name: 'Demo Data Provider',
      capabilities: ['dataset'],
      basePrice: 10,
      tokenId,
    },
    {
      providerId: 'demo-provider',
      async quote() {
        return { price: 10, expiresAt: new Date(Date.now() + 60_000).toISOString() };
      },
      async deliver({ jobId }) {
        const data = `demo dataset for ${jobId}`;
        return { resultHash: sha256Hex(data), resultLocation: `mem://datasets/${jobId}` };
      },
    },
  );

  // Give any connecting consumer a funded custodial account under a fixed id.
  const consumerAccount = await hedera.createAccount('external-consumer');
  hedera.grant(consumerAccount.accountId, 1000);
  engine.bindAccount('external-consumer', consumerAccount.accountId);

  const server = createMcpServer({ engine });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now serves tools over stdio until the client disconnects.
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[agent-market-mcp] fatal:', err);
  process.exit(1);
});
