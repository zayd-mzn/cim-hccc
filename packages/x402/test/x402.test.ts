import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { InMemoryEscrowClient, InMemoryHederaClient } from '@agent-market/hedera-core';
import { contractJobRef } from '@agent-market/protocol';
import {
  PAYMENT_HEADER,
  PaymentRequiredResponseSchema,
  buildPaymentRequirements,
  buildSignedPayMessage,
  createEscrowPayer,
  encodeHeader,
  fetchWithX402,
  toPaymentPayload,
  withX402,
  type PaymentRequirements,
} from '../src/index.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function setup(price = 25) {
  const hedera = new InMemoryHederaClient();
  const { tokenId } = await hedera.createToken();
  const escrow = new InMemoryEscrowClient(hedera);
  const consumer = await hedera.createAccount('consumer');
  const provider = await hedera.createAccount('provider');
  hedera.grant(consumer.accountId, 1000);

  const jobId = randomUUID();
  const offers = new Map<string, PaymentRequirements>();
  const paid: string[] = [];

  const server = createServer(
    withX402(
      {
        escrow,
        verifySignature: (m) => hedera.verifyMessage(m),
        requirements: (req) => {
          const id = /^\/jobs\/([^/]+)\/result$/.exec(req.url ?? '')?.[1];
          return (id && offers.get(id)) || null;
        },
        onPaid: (ctx) => {
          paid.push(ctx.payMessage.jobId);
        },
      },
      (_req, res, ctx) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jobId: ctx.requirements.extra.jobId, rows: [1, 2, 3] }));
      },
    ),
  );
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const url = `${base}/jobs/${jobId}/result`;

  const requirements = buildPaymentRequirements(
    {
      jobId,
      amount: price,
      tokenId,
      contractAddress: escrow.escrowAddress,
      providerAccountId: provider.accountId,
      deadline: Math.floor(Date.now() / 1000) + 600,
    },
    { resource: url },
  );
  offers.set(jobId, requirements);

  const payer = createEscrowPayer({
    payer: consumer.accountId,
    escrow,
    sign: (a, m) => hedera.signMessage(a, m),
  });

  return { hedera, escrow, consumer, provider, jobId, url, requirements, payer, paid, offers, base };
}

function withPayment(header: string): RequestInit {
  return { headers: { [PAYMENT_HEADER]: header } };
}

describe('x402 over Hedera escrow', () => {
  it('answers 402 with payment requirements when no proof is sent', async () => {
    const { url, jobId } = await setup();
    const res = await fetch(url);
    expect(res.status).toBe(402);
    const body = PaymentRequiredResponseSchema.parse(await res.json());
    expect(body.accepts[0]!.extra.jobId).toBe(jobId);
    expect(body.accepts[0]!.extra.contractJobRef).toBe(contractJobRef(jobId));
    expect(body.accepts[0]!.maxAmountRequired).toBe('25');
  });

  it('returns 404 for an unknown resource', async () => {
    const { base } = await setup();
    expect((await fetch(`${base}/jobs/nope/result`)).status).toBe(404);
  });

  it('runs 402 → pay into escrow → retry with proof → 200', async () => {
    const { url, jobId, payer, escrow, hedera, consumer, provider, paid } = await setup();
    const { response, payment } = await fetchWithX402(url, {}, { pay: payer });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobId });
    expect(payment?.settlement).toMatchObject({ success: true, jobId, payer: consumer.accountId });
    expect(paid).toEqual([jobId]);

    const job = await escrow.getJob(jobId);
    expect(job).toMatchObject({ status: 'Held', amount: 25, provider: provider.accountId });
    expect(await hedera.balanceOf(consumer.accountId)).toBe(975);
    expect(payment?.payMessage.payload.contractJobRef).toBe(contractJobRef(jobId));
  });

  it('does not pay when the agent refuses the price', async () => {
    const { url, jobId, payer, escrow } = await setup(500);
    const { response, payment } = await fetchWithX402(url, {}, {
      pay: payer,
      approve: (r) => Number(r.maxAmountRequired) <= 100,
    });
    expect(response.status).toBe(402);
    expect(payment).toBeUndefined();
    expect((await escrow.getJob(jobId)).status).toBe('None');
  });

  it('enforces the payer spend guard', async () => {
    const { url, escrow, consumer, hedera } = await setup(500);
    const guarded = createEscrowPayer({
      payer: consumer.accountId,
      escrow,
      sign: (a, m) => hedera.signMessage(a, m),
      maxAmount: 100,
    });
    await expect(fetchWithX402(url, {}, { pay: guarded })).rejects.toThrow(/exceeds max/);
  });

  it('rejects a signed pay message when nothing was put in escrow', async () => {
    const { url, jobId, consumer, provider, hedera } = await setup();
    const forged = await buildSignedPayMessage({
      jobId,
      payer: consumer.accountId,
      provider: provider.accountId,
      amount: 25,
      txId: 'fake-tx',
      contractJobRef: contractJobRef(jobId),
      sign: (a, m) => hedera.signMessage(a, m),
    });
    const res = await fetch(url, withPayment(encodeHeader(toPaymentPayload(forged))));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/escrow is None/);
  });

  it('rejects a proof whose signature does not match', async () => {
    const { url, requirements, payer } = await setup();
    const pay = await payer(requirements);
    const tampered = { ...pay, payload: { ...pay.payload, amount: 9999 } };
    const res = await fetch(url, withPayment(encodeHeader(toPaymentPayload(tampered))));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/invalid signature/);
  });

  it('rejects a valid proof replayed against a different job', async () => {
    const ctx = await setup();
    const pay = await ctx.payer(ctx.requirements);

    const otherJob = randomUUID();
    const otherReq = { ...ctx.requirements, extra: { ...ctx.requirements.extra, jobId: otherJob, contractJobRef: contractJobRef(otherJob) } };
    ctx.offers.set(otherJob, otherReq);
    const res = await fetch(`${ctx.base}/jobs/${otherJob}/result`, withPayment(encodeHeader(toPaymentPayload(pay))));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/different job/);
  });

  it('rejects a malformed header', async () => {
    const { url } = await setup();
    const res = await fetch(url, withPayment('not-base64-json'));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/malformed/);
  });
});
