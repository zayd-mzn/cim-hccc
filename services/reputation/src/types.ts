/**
 * Inputs and outputs of the reputation engine.
 *
 * Inputs are ONLY what is on Hedera: HCS topic entries (as the Mirror Node
 * serves them) and AgentEscrow contract events. Never agent memory.
 */
import type { AgentMessage } from '@agent-market/protocol';

/** One HCS topic message: consensus metadata + the decoded (unvalidated) record. */
export interface TopicEntry {
  sequenceNumber: number;
  /** Mirror Node "seconds.nanos" or ISO 8601 (in-memory log). */
  consensusTimestamp: string;
  /** Decoded JSON; validated by the engine (may be malformed). */
  record: unknown;
}

export type EscrowEventKind = 'JobFunded' | 'JobReleased' | 'JobRefunded';

/** An AgentEscrow event, keyed by the escrow slot ("0x" + sha256(jobId)). */
export interface EscrowEvent {
  kind: EscrowEventKind;
  contractJobRef: string;
  amount: number;
  consensusTimestamp: string;
}

/** Why a record was not accepted into a job, attributed to its sender when known. */
export interface Anomaly {
  sequenceNumber: number;
  /** Sender account, if the record parsed far enough to know it. */
  agent?: string;
  jobId?: string;
  reason: string;
}

export interface JobStep {
  sequenceNumber: number;
  /** Consensus time, ms since epoch. */
  at: number;
  message: AgentMessage;
}

export type JobOutcome =
  /** Delivered (and not refunded). Counts for the provider. */
  | 'completed'
  /** Escrow refunded to the consumer. Counts against the provider. */
  | 'refunded'
  /** Paid, never delivered, deadline passed. Counts against the provider. */
  | 'expired'
  /** Paid, not delivered yet, deadline not reached. Not scored. */
  | 'in-progress'
  /** Stopped before payment (no offer, or consumer walked away). Not scored. */
  | 'abandoned';

export interface JobTrace {
  jobId: string;
  consumer: string;
  provider: string;
  capability: string;
  price?: number;
  steps: Partial<Record<AgentMessage['type'], JobStep>>;
  outcome: JobOutcome;
  /** request → deliver, consensus time. */
  latencyMs?: number;
  /** offer.expiresAt in ms (the escrow deadline). */
  deadlineAt?: number;
  escrow?: 'Held' | 'Released' | 'Refunded';
}

export interface ProviderReputation {
  accountId: string;
  /** 0–100. */
  score: number;
  completed: number;
  refunded: number;
  expired: number;
  inProgress: number;
  abandoned: number;
  anomalies: number;
  /** Credits earned on completed jobs. */
  volume: number;
  medianLatencyMs?: number;
  p95LatencyMs?: number;
  /** Components, each 0–1. */
  reliability: number;
  speed: number;
  experience: number;
  /** Last consensus time this provider sent a handshake step (ms). */
  lastActiveAt?: number;
}

export interface ConsumerStats {
  accountId: string;
  accepted: number;
  paid: number;
  /** paid / accepted (1 when nothing accepted). */
  paymentRate: number;
  anomalies: number;
}

export interface ReputationReport {
  /** Consensus time of the newest record considered (ms), for "as of". */
  asOf?: number;
  providers: ProviderReputation[];
  consumers: ConsumerStats[];
  jobs: JobTrace[];
  anomalies: Anomaly[];
}

export interface ReputationConfig {
  /** Latency that scores 0.5 on speed. */
  targetLatencyMs: number;
  /** Beta prior for reliability (pseudo-successes / pseudo-failures). */
  priorSuccess: number;
  priorFailure: number;
  /** Completed jobs at which experience reaches ~63%. */
  confidenceJobs: number;
  weights: { reliability: number; speed: number; experience: number };
  /** Score multiplier lost per anomaly attributed to the provider. */
  anomalyPenalty: number;
}

export const DEFAULT_CONFIG: ReputationConfig = {
  targetLatencyMs: 30_000,
  priorSuccess: 1,
  priorFailure: 1,
  confidenceJobs: 5,
  weights: { reliability: 0.6, speed: 0.25, experience: 0.15 },
  anomalyPenalty: 0.15,
};
