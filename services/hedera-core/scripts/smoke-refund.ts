/** Testnet check of the refund path: fund with a short deadline, try early refund (must fail), refund after. */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SdkHederaClient } from '../src/sdk-client.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });
const s = JSON.parse(readFileSync(resolve(root, '.hedera-state.json'), 'utf8'));
const h = SdkHederaClient.fromEnv(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const C = s.consumer.accountId, P = s.provider.accountId;
try {
  const jobId = randomUUID();
  const before = await h.balanceOf(C);
  await h.fundJob(jobId, C, P, 20, Math.floor(Date.now() / 1000) + 25);
  console.log('funded; status', (await h.getJob(jobId)).status);
  try { await h.refundJob(jobId, C); console.log('EARLY REFUND SUCCEEDED (BUG)'); }
  catch (e) { console.log('early refund rejected as expected:', String(e).split('\n')[0].slice(0, 90)); }
  await sleep(35_000);
  await h.refundJob(jobId, C);
  console.log('refunded; status', (await h.getJob(jobId)).status);
  try { await h.deliverJob(jobId, P, 'ab'.repeat(32)); console.log('DELIVER AFTER REFUND SUCCEEDED (BUG)'); }
  catch (e) { console.log('deliver after refund rejected as expected'); }
  await sleep(6000);
  console.log('consumer balance before/after', before, await h.balanceOf(C));
} finally { h.close(); }
