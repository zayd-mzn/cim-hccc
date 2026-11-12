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
  console.log('fund   ', await h.fundJob(jobId, C, P, 30, Math.floor(Date.now() / 1000) + 3600));
  console.log('job    ', await h.getJob(jobId));
  console.log('deliver', await h.deliverJob(jobId, P, 'ab'.repeat(32)));
  console.log('job    ', await h.getJob(jobId));
  await sleep(6000);
  console.log('balances consumer/provider', await h.balanceOf(C), await h.balanceOf(P));
} finally { h.close(); }
