/**
 * Rebuild jobs from the raw HCS topic.
 *
 * Every record must pass: schema, content hash, (optional) signature, the
 * fixed handshake order, the right sender/recipient for its step, and
 * consistency with earlier steps (accepted price = offered price, paid amount
 * ≥ accepted price, contractJobRef = the job's escrow slot). A record that
 * fails is NOT applied to the job and is recorded as an anomaly against its
 * sender — so a misbehaving agent can't fake a completed job, and it pays for
 * trying.
 */
import {
  HANDSHAKE_ORDER,
  HcsRecordSchema,
  SENDER_ROLE,
  contractJobRef,
  hasValidContentHash,
  isDecisionRecord,
  safeParseAgentMessage,
  type AgentMessage,
} from '@agent-market/protocol';
import type { Anomaly, JobTrace, TopicEntry } from './types.js';

/** Mirror Node "seconds.nanos" or ISO 8601 → ms since epoch. */
export function toMillis(ts: string): number {
  if (/^\d+(\.\d+)?$/.test(ts)) {
    const [secs, nanos = '0'] = ts.split('.');
    return Number(secs) * 1000 + Math.floor(Number(nanos.padEnd(9, '0').slice(0, 9)) / 1e6);
  }
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) throw new Error(`bad timestamp: ${ts}`);
  return ms;
}

export interface ReconstructOptions {
  /** Sequence numbers whose signature failed verification. */
  invalidSignatures?: ReadonlySet<number>;
}

export interface Reconstruction {
  jobs: Map<string, JobTrace>;
  anomalies: Anomaly[];
  asOf?: number;
}

export function reconstructJobs(entries: readonly TopicEntry[], opts: ReconstructOptions = {}): Reconstruction {
  const jobs = new Map<string, JobTrace>();
  const anomalies: Anomaly[] = [];
  let asOf: number | undefined;

  const ordered = [...entries].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  for (const entry of ordered) {
    const at = toMillis(entry.consensusTimestamp);
    asOf = Math.max(asOf ?? at, at);
    const seq = entry.sequenceNumber;

    const rec = HcsRecordSchema.safeParse(entry.record);
    if (!rec.success) {
      anomalies.push({ sequenceNumber: seq, reason: 'not an HcsRecord' });
      continue;
    }
    const parsed = safeParseAgentMessage(rec.data.message);
    if (!parsed.success) {
      const from = (rec.data.message as { fromAgent?: string }).fromAgent;
      anomalies.push({ sequenceNumber: seq, agent: from, jobId: rec.data.message.jobId, reason: 'invalid payload for message type' });
      continue;
    }
    const message = parsed.message;
    const flag = (reason: string) =>
      anomalies.push({ sequenceNumber: seq, agent: message.fromAgent, jobId: message.jobId, reason });

    if (!hasValidContentHash({ message, contentHash: rec.data.contentHash })) {
      flag('content hash does not match message');
      continue;
    }
    if (opts.invalidSignatures?.has(seq)) {
      flag('signature does not verify against sender key');
      continue;
    }
    if (isDecisionRecord(message)) continue;

    const job = jobs.get(message.jobId);
    if (!job) {
      if (message.type !== 'request') {
        flag(`${message.type} without a prior request`);
        continue;
      }
      const m = message as AgentMessage<'request'>;
      jobs.set(m.jobId, {
        jobId: m.jobId,
        consumer: m.fromAgent,
        provider: m.toAgent,
        capability: m.payload.capability,
        steps: { request: { sequenceNumber: seq, at, message: m } },
        outcome: 'abandoned',
      });
      continue;
    }

    const expected = HANDSHAKE_ORDER[Object.keys(job.steps).length];
    if (message.type !== expected) {
      flag(expected ? `out of order: got ${message.type}, expected ${expected}` : `extra ${message.type} after deliver`);
      continue;
    }
    const role = SENDER_ROLE[message.type];
    const [from, to] = role === 'consumer' ? [job.consumer, job.provider] : [job.provider, job.consumer];
    if (message.fromAgent !== from || message.toAgent !== to) {
      flag(`${message.type} must go ${role} → counterpart`);
      continue;
    }
    const inconsistency = checkConsistency(job, message);
    if (inconsistency) {
      flag(inconsistency);
      continue;
    }

    job.steps[message.type] = { sequenceNumber: seq, at, message };
    if (message.type === 'offer') {
      const offer = (message as AgentMessage<'offer'>).payload;
      job.price = offer.price;
      job.deadlineAt = Date.parse(offer.expiresAt);
    }
  }

  return { jobs, anomalies, asOf };
}

function checkConsistency(job: JobTrace, message: AgentMessage): string | null {
  switch (message.type) {
    case 'accept': {
      const accepted = (message as AgentMessage<'accept'>).payload.acceptedPrice;
      return accepted === job.price ? null : `accepted ${accepted} but offer was ${job.price}`;
    }
    case 'pay': {
      const pay = (message as AgentMessage<'pay'>).payload;
      if (pay.contractJobRef !== contractJobRef(job.jobId)) return 'pay references a different escrow slot';
      return pay.amount >= (job.price ?? Infinity) ? null : `paid ${pay.amount} < price ${job.price}`;
    }
    default:
      return null;
  }
}
