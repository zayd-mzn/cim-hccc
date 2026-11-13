/**
 * ReputationEngine — pulls history from a source and recomputes scores.
 *
 * Stateless by design: every `compute()` replays the full history, so the
 * result never depends on what this process happened to observe.
 */
import { safeParseAgentMessage, type AgentMessage } from '@agent-market/protocol';
import type { InMemoryHcsLog } from '@agent-market/hedera-core';
import { MirrorNodeClient } from './mirror.js';
import { computeReputation } from './score.js';
import type { EscrowEvent, ReputationConfig, ReputationReport, TopicEntry } from './types.js';

export interface ReputationSource {
  topicEntries(): Promise<TopicEntry[]>;
  escrowEvents?(): Promise<EscrowEvent[]>;
}

/** Testnet/mainnet: HCS topic + escrow logs via the Mirror Node. */
export function mirrorSource(opts: { topicId: string; escrowContractId?: string; mirror?: MirrorNodeClient }): ReputationSource {
  const mirror = opts.mirror ?? new MirrorNodeClient();
  return {
    topicEntries: () => mirror.topicEntries(opts.topicId),
    escrowEvents: opts.escrowContractId ? () => mirror.escrowEvents(opts.escrowContractId!) : undefined,
  };
}

/** Local runs: the in-memory HCS log (same shape the Mirror Node serves). */
export function hcsLogSource(log: InMemoryHcsLog, topicId?: string, escrowEvents?: () => EscrowEvent[]): ReputationSource {
  return {
    topicEntries: async () =>
      log.history(topicId).map((e) => ({
        sequenceNumber: e.sequenceNumber,
        consensusTimestamp: e.consensusTimestamp,
        record: e.record,
      })),
    escrowEvents: escrowEvents ? async () => escrowEvents() : undefined,
  };
}

export interface ReputationEngineOptions {
  source: ReputationSource;
  /** e.g. HederaClient.verifyMessage. When set, records with bad signatures become anomalies. */
  verifySignature?: (message: AgentMessage) => Promise<boolean>;
  config?: Partial<ReputationConfig>;
  /** Clock for deadline checks (ms). Defaults to Date.now. */
  now?: () => number;
}

export class ReputationEngine {
  constructor(private readonly opts: ReputationEngineOptions) {}

  async compute(): Promise<ReputationReport> {
    const [entries, escrowEvents] = await Promise.all([
      this.opts.source.topicEntries(),
      this.opts.source.escrowEvents?.() ?? Promise.resolve(undefined),
    ]);
    const invalidSignatures = this.opts.verifySignature ? await this.badSignatures(entries) : undefined;
    return computeReputation({
      entries,
      escrowEvents,
      invalidSignatures,
      now: (this.opts.now ?? Date.now)(),
      config: this.opts.config,
    });
  }

  /** Score for one provider account (undefined if it has no jobs). */
  async scoreOf(accountId: string): Promise<number | undefined> {
    return (await this.compute()).providers.find((p) => p.accountId === accountId)?.score;
  }

  private async badSignatures(entries: TopicEntry[]): Promise<Set<number>> {
    const bad = new Set<number>();
    await Promise.all(
      entries.map(async (e) => {
        const msg = (e.record as { message?: unknown } | null)?.message;
        const parsed = safeParseAgentMessage(msg);
        if (parsed.success && !(await this.opts.verifySignature!(parsed.message))) bad.add(e.sequenceNumber);
      }),
    );
    return bad;
  }
}
