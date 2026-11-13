/**
 * Reputation scoring — a pure function of on-chain history.
 *
 *   score = 100 × (wR·reliability + wS·speed + wE·experience) × (1 − penalty·anomalies)
 *
 *   reliability = (completed + a) / (completed + failed + a + b)   Beta-prior success rate;
 *                 failed = refunded + expired (paid, never delivered)
 *   speed       = 1 / (1 + medianLatency / target)                  1 = instant, 0.5 at target
 *   experience  = 1 − e^(−completed / confidenceJobs)               grows with track record
 *
 * Deterministic: same topic + events + `now` ⇒ same scores, so anyone can
 * replay and audit them from the Mirror Node.
 */
import { contractJobRef } from '@agent-market/protocol';
import { reconstructJobs, toMillis, type ReconstructOptions } from './jobs.js';
import {
  DEFAULT_CONFIG,
  type ConsumerStats,
  type EscrowEvent,
  type JobTrace,
  type ProviderReputation,
  type ReputationConfig,
  type ReputationReport,
  type TopicEntry,
} from './types.js';

export interface ComputeInput extends ReconstructOptions {
  entries: readonly TopicEntry[];
  /** AgentEscrow events; without them, outcomes come from HCS alone (no refunds seen). */
  escrowEvents?: readonly EscrowEvent[];
  /** "Current time" in ms for deadline checks. Defaults to the newest record's time. */
  now?: number;
  config?: Partial<ReputationConfig>;
}

export function computeReputation(input: ComputeInput): ReputationReport {
  const config: ReputationConfig = { ...DEFAULT_CONFIG, ...input.config };
  const { jobs, anomalies, asOf } = reconstructJobs(input.entries, input);
  const now = input.now ?? asOf ?? 0;

  applyEscrowEvents(jobs, input.escrowEvents ?? []);
  for (const job of jobs.values()) classify(job, now);

  const providerIds = new Set<string>();
  const consumerIds = new Set<string>();
  for (const job of jobs.values()) {
    providerIds.add(job.provider);
    consumerIds.add(job.consumer);
  }
  const anomaliesBy = new Map<string, number>();
  for (const a of anomalies) if (a.agent) anomaliesBy.set(a.agent, (anomaliesBy.get(a.agent) ?? 0) + 1);

  const allJobs = [...jobs.values()];
  const providers = [...providerIds]
    .map((id) => scoreProvider(id, allJobs.filter((j) => j.provider === id), anomaliesBy.get(id) ?? 0, config))
    .sort((a, b) => b.score - a.score || b.completed - a.completed || a.accountId.localeCompare(b.accountId));

  const consumers: ConsumerStats[] = [...consumerIds].sort().map((id) => {
    const mine = allJobs.filter((j) => j.consumer === id);
    const accepted = mine.filter((j) => j.steps.accept).length;
    const paid = mine.filter((j) => j.steps.pay).length;
    return { accountId: id, accepted, paid, paymentRate: accepted ? paid / accepted : 1, anomalies: anomaliesBy.get(id) ?? 0 };
  });

  return { asOf, providers, consumers, jobs: allJobs, anomalies };
}

function applyEscrowEvents(jobs: Map<string, JobTrace>, events: readonly EscrowEvent[]): void {
  const byRef = new Map<string, JobTrace>();
  for (const job of jobs.values()) byRef.set(contractJobRef(job.jobId), job);
  const ordered = [...events].sort((a, b) => toMillis(a.consensusTimestamp) - toMillis(b.consensusTimestamp));
  for (const ev of ordered) {
    const job = byRef.get(ev.contractJobRef.toLowerCase());
    if (!job) continue;
    job.escrow = ev.kind === 'JobFunded' ? 'Held' : ev.kind === 'JobReleased' ? 'Released' : 'Refunded';
  }
}

function classify(job: JobTrace, now: number): void {
  const { request, pay, deliver } = job.steps;
  if (job.escrow === 'Refunded') job.outcome = 'refunded';
  else if (deliver) job.outcome = 'completed';
  else if (pay) job.outcome = job.deadlineAt !== undefined && now > job.deadlineAt ? 'expired' : 'in-progress';
  else job.outcome = 'abandoned';
  if (job.outcome === 'completed' && request && deliver) job.latencyMs = deliver.at - request.at;
}

function scoreProvider(
  accountId: string,
  jobs: JobTrace[],
  anomalies: number,
  c: ReputationConfig,
): ProviderReputation {
  const count = (o: JobTrace['outcome']) => jobs.filter((j) => j.outcome === o).length;
  const completed = count('completed');
  const refunded = count('refunded');
  const expired = count('expired');
  const failed = refunded + expired;

  const latencies = jobs
    .filter((j) => j.outcome === 'completed' && j.latencyMs !== undefined)
    .map((j) => j.latencyMs!)
    .sort((a, b) => a - b);
  const medianLatencyMs = percentile(latencies, 0.5);
  const p95LatencyMs = percentile(latencies, 0.95);

  const reliability = (completed + c.priorSuccess) / (completed + failed + c.priorSuccess + c.priorFailure);
  const speed = medianLatencyMs === undefined ? 0.5 : 1 / (1 + medianLatencyMs / c.targetLatencyMs);
  const experience = 1 - Math.exp(-completed / c.confidenceJobs);

  const w = c.weights;
  const raw = (w.reliability * reliability + w.speed * speed + w.experience * experience) / (w.reliability + w.speed + w.experience);
  const penalty = Math.max(0, 1 - c.anomalyPenalty * anomalies);

  const volume = jobs.filter((j) => j.outcome === 'completed').reduce((sum, j) => sum + (j.price ?? 0), 0);
  const lastActiveAt = jobs
    .flatMap((j) => [j.steps.offer?.at, j.steps.deliver?.at])
    .filter((t): t is number => t !== undefined)
    .reduce<number | undefined>((max, t) => (max === undefined || t > max ? t : max), undefined);

  return {
    accountId,
    score: Math.round(100 * raw * penalty),
    completed,
    refunded,
    expired,
    inProgress: count('in-progress'),
    abandoned: count('abandoned'),
    anomalies,
    volume,
    medianLatencyMs,
    p95LatencyMs,
    reliability: round3(reliability),
    speed: round3(speed),
    experience: round3(experience),
    lastActiveAt,
  };
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
