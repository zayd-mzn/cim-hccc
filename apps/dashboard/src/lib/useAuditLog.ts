/**
 * useAuditLog — the dashboard's single source of truth.
 *
 * Polls the public Mirror Node for new HCS records, reconstructs the per-job
 * handshake timeline, folds in AgentEscrow events, and exposes a flat ordered
 * audit stream. Falls back to mock data (identical shape) when the topic is
 * unreachable or VITE_USE_MOCK is set — so the UI is never empty.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyEscrowEvents,
  fetchAuditEntries,
  fetchEscrowEvents,
  reconstructJobs,
  type AuditEntry,
  type JobView,
} from "./mirror";
import { MOCK_AUDIT } from "./mock";

const USE_MOCK = (import.meta.env.VITE_USE_MOCK as string | undefined) === "1";
const POLL_MS = 3000;

export type Source = "live" | "mock" | "loading";

export interface AuditLogState {
  entries: AuditEntry[];
  jobs: JobView[];
  source: Source;
  error: string | null;
  lastUpdatedMs: number | null;
  refresh: () => void;
}

export function useAuditLog(): AuditLogState {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [source, setSource] = useState<Source>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedMs, setLastUpdatedMs] = useState<number | null>(null);
  const lastSeqRef = useRef<number>(0);

  const applyEntries = useCallback((all: AuditEntry[], src: Source) => {
    const sorted = [...all].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    setEntries(sorted);
    setSource(src);
    setLastUpdatedMs(Date.now());
    lastSeqRef.current = sorted.at(-1)?.sequenceNumber ?? 0;
  }, []);

  const loadMock = useCallback(() => {
    applyEntries(MOCK_AUDIT, "mock");
    setError(null);
  }, [applyEntries]);

  const poll = useCallback(async () => {
    if (USE_MOCK) {
      loadMock();
      return;
    }
    try {
      const fresh = await fetchAuditEntries(lastSeqRef.current || undefined);
      if (fresh.length > 0) {
        setEntries((prev) => {
          const merged = [...prev, ...fresh];
          const byKey = new Map(merged.map((e) => [e.sequenceNumber, e]));
          const sorted = [...byKey.values()].sort(
            (a, b) => a.sequenceNumber - b.sequenceNumber,
          );
          lastSeqRef.current = sorted.at(-1)?.sequenceNumber ?? lastSeqRef.current;
          return sorted;
        });
        setSource("live");
        setLastUpdatedMs(Date.now());
        setError(null);
      } else if (lastSeqRef.current === 0) {
        // Nothing on the topic yet (or empty) — show mock so the demo isn't blank.
        loadMock();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (lastSeqRef.current === 0) loadMock();
    }
  }, [loadMock]);

  // Initial load.
  useEffect(() => {
    if (USE_MOCK) {
      loadMock();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const initial = await fetchAuditEntries();
        if (cancelled) return;
        if (initial.length > 0) applyEntries(initial, "live");
        else loadMock();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        loadMock();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyEntries, loadMock]);

  // Reconstruct jobs + fold in escrow events whenever entries change.
  useEffect(() => {
    let cancelled = false;
    const base = reconstructJobs(entries);
    setJobs(base);
    if (source === "live" && entries.length > 0) {
      fetchEscrowEvents()
        .then((events) => {
          if (!cancelled) setJobs(applyEscrowEvents(reconstructJobs(entries), events));
        })
        .catch(() => void 0);
    }
    return () => {
      cancelled = true;
    };
  }, [entries, source]);

  // Live polling.
  useEffect(() => {
    if (USE_MOCK) return;
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return { entries, jobs, source, error, lastUpdatedMs, refresh: poll };
}
