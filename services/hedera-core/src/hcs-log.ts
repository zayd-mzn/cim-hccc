/**
 * In-memory HCS log — a local stand-in for an HCS topic + Mirror Node.
 *
 * Append-only, consensus-ordered (monotonic sequence number + timestamp).
 * Exposes a subscribe() so the dashboard/reputation engine can read the SAME
 * way they will read Mirror Node — never from agent memory (the golden rule).
 */
import type { HcsRecord } from '@agent-market/protocol';

export interface HcsLogEntry {
  topicId: string;
  sequenceNumber: number;
  /** Authoritative consensus time (ISO 8601). */
  consensusTimestamp: string;
  record: HcsRecord;
}

export type HcsSubscriber = (entry: HcsLogEntry) => void;

let topicCounter = 0;

export class InMemoryHcsLog {
  private readonly entries: HcsLogEntry[] = [];
  private readonly subscribers = new Set<HcsSubscriber>();
  private readonly topics = new Map<string, string>(); // topicId -> memo
  private seq = 0;

  ensureTopic(memo: string): string {
    topicCounter += 1;
    const topicId = `0.0.${9000 + topicCounter}`;
    this.topics.set(topicId, memo);
    return topicId;
  }

  append(topicId: string, record: HcsRecord): HcsLogEntry {
    this.seq += 1;
    const entry: HcsLogEntry = {
      topicId,
      sequenceNumber: this.seq,
      consensusTimestamp: new Date().toISOString(),
      record,
    };
    this.entries.push(entry);
    for (const sub of this.subscribers) sub(entry);
    return entry;
  }

  /** All entries so far, in consensus order (optionally filtered by topic). */
  history(topicId?: string): HcsLogEntry[] {
    return topicId ? this.entries.filter((e) => e.topicId === topicId) : [...this.entries];
  }

  /** All records for a single job, in consensus order. */
  jobHistory(jobId: string): HcsLogEntry[] {
    return this.entries.filter((e) => e.record.message.jobId === jobId);
  }

  /**
   * Subscribe to new entries as they land (mirror-node-style stream).
   * Returns an unsubscribe function.
   */
  subscribe(subscriber: HcsSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}
