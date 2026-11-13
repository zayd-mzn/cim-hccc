/**
 * Mock audit data — a full 5-step job in the exact HcsRecord shape the Mirror
 * Node serves (reports/hcs-format-for-dashboard.md). Used when VITE_USE_MOCK is
 * set or the live topic can't be reached, so the UI always has something to
 * render. The shape is identical to live data, so components never branch on it.
 */
import { contentHash, type AgentMessage } from "@agent-market/protocol";
import type { AuditEntry } from "./mirror";

const CONSUMER = "0.0.11431747";
const PROVIDER = "0.0.11431749";
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const TOKEN_ID = "0.0.11431744";
const ESCROW_ADDR = "0.0.11431806";
const CONTRACT_JOB_REF =
  "0x5ff6cbe1aa0e6f2b2c6d9b8e4a1f0c3d2e1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f";

const BASE_MS = Date.parse("2026-11-12T22:22:44.000Z");

function sign(message: Omit<AgentMessage, "signature">): AgentMessage {
  // Mock signature — the dashboard verifies contentHash, not signatures, by default.
  return { ...message, signature: "mock" } as AgentMessage;
}

function entry(
  seq: number,
  offsetMs: number,
  partial: Omit<AgentMessage, "signature" | "jobId" | "timestamp">,
): AuditEntry {
  const message = sign({
    ...partial,
    jobId: JOB_ID,
    timestamp: new Date(BASE_MS + offsetMs).toISOString(),
  } as Omit<AgentMessage, "signature">);
  const record = { message, contentHash: contentHash(message) };
  return {
    sequenceNumber: seq,
    consensusMs: BASE_MS + offsetMs,
    record,
    hashOk: true,
  };
}

export const MOCK_AUDIT: AuditEntry[] = [
  entry(1, 0, {
    type: "request",
    fromAgent: CONSUMER,
    toAgent: PROVIDER,
    payload: { capability: "dataset", spec: { rows: 1000 } },
  }),
  entry(2, 1_200, {
    type: "offer",
    fromAgent: PROVIDER,
    toAgent: CONSUMER,
    payload: {
      price: 25,
      tokenId: TOKEN_ID,
      contractAddress: ESCROW_ADDR,
      expiresAt: new Date(BASE_MS + 600_000).toISOString(),
    },
  }),
  entry(3, 2_100, {
    type: "accept",
    fromAgent: CONSUMER,
    toAgent: PROVIDER,
    payload: { acceptedPrice: 25 },
  }),
  entry(4, 3_800, {
    type: "pay",
    fromAgent: CONSUMER,
    toAgent: PROVIDER,
    payload: {
      amount: 25,
      txId: "0.0.11431747@1788994742.041874961",
      contractJobRef: CONTRACT_JOB_REF,
    },
  }),
  entry(5, 6_600, {
    type: "deliver",
    fromAgent: PROVIDER,
    toAgent: CONSUMER,
    payload: {
      resultHash: "a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2",
      resultLocation: "mem://datasets/" + JOB_ID,
    },
  }),
];

export const MOCK_ACCOUNTS = { consumer: CONSUMER, provider: PROVIDER };
