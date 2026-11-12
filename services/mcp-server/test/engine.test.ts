import { describe, it, expect } from 'vitest';
import { InMemoryHederaClient } from '@agent-market/hedera-core';
import { contentHash, HANDSHAKE_ORDER } from '@agent-market/protocol';
import { MarketplaceEngine } from '../src/engine.js';
import type { ProviderConnector } from '../src/engine.js';

function stubProvider(providerId: string): ProviderConnector {
  return {
    providerId,
    async quote() {
      return { price: 25, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
    async deliver({ jobId }) {
      return { resultHash: 'a'.repeat(64), resultLocation: `mem://${jobId}` };
    },
  };
}

async function setup() {
  const hedera = new InMemoryHederaClient();
  const { topicId } = await hedera.createTopic();
  const { tokenId } = await hedera.createToken();
  const engine = new MarketplaceEngine({ hedera, topicId, tokenId });

  const providerAccount = await hedera.createAccount('provider');
  engine.bindAccount('p1', providerAccount.accountId);
  engine.connectProvider(
    { providerId: 'p1', name: 'P1', capabilities: ['dataset'], basePrice: 25, tokenId },
    stubProvider('p1'),
  );

  const consumerAccount = await hedera.createAccount('consumer');
  hedera.grant(consumerAccount.accountId, 1000);
  engine.bindAccount('c1', consumerAccount.accountId);

  return { hedera, topicId, engine, providerAccount, consumerAccount };
}

describe('MarketplaceEngine end-to-end', () => {
  it('runs request → pay → deliver, moves funds, and logs 5 handshake messages', async () => {
    const { hedera, topicId, engine, providerAccount, consumerAccount } = await setup();

    const { jobId, paymentRequired } = await engine.requestService({
      consumerAgentId: 'c1',
      providerId: 'p1',
      capability: 'dataset',
      spec: { rows: 10 },
    });
    expect(paymentRequired.amount).toBe(25);

    await engine.payForJob({ consumerAgentId: 'c1', jobId });
    const delivery = await engine.getDelivery({ jobId });
    expect(delivery.resultHash).toHaveLength(64);

    // Escrow released: consumer -25, provider +25.
    expect(await hedera.balanceOf(consumerAccount.accountId)).toBe(975);
    expect(await hedera.balanceOf(providerAccount.accountId)).toBe(25);

    // HCS log contains the ordered handshake.
    const types = hedera.hcsLog.jobHistory(jobId).map((e) => e.record.message.type);
    expect(types).toEqual([...HANDSHAKE_ORDER]);

    // Every record's content hash verifies, and every signature verifies.
    for (const entry of hedera.hcsLog.jobHistory(jobId)) {
      expect(entry.record.contentHash).toBe(contentHash(entry.record.message));
      expect(await hedera.verifyMessage(entry.record.message)).toBe(true);
    }
  });

  it('discover_providers finds by capability', async () => {
    const { engine } = await setup();
    expect(engine.discoverProviders('dataset').map((p) => p.providerId)).toEqual(['p1']);
    expect(engine.discoverProviders('nope')).toEqual([]);
  });

  it('rejects delivery before payment', async () => {
    const { engine } = await setup();
    const { jobId } = await engine.requestService({
      consumerAgentId: 'c1',
      providerId: 'p1',
      capability: 'dataset',
      spec: {},
    });
    await expect(engine.getDelivery({ jobId })).rejects.toThrow(/not paid/);
  });

  it('registerAgent provisions a funded custodial account and is idempotent', async () => {
    const { hedera, engine } = await setup();
    const first = await engine.registerAgent({ agentId: 'ext', initialGrant: 500 });
    expect(first.accountId).toMatch(/^0\.0\./);
    expect(engine.hasAccount('ext')).toBe(true);
    expect(await hedera.balanceOf(first.accountId)).toBe(500);

    // Idempotent: same agentId returns the same account, no double funding.
    const second = await engine.registerAgent({ agentId: 'ext', initialGrant: 500 });
    expect(second.accountId).toBe(first.accountId);
    expect(await hedera.balanceOf(first.accountId)).toBe(500);
  });

  it('a registered agent can run the full flow end-to-end', async () => {
    const { hedera, engine } = await setup();
    await engine.registerAgent({ agentId: 'ext', initialGrant: 1000 });
    const { jobId } = await engine.requestService({
      consumerAgentId: 'ext',
      providerId: 'p1',
      capability: 'dataset',
      spec: { rows: 10 },
    });
    await engine.payForJob({ consumerAgentId: 'ext', jobId });
    const delivery = await engine.getDelivery({ jobId });
    expect(delivery.resultHash).toHaveLength(64);
    expect(engine.getJob(jobId)?.status).toBe('released');
  });
});
