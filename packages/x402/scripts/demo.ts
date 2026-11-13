/**
 * x402 demo: a Provider serves a dataset behind HTTP 402; a Consumer agent hits
 * it, gets "402 Payment Required", funds the escrow, and retries with proof.
 *
 *   pnpm --filter @agent-market/x402 demo
 *
 * Local chain (in-memory Hedera + AgentEscrow semantics), real HTTP.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { InMemoryEscrowClient, InMemoryHederaClient } from '@agent-market/hedera-core';
import {
  PaymentRequiredResponseSchema,
  buildPaymentRequirements,
  createEscrowPayer,
  fetchWithX402,
  withX402,
  type PaymentRequirements,
} from '../src/index.js';

async function main(): Promise<void> {
  const hedera = new InMemoryHederaClient();
  const { tokenId } = await hedera.createToken();
  const escrow = new InMemoryEscrowClient(hedera);
  const consumer = await hedera.createAccount('consumer');
  const provider = await hedera.createAccount('provider');
  hedera.grant(consumer.accountId, 100);

  const offers = new Map<string, PaymentRequirements>();
  const server = createServer(
    withX402(
      {
        escrow,
        verifySignature: (m) => hedera.verifyMessage(m),
        requirements: (req) => offers.get(/^\/jobs\/([^/]+)\/result$/.exec(req.url ?? '')?.[1] ?? '') ?? null,
      },
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ dataset: [{ city: 'Rabat', aqi: 41 }, { city: 'Casablanca', aqi: 57 }] }));
      },
    ),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  const jobId = randomUUID();
  const url = `http://127.0.0.1:${port}/jobs/${jobId}/result`;
  offers.set(
    jobId,
    buildPaymentRequirements(
      {
        jobId,
        amount: 25,
        tokenId,
        contractAddress: escrow.escrowAddress,
        providerAccountId: provider.accountId,
        deadline: Math.floor(Date.now() / 1000) + 300,
      },
      { resource: url, description: 'Air-quality dataset' },
    ),
  );

  console.log(`\n1) GET ${url} (no payment)`);
  const bare = await fetch(url);
  const challenge = PaymentRequiredResponseSchema.parse(await bare.json());
  console.log(`   ← ${bare.status} Payment Required: ${challenge.accepts[0]!.maxAmountRequired} credits to ${challenge.accepts[0]!.payTo} via ${challenge.accepts[0]!.scheme}`);

  console.log('\n2) Consumer pays into escrow and retries with X-PAYMENT');
  const payer = createEscrowPayer({ payer: consumer.accountId, escrow, sign: (a, m) => hedera.signMessage(a, m), maxAmount: 50 });
  const { response, payment } = await fetchWithX402(url, {}, { pay: payer });
  console.log(`   ← ${response.status}`, await response.json());
  console.log(`   settlement: tx ${payment?.settlement?.txId} payer ${payment?.settlement?.payer}`);

  const job = await escrow.getJob(jobId);
  console.log(`\n3) Escrow ${job.status}: ${job.amount} credits locked until the provider delivers`);
  console.log(`   consumer balance ${await hedera.balanceOf(consumer.accountId)}, provider ${await hedera.balanceOf(provider.accountId)}`);

  await escrow.deliverJob(jobId, provider.accountId, 'c'.repeat(64));
  console.log(`\n4) Delivered → escrow ${(await escrow.getJob(jobId)).status}; provider balance ${await hedera.balanceOf(provider.accountId)}\n`);
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
