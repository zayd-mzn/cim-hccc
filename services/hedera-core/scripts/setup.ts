/**
 * One-time testnet bootstrap. Creates token, topic, and the 3 custodial accounts, funds the
 * consumer, and writes ids + keys to <repo>/.hedera-state.json (gitignored — contains keys).
 */
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SdkHederaClient } from '../src/sdk-client.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });

const h = SdkHederaClient.fromEnv();
try {
  const { tokenId } = await h.createToken();
  const { topicId } = await h.createTopic();
  const consumer = await h.createAccount('consumer');
  const provider = await h.createAccount('provider');
  const mcp = await h.createAccount('mcp-server');
  await h.transferToken(process.env.OPERATOR_ID!, consumer.accountId, 100_000);
  const out = { tokenId, topicId, consumer, provider, mcp, ...h.exportState() };
  writeFileSync(resolve(root, '.hedera-state.json'), JSON.stringify(out, null, 2));
  console.log({ tokenId, topicId, consumer: consumer.accountId, provider: provider.accountId, mcp: mcp.accountId });
} finally {
  h.close();
}
