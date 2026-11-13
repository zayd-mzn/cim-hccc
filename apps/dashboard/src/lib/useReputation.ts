/**
 * useReputation — provider trust scores, computed in-browser by the SAME engine
 * the CLI uses (@agent-market/reputation). Fully replayable: the inputs are the
 * HCS audit entries + AgentEscrow events, nothing else.
 */
import { useMemo } from "react";
import {
  computeReputation,
  type EscrowEvent as RepEscrowEvent,
  type ReputationReport,
  type TopicEntry,
} from "@agent-market/reputation";
import type { AuditEntry } from "./mirror";

/** AuditEntry (dashboard shape) → TopicEntry (reputation-engine input). */
function toTopicEntries(entries: AuditEntry[]): TopicEntry[] {
  return entries.map((e) => ({
    sequenceNumber: e.sequenceNumber,
    // Engine accepts ISO 8601 or "seconds.nanos"; ISO from consensus ms is fine.
    consensusTimestamp: new Date(e.consensusMs).toISOString(),
    record: e.record,
  }));
}

export function useReputation(
  entries: AuditEntry[],
  escrowEvents: RepEscrowEvent[] = [],
): ReputationReport {
  return useMemo(
    () =>
      computeReputation({
        entries: toTopicEntries(entries),
        escrowEvents,
      }),
    [entries, escrowEvents],
  );
}
