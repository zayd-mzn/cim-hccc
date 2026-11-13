import { describe, expect, it } from 'vitest';
import { InMemoryEscrowClient, InMemoryHederaClient } from '@agent-market/hedera-core';
import { contractJobRef, HANDSHAKE_ORDER } from '@agent-market/protocol';
import { PaymentPayloadSchema, decodeHeader, encodeHeader } from '@agent-market/x402';
import { MarketplaceEngine, type ProviderConnector } from '../src/engine.js';
import { X402PaymentGateway } from '../src/x402-gateway.js';
import { createInMemoryEngine } from '../src/sdk-engine.js';

const provider: ProviderConnector = {
  providerId: 'p1',
  async quote() {
    return { price: 40, expiresAt: new Date(Date.now() + 120_000).toISOString() };
  },
  async deliver({ jobId }) {
    return { resultHash: 'b'.repeat(64), resultLocation: `mem://${jobId}` };
  },
};

async function setup() {
  const hedera = new InMemoryHederaClient();
  const { topicId } = await hedera.createTopic();
  const { tokenId } = await hedera.createToken();
  const escrow = new InMemoryEscrowClient(hedera);
  const payment = new X402PaymentGateway(escrow, hedera);
  const engine = new MarketplaceEngine({ hedera, topicId, tokenId, payment });

  const p = await hedera.createAccount('provider');
  engine.bindAccount('p1', p.accountId);
  engine.connectProvider({ providerId: 'p1', name: 'P1', capabilities: ['dataset'], basePrice: 40, tokenId }, provider);
  const c = await hedera.createAccount('consumer');
  hedera.grant(c.accountId, 1000);
  engine.bindAccount('c1', c.accountId);
  return { hedera, escrow, payment, engine, topicId, p, c };
}

describe('X402PaymentGateway', () => {
  it('runs the full job through x402 and releases escrow on delivery', async () => {
    const { engine, payment, escrow, hedera, p, c } = await setup();
    const { jobId } = await engine.requestService({ consumerAgentId: 'c1', providerId: 'p1', capability: 'dataset', spec: {} });

    const req = payment.requirementsFor(jobId);
    expect(req).toMatchObject({ scheme: 'hedera-escrow', maxAmountRequired: '40', payTo: p.accountId });

    const { proof } = await engine.payForJob({ consumerAgentId: 'c1', jobId });
    expect(proof.contractJobRef).toBe(contractJobRef(jobId));
    expect((await escrow.getJob(jobId)).status).toBe('Held');

    await engine.getDelivery({ jobId });
    expect((await escrow.getJob(jobId)).status).toBe('Released');
    expect(await hedera.balanceOf(c.accountId)).toBe(960);
    expect(await hedera.balanceOf(p.accountId)).toBe(40);
    expect(hedera.hcsLog.jobHistory(jobId).map((e) => e.record.message.type)).toEqual([...HANDSHAKE_ORDER]);
  });

  it('rejects a proof whose signed pay message was tampered with', async () => {
    const { engine, payment } = await setup();
    const { jobId } = await engine.requestService({ consumerAgentId: 'c1', providerId: 'p1', capability: 'dataset', spec: {} });
    const challenge = engine.getJob(jobId)!.paymentRequired!;
    const proof = await payment.pay(challenge, engine.getJob(jobId)!.consumerAccountId);
    expect(await payment.verify(proof)).toBe(true);

    const decoded = decodeHeader(proof.x402!, PaymentPayloadSchema);
    decoded.payload.payMessage.toAgent = '0.0.1';
    expect(await payment.verify({ ...proof, x402: encodeHeader(decoded) })).toBe(false);
    expect(payment.lastFailure(jobId)).toMatch(/different provider/);
  });

  it('rejects a proof without an X-PAYMENT payload', async () => {
    const { engine, payment } = await setup();
    const { jobId } = await engine.requestService({ consumerAgentId: 'c1', providerId: 'p1', capability: 'dataset', spec: {} });
    const ok = await payment.verify({ jobId, txId: 't', contractJobRef: contractJobRef(jobId), amount: 40 });
    expect(ok).toBe(false);
  });

  it('is selectable from createInMemoryEngine', async () => {
    const { engine } = await createInMemoryEngine({ useX402: true });
    expect(engine).toBeInstanceOf(MarketplaceEngine);
  });
});
