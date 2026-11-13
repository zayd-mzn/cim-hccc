import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { InMemoryHederaClient } from '@agent-market/hedera-core';
import {
  buildAccept,
  buildDeliver,
  buildOffer,
  buildPay,
  buildRequest,
  contractJobRef,
  toHcsRecord,
  type AgentMessage,
} from '@agent-market/protocol';
import {
  EVENT_TOPICS,
  MirrorNodeClient,
  ReputationEngine,
  computeReputation,
  decodeEscrowLog,
  hcsLogSource,
  type EscrowEvent,
  type TopicEntry,
} from '../src/index.js';

const T0 = Date.parse('2026-11-13T10:00:00Z');
const C = '0.0.100';
const P_FAST = '0.0.200';
const P_SLOW = '0.0.300';

/** Builds a topic the way the Mirror Node serves it, with chosen consensus times. */
class Topic {
  entries: TopicEntry[] = [];
  private seq = 0;
  push(message: AgentMessage, atMs: number, mutate?: (r: ReturnType<typeof toHcsRecord>) => void): void {
    const record = toHcsRecord({ ...message, signature: 'sig' });
    mutate?.(record);
    this.seq += 1;
    const secs = Math.floor(atMs / 1000);
    const nanos = String((atMs % 1000) * 1e6).padStart(9, '0');
    this.entries.push({ sequenceNumber: this.seq, consensusTimestamp: `${secs}.${nanos}`, record });
  }
}

interface JobOpts {
  provider: string;
  price?: number;
  start?: number;
  latencyMs?: number;
  stopAfter?: 'request' | 'offer' | 'accept' | 'pay';
  deadlineMs?: number;
}

function job(topic: Topic, o: JobOpts): string {
  const jobId = randomUUID();
  const price = o.price ?? 25;
  const start = o.start ?? T0;
  const latency = o.latencyMs ?? 4000;
  const c2p = { jobId, fromAgent: C, toAgent: o.provider };
  const p2c = { jobId, fromAgent: o.provider, toAgent: C };
  const expiresAt = new Date(start + (o.deadlineMs ?? 600_000)).toISOString();

  topic.push(buildRequest(c2p, { capability: 'dataset', spec: {} }), start);
  if (o.stopAfter === 'request') return jobId;
  topic.push(buildOffer(p2c, { price, tokenId: '0.0.1', contractAddress: '0.0.9', expiresAt }), start + latency * 0.1);
  if (o.stopAfter === 'offer') return jobId;
  topic.push(buildAccept(c2p, { acceptedPrice: price }), start + latency * 0.2);
  if (o.stopAfter === 'accept') return jobId;
  topic.push(buildPay(c2p, { amount: price, txId: 'tx', contractJobRef: contractJobRef(jobId) }), start + latency * 0.3);
  if (o.stopAfter === 'pay') return jobId;
  topic.push(buildDeliver(p2c, { resultHash: 'f'.repeat(64), resultLocation: `mem://${jobId}` }), start + latency);
  return jobId;
}

describe('computeReputation', () => {
  it('scores a completed job and measures consensus latency', () => {
    const topic = new Topic();
    job(topic, { provider: P_FAST, latencyMs: 4000 });
    const report = computeReputation({ entries: topic.entries });

    const p = report.providers[0]!;
    expect(p).toMatchObject({ accountId: P_FAST, completed: 1, volume: 25, medianLatencyMs: 4000, anomalies: 0 });
    expect(p.score).toBeGreaterThan(50);
    expect(report.jobs[0]!.outcome).toBe('completed');
    expect(report.consumers[0]).toMatchObject({ accountId: C, accepted: 1, paid: 1, paymentRate: 1 });
  });

  it('ranks a fast, reliable provider above a slow one that lets jobs expire', () => {
    const topic = new Topic();
    for (let i = 0; i < 5; i++) job(topic, { provider: P_FAST, latencyMs: 3000, start: T0 + i * 60_000 });
    for (let i = 0; i < 3; i++) job(topic, { provider: P_SLOW, latencyMs: 90_000, start: T0 + i * 60_000 });
    job(topic, { provider: P_SLOW, stopAfter: 'pay', deadlineMs: 60_000 });

    const report = computeReputation({ entries: topic.entries, now: T0 + 3_600_000 });
    const [first, second] = report.providers;
    expect(first!.accountId).toBe(P_FAST);
    expect(second).toMatchObject({ accountId: P_SLOW, completed: 3, expired: 1 });
    expect(first!.score).toBeGreaterThan(second!.score);
  });

  it('treats paid-but-undelivered as in progress until the deadline, then expired', () => {
    const topic = new Topic();
    job(topic, { provider: P_FAST, stopAfter: 'pay', deadlineMs: 60_000 });
    expect(computeReputation({ entries: topic.entries, now: T0 + 30_000 }).providers[0]!.inProgress).toBe(1);
    expect(computeReputation({ entries: topic.entries, now: T0 + 120_000 }).providers[0]!.expired).toBe(1);
  });

  it('does not penalise the provider when the consumer walks away before paying', () => {
    const topic = new Topic();
    job(topic, { provider: P_FAST, stopAfter: 'offer' });
    const p = computeReputation({ entries: topic.entries }).providers[0]!;
    expect(p).toMatchObject({ abandoned: 1, expired: 0, refunded: 0 });
    expect(p.reliability).toBe(0.5);
  });

  it('counts an escrow refund against the provider', () => {
    const topic = new Topic();
    const ok = job(topic, { provider: P_FAST });
    const bad = job(topic, { provider: P_FAST, stopAfter: 'pay' });
    const events: EscrowEvent[] = [
      { kind: 'JobFunded', contractJobRef: contractJobRef(ok), amount: 25, consensusTimestamp: '1794571200.000000000' },
      { kind: 'JobReleased', contractJobRef: contractJobRef(ok), amount: 25, consensusTimestamp: '1794571201.000000000' },
      { kind: 'JobFunded', contractJobRef: contractJobRef(bad), amount: 25, consensusTimestamp: '1794571202.000000000' },
      { kind: 'JobRefunded', contractJobRef: contractJobRef(bad), amount: 25, consensusTimestamp: '1794571900.000000000' },
    ];
    const report = computeReputation({ entries: topic.entries, escrowEvents: events, now: T0 });
    expect(report.providers[0]).toMatchObject({ completed: 1, refunded: 1 });
    expect(report.jobs.find((j) => j.jobId === ok)!.escrow).toBe('Released');
  });

  it('rejects a forged delivery sent by the consumer and blames the forger', () => {
    const topic = new Topic();
    const jobId = job(topic, { provider: P_FAST, stopAfter: 'pay' });
    topic.push(
      buildDeliver({ jobId, fromAgent: C, toAgent: P_FAST }, { resultHash: 'f'.repeat(64), resultLocation: 'x' }),
      T0 + 5000,
    );
    const report = computeReputation({ entries: topic.entries, now: T0 + 10_000 });
    expect(report.jobs[0]!.outcome).toBe('in-progress');
    expect(report.anomalies).toEqual([expect.objectContaining({ agent: C, reason: expect.stringMatching(/deliver must go provider/) })]);
    expect(report.consumers[0]!.anomalies).toBe(1);
  });

  it('rejects a record whose content hash was tampered with', () => {
    const topic = new Topic();
    const jobId = randomUUID();
    topic.push(buildRequest({ jobId, fromAgent: C, toAgent: P_FAST }, { capability: 'dataset', spec: {} }), T0, (r) => {
      r.contentHash = '0'.repeat(64);
    });
    const report = computeReputation({ entries: topic.entries });
    expect(report.jobs).toHaveLength(0);
    expect(report.anomalies[0]!.reason).toMatch(/content hash/);
  });

  it('rejects an underpayment and a pay pointing at another escrow slot', () => {
    const topic = new Topic();
    const a = job(topic, { provider: P_FAST, stopAfter: 'accept' });
    topic.push(buildPay({ jobId: a, fromAgent: C, toAgent: P_FAST }, { amount: 1, txId: 't', contractJobRef: contractJobRef(a) }), T0 + 1);
    const b = job(topic, { provider: P_FAST, stopAfter: 'accept' });
    topic.push(buildPay({ jobId: b, fromAgent: C, toAgent: P_FAST }, { amount: 25, txId: 't', contractJobRef: contractJobRef(a) }), T0 + 2);

    const reasons = computeReputation({ entries: topic.entries }).anomalies.map((x) => x.reason);
    expect(reasons).toEqual([expect.stringMatching(/paid 1 < price 25/), expect.stringMatching(/different escrow slot/)]);
  });

  it('ignores log_decision records', () => {
    const topic = new Topic();
    const jobId = job(topic, { provider: P_FAST, stopAfter: 'pay' });
    topic.push(buildDeliver({ jobId, fromAgent: C, toAgent: C }, { resultHash: 'a', resultLocation: `decision:${jobId}` }), T0 + 10);
    const report = computeReputation({ entries: topic.entries, now: T0 + 20 });
    expect(report.jobs[0]!.outcome).toBe('in-progress');
    expect(report.anomalies).toHaveLength(0);
  });

  it('is deterministic and independent of delivery order of entries', () => {
    const topic = new Topic();
    for (let i = 0; i < 4; i++) job(topic, { provider: i % 2 ? P_FAST : P_SLOW, start: T0 + i * 1000, latencyMs: 2000 + i * 5000 });
    const a = computeReputation({ entries: topic.entries, now: T0 + 1e6 });
    const b = computeReputation({ entries: [...topic.entries].reverse(), now: T0 + 1e6 });
    expect(b.providers).toEqual(a.providers);
  });
});

describe('ReputationEngine', () => {
  it('replays the in-memory HCS log and flags bad signatures', async () => {
    const hedera = new InMemoryHederaClient();
    const { topicId } = await hedera.createTopic();
    const c = await hedera.createAccount('c');
    const p = await hedera.createAccount('p');
    const jobId = randomUUID();
    const c2p = { jobId, fromAgent: c.accountId, toAgent: p.accountId };
    const p2c = { jobId, fromAgent: p.accountId, toAgent: c.accountId };
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await hedera.submitHcsMessage(topicId, buildRequest(c2p, { capability: 'dataset', spec: {} }));
    await hedera.submitHcsMessage(topicId, buildOffer(p2c, { price: 10, tokenId: '0.0.1', contractAddress: '0.0.9', expiresAt }));
    await hedera.submitHcsMessage(topicId, buildAccept(c2p, { acceptedPrice: 10 }));
    await hedera.submitHcsMessage(topicId, buildPay(c2p, { amount: 10, txId: 't', contractJobRef: contractJobRef(jobId) }));
    // A deliver with a forged signature (claims to be from the provider).
    await hedera.submitHcsMessage(topicId, {
      ...buildDeliver(p2c, { resultHash: 'f'.repeat(64), resultLocation: 'x' }),
      signature: 'forged',
    });

    const engine = new ReputationEngine({
      source: hcsLogSource(hedera.hcsLog, topicId),
      verifySignature: (m) => hedera.verifyMessage(m),
    });
    const report = await engine.compute();
    expect(report.jobs[0]!.outcome).toBe('in-progress');
    expect(report.anomalies).toEqual([expect.objectContaining({ sequenceNumber: 5, reason: expect.stringMatching(/signature/) })]);
    expect(await engine.scoreOf(p.accountId)).toBeTypeOf('number');
  });
});

describe('Mirror Node decoding', () => {
  it('uses real keccak256 (known ERC-20 Transfer topic)', () => {
    expect(bytesToHex(keccak_256(utf8ToBytes('Transfer(address,address,uint256)')))).toBe(
      'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    );
    expect(Object.values(EVENT_TOPICS).sort()).toEqual(['JobFunded', 'JobRefunded', 'JobReleased']);
  });

  it('decodes an AgentEscrow log into an EscrowEvent', () => {
    const fundedTopic = Object.entries(EVENT_TOPICS).find(([, k]) => k === 'JobFunded')![0];
    const ref = contractJobRef(randomUUID());
    const ev = decodeEscrowLog({
      topics: [fundedTopic, ref, '0x' + '0'.repeat(64), '0x' + '0'.repeat(64)],
      data: '0x' + (25).toString(16).padStart(64, '0') + '0'.repeat(64),
      timestamp: '1794571200.000000001',
    });
    expect(ev).toEqual({ kind: 'JobFunded', contractJobRef: ref, amount: 25, consensusTimestamp: '1794571200.000000001' });
    expect(decodeEscrowLog({ topics: ['0x' + '1'.repeat(64)], data: '0x', timestamp: '1' })).toBeNull();
  });

  it('pages through topic messages and decodes base64 records', async () => {
    const record = toHcsRecord(buildRequest({ jobId: randomUUID(), fromAgent: C, toAgent: P_FAST }, { capability: 'd', spec: {} }));
    const b64 = Buffer.from(JSON.stringify(record)).toString('base64');
    const pages: Record<string, unknown> = {
      '/api/v1/topics/0.0.5/messages?limit=100&order=asc': {
        messages: [{ sequence_number: 1, consensus_timestamp: '1.0', message: b64 }],
        links: { next: '/api/v1/topics/0.0.5/messages?page=2' },
      },
      '/api/v1/topics/0.0.5/messages?page=2': {
        messages: [{ sequence_number: 2, consensus_timestamp: '2.0', message: Buffer.from('not json').toString('base64') }],
        links: { next: null },
      },
    };
    const fakeFetch = (async (url: string) =>
      new Response(JSON.stringify(pages[url.replace('https://m', '')]), { status: 200 })) as unknown as typeof fetch;
    const entries = await new MirrorNodeClient('https://m', fakeFetch).topicEntries('0.0.5');
    expect(entries.map((e) => e.sequenceNumber)).toEqual([1, 2]);
    expect(entries[0]!.record).toEqual(record);
    expect(entries[1]!.record).toBeNull();
  });
});
