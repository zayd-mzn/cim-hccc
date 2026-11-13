/**
 * Mock audit data — several full jobs in the exact HcsRecord shape the Mirror
 * Node serves (reports/hcs-format-for-dashboard.md). Used when VITE_USE_MOCK=1
 * or the live topic is empty/unreachable, so every view (Marketplace, Monitor,
 * Reputation, Audit log) looks populated.
 *
 * Records are built programmatically with the real protocol helpers, so:
 *   - contentHash is valid (hash badges show OK),
 *   - pay.contractJobRef = contractJobRef(jobId) (passes reputation validation),
 *   - handshake order + sender roles are correct (jobs actually score).
 */
import { contentHash, contractJobRef, type AgentMessage } from "@agent-market/protocol";
import type { AuditEntry } from "./mirror";

const CONSUMER = "0.0.11431747";
const PROVIDER_A = "0.0.11431749"; // "DataVault" — two completed jobs
const PROVIDER_B = "0.0.11431751"; // "SignalFeed" — one completed, one in-progress
const TOKEN_ID = "0.0.11431744";
const ESCROW_ADDR = "0.0.11431806";

const BASE_MS = Date.parse("2026-11-12T22:00:00.000Z");

let seq = 0;

function record(
  consensusMs: number,
  msg: Omit<AgentMessage, "signature" | "timestamp"> & { timestamp?: string },
): AuditEntry {
  const message = {
    ...msg,
    timestamp: msg.timestamp ?? new Date(consensusMs).toISOString(),
    signature: "mock",
  } as AgentMessage;
  const rec = { message, contentHash: contentHash(message) };
  return { sequenceNumber: ++seq, consensusMs, record: rec, hashOk: true };
}

interface JobSpec {
  jobId: string;
  provider: string;
  capability: string;
  price: number;
  startMs: number;
  /** ms from request to each subsequent step; omit `deliverGap` for in-progress. */
  gaps: { offer: number; accept: number; pay: number; deliver?: number };
  txId: string;
  resultHash: string;
}

function buildJob(spec: JobSpec): AuditEntry[] {
  const { jobId, provider, capability, price, startMs, gaps, txId, resultHash } = spec;
  const ref = contractJobRef(jobId);
  const expiresAt = new Date(startMs + 600_000).toISOString();
  const out: AuditEntry[] = [];

  out.push(
    record(startMs, {
      type: "request",
      jobId,
      fromAgent: CONSUMER,
      toAgent: provider,
      payload: { capability, spec: { rows: 1000 } },
    }),
  );
  out.push(
    record(startMs + gaps.offer, {
      type: "offer",
      jobId,
      fromAgent: provider,
      toAgent: CONSUMER,
      payload: { price, tokenId: TOKEN_ID, contractAddress: ESCROW_ADDR, expiresAt },
    }),
  );
  out.push(
    record(startMs + gaps.accept, {
      type: "accept",
      jobId,
      fromAgent: CONSUMER,
      toAgent: provider,
      payload: { acceptedPrice: price },
    }),
  );
  out.push(
    record(startMs + gaps.pay, {
      type: "pay",
      jobId,
      fromAgent: CONSUMER,
      toAgent: provider,
      payload: { amount: price, txId, contractJobRef: ref },
    }),
  );
  if (gaps.deliver !== undefined) {
    out.push(
      record(startMs + gaps.deliver, {
        type: "deliver",
        jobId,
        fromAgent: provider,
        toAgent: CONSUMER,
        payload: { resultHash, resultLocation: `mem://datasets/${jobId}` },
      }),
    );
  }
  return out;
}

const JOBS: JobSpec[] = [
  {
    jobId: "00000000-0000-4000-8000-000000000001",
    provider: PROVIDER_A,
    capability: "dataset",
    price: 25,
    startMs: BASE_MS,
    gaps: { offer: 1_200, accept: 2_100, pay: 3_800, deliver: 9_400 }, // ~9.4s
    txId: "0.0.11431747@1788994742.041874961",
    resultHash: "a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2",
  },
  {
    jobId: "00000000-0000-4000-8000-000000000002",
    provider: PROVIDER_A,
    capability: "enrichment",
    price: 40,
    startMs: BASE_MS + 120_000,
    gaps: { offer: 900, accept: 1_800, pay: 3_100, deliver: 7_600 }, // ~7.6s
    txId: "0.0.11431747@1788994862.113002004",
    resultHash: "b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3",
  },
  {
    jobId: "00000000-0000-4000-8000-000000000003",
    provider: PROVIDER_B,
    capability: "translation",
    price: 15,
    startMs: BASE_MS + 300_000,
    gaps: { offer: 1_500, accept: 2_800, pay: 4_400, deliver: 18_200 }, // ~18s (slower)
    txId: "0.0.11431747@1788995042.077415530",
    resultHash: "c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4",
  },
  {
    jobId: "00000000-0000-4000-8000-000000000004",
    provider: PROVIDER_B,
    capability: "dataset",
    price: 30,
    startMs: BASE_MS + 480_000,
    gaps: { offer: 1_100, accept: 2_000, pay: 3_500 }, // in-progress: paid, not delivered
    txId: "0.0.11431747@1788995222.901233117",
    resultHash: "",
  },
];

export const MOCK_AUDIT: AuditEntry[] = JOBS.flatMap(buildJob).sort(
  (a, b) => a.sequenceNumber - b.sequenceNumber,
);

export const MOCK_ACCOUNTS = { consumer: CONSUMER, providerA: PROVIDER_A, providerB: PROVIDER_B };
