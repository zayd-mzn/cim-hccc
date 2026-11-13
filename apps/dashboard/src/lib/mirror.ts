/**
 * Read-only Hedera Mirror Node client for the Agent Market dashboard.
 *
 * The dashboard reads EVERYTHING from the public Mirror Node — never from an
 * agent's private database or a backend API. This is the whole point of the
 * trust model (TRUST-MODEL.md): the dashboard is a *viewer*, not an authority.
 *
 * Three sources, all public + read-only:
 *   1. HCS topic messages  → the signed AgentMessage audit log (the timeline)
 *   2. AgentEscrow events   → escrow Held → Released/Refunded state
 *   3. HTS token balances   → the "credits" settlement view
 *
 * Shapes + endpoints are specified in reports/hcs-format-for-dashboard.md.
 */
import {
  hasValidContentHash,
  isDecisionRecord,
  safeParseAgentMessage,
  type AgentMessage,
  type HcsRecord,
} from "@agent-market/protocol";

// ── config ──────────────────────────────────────────────────────────────────

const MIRROR_BASE =
  (import.meta.env.VITE_MIRROR_BASE as string | undefined) ??
  "https://testnet.mirrornode.hedera.com";

/** Live testnet ids (reports/hcs-format-for-dashboard.md). Overridable via env. */
export const IDS = {
  topicId: (import.meta.env.VITE_TOPIC_ID as string | undefined) ?? "0.0.11431745",
  tokenId: (import.meta.env.VITE_TOKEN_ID as string | undefined) ?? "0.0.11431744",
  escrowContractId:
    (import.meta.env.VITE_ESCROW_ID as string | undefined) ?? "0.0.11431806",
} as const;

async function mirrorGet<T>(path: string): Promise<T> {
  const res = await fetch(`${MIRROR_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Mirror node ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

// ── 1. HCS topic messages ─────────────────────────────────────────────────────

interface RawTopicMessage {
  consensus_timestamp: string; // "seconds.nanos"
  sequence_number: number;
  message: string; // base64 of the HcsRecord JSON
}

interface RawTopicPage {
  messages: RawTopicMessage[];
  links?: { next: string | null };
}

/** A validated HCS record plus its consensus metadata (the authoritative order). */
export interface AuditEntry {
  sequenceNumber: number;
  /** Consensus time in ms since epoch (authoritative — use this for ordering). */
  consensusMs: number;
  record: HcsRecord;
  /** contentHash recomputed and matched — the "tamper-proof" badge. */
  hashOk: boolean;
}

/** "seconds.nanos" → ms since epoch. */
export function consensusToMs(ts: string): number {
  const [secs, nanos = "0"] = ts.split(".");
  return Number(secs) * 1000 + Math.floor(Number(nanos.padEnd(9, "0")) / 1_000_000);
}

function decodeBase64Json(b64: string): unknown {
  // atob → binary string → UTF-8 safe decode.
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

/** Decode one raw topic message into a validated AuditEntry, or null if malformed. */
function toAuditEntry(raw: RawTopicMessage): AuditEntry | null {
  let decoded: unknown;
  try {
    decoded = decodeBase64Json(raw.message);
  } catch {
    return null;
  }
  const obj = decoded as { message?: unknown; contentHash?: unknown };
  if (!obj || typeof obj !== "object" || typeof obj.contentHash !== "string") {
    return null;
  }
  const parsed = safeParseAgentMessage(obj.message);
  if (!parsed.success) return null;

  const record: HcsRecord = { message: parsed.message, contentHash: obj.contentHash };
  return {
    sequenceNumber: raw.sequence_number,
    consensusMs: consensusToMs(raw.consensus_timestamp),
    record,
    hashOk: hasValidContentHash(record),
  };
}

/**
 * Fetch topic messages in ascending consensus order. Pages through `links.next`.
 * Pass `afterSequence` to fetch only newer messages (for polling).
 */
export async function fetchAuditEntries(
  afterSequence?: number,
  limit = 100,
): Promise<AuditEntry[]> {
  const seqFilter = afterSequence ? `&sequencenumber=gt:${afterSequence}` : "";
  let path: string | null =
    `/api/v1/topics/${IDS.topicId}/messages?limit=${limit}&order=asc${seqFilter}`;

  const out: AuditEntry[] = [];
  while (path) {
    const page: RawTopicPage = await mirrorGet<RawTopicPage>(path);
    for (const raw of page.messages ?? []) {
      const entry = toAuditEntry(raw);
      if (entry) out.push(entry);
    }
    path = page.links?.next ?? null;
  }
  return out;
}

// ── job reconstruction (the 5-step handshake) ────────────────────────────────

export type StepType = AgentMessage["type"]; // request | offer | accept | pay | deliver

export interface JobStep {
  type: StepType;
  sequenceNumber: number;
  consensusMs: number;
  message: AgentMessage;
  hashOk: boolean;
}

export type EscrowState = "none" | "held" | "released" | "refunded";

export interface JobView {
  jobId: string;
  consumer: string;
  provider: string;
  capability?: string;
  price?: number;
  tokenId?: string;
  /** Ordered steps present so far, keyed by type. */
  steps: Partial<Record<StepType, JobStep>>;
  firstMs: number;
  lastMs: number;
  /** request → deliver latency in ms, once delivered. */
  latencyMs?: number;
  escrow: EscrowState;
  complete: boolean;
}

const STEP_ORDER: StepType[] = ["request", "offer", "accept", "pay", "deliver"];

/**
 * Group audit entries into per-job views, ordered by consensus time. Decision
 * records (log_decision) are skipped so they don't look like deliveries.
 */
export function reconstructJobs(entries: AuditEntry[]): JobView[] {
  const byJob = new Map<string, JobView>();

  for (const entry of entries) {
    const msg = entry.record.message;
    if (isDecisionRecord(msg)) continue;

    let job = byJob.get(msg.jobId);
    if (!job) {
      job = {
        jobId: msg.jobId,
        consumer: "",
        provider: "",
        steps: {},
        firstMs: entry.consensusMs,
        lastMs: entry.consensusMs,
        escrow: "none",
        complete: false,
      };
      byJob.set(msg.jobId, job);
    }

    job.steps[msg.type] = {
      type: msg.type,
      sequenceNumber: entry.sequenceNumber,
      consensusMs: entry.consensusMs,
      message: msg,
      hashOk: entry.hashOk,
    };
    job.firstMs = Math.min(job.firstMs, entry.consensusMs);
    job.lastMs = Math.max(job.lastMs, entry.consensusMs);

    // Derive parties + economics from the relevant steps.
    if (msg.type === "request") {
      job.consumer = msg.fromAgent;
      job.provider = msg.toAgent;
      job.capability = (msg.payload as { capability?: string }).capability;
    }
    if (msg.type === "offer") {
      const p = msg.payload as { price?: number; tokenId?: string };
      job.price = p.price;
      job.tokenId = p.tokenId;
    }
  }

  // Finalize derived fields.
  for (const job of byJob.values()) {
    const request = job.steps.request;
    const deliver = job.steps.deliver;
    if (request && deliver) {
      job.latencyMs = deliver.consensusMs - request.consensusMs;
    }
    // Escrow state inferred from handshake if contract events aren't merged in.
    if (job.steps.pay) job.escrow = "held";
    if (job.steps.deliver) job.escrow = "released";
    job.complete = STEP_ORDER.every((t) => job.steps[t]);
  }

  return [...byJob.values()].sort((a, b) => b.lastMs - a.lastMs);
}

// ── 2. AgentEscrow contract events ────────────────────────────────────────────

export type EscrowEventKind = "JobFunded" | "JobReleased" | "JobRefunded";

export interface EscrowEvent {
  kind: EscrowEventKind;
  /** "0x" + sha256(jobId) — matches PayPayload.contractJobRef. */
  contractJobRef: string;
  consensusMs: number;
}

// keccak256 topic0 signatures for the AgentEscrow events (see AgentEscrow.sol).
// Precomputed from the canonical event signatures.
const EVENT_TOPIC0: Record<string, EscrowEventKind> = {
  // JobFunded(bytes32,address,address,uint256,uint64)
  "0x8a5a73ed96020d59f150155db6982a21c22beed75d08ad7a1dd5eea313568604": "JobFunded",
  // JobReleased(bytes32,address,uint256,bytes32)
  "0x8e19a3298d73963c0ea3d6b58420c84276ba719ab1005f66db4c1ca9344b7eec": "JobReleased",
  // JobRefunded(bytes32,address,uint256)
  "0xa29cbf249cfa7f4623dd9da8fb1b5a81ce77895327f92a86a8539d4b823333a6": "JobRefunded",
};

interface RawContractLog {
  consensus_timestamp: string;
  topics: string[]; // topics[0] = event signature hash, topics[1] = indexed jobId
  data: string;
}

interface RawContractLogsPage {
  logs: RawContractLog[];
  links?: { links?: { next: string | null }; next?: string | null };
}

/**
 * Best-effort escrow events from the contract logs. We key by the indexed
 * jobId (topics[1]) and classify by the known event name when resolvable.
 * The timeline works without this (escrow is inferred from pay/deliver); this
 * upgrades it to real on-chain state when the ABI signatures are supplied.
 */
export async function fetchEscrowEvents(): Promise<EscrowEvent[]> {
  const path = `/api/v1/contracts/${IDS.escrowContractId}/results/logs?order=asc&limit=100`;
  let page: RawContractLogsPage;
  try {
    page = await mirrorGet<RawContractLogsPage>(path);
  } catch {
    return [];
  }

  const out: EscrowEvent[] = [];
  for (const log of page.logs ?? []) {
    const topic0 = log.topics?.[0]?.toLowerCase();
    const jobRef = log.topics?.[1];
    if (!topic0 || !jobRef) continue;
    const kind = EVENT_TOPIC0[topic0];
    if (!kind) continue;
    out.push({
      kind,
      contractJobRef: jobRef,
      consensusMs: consensusToMs(log.consensus_timestamp),
    });
  }
  return out;
}

/** Fold escrow events into job views by contractJobRef, overriding inferred state. */
export function applyEscrowEvents(jobs: JobView[], events: EscrowEvent[]): JobView[] {
  if (events.length === 0) return jobs;
  const latestByRef = new Map<string, EscrowEventKind>();
  for (const e of events) latestByRef.set(e.contractJobRef.toLowerCase(), e.kind);

  for (const job of jobs) {
    const ref = (job.steps.pay?.message.payload as { contractJobRef?: string } | undefined)
      ?.contractJobRef;
    if (!ref) continue;
    const kind = latestByRef.get(ref.toLowerCase());
    if (kind === "JobReleased") job.escrow = "released";
    else if (kind === "JobRefunded") job.escrow = "refunded";
    else if (kind === "JobFunded") job.escrow = "held";
  }
  return jobs;
}

// ── 3. HTS token balance (settlement view) ────────────────────────────────────

interface RawTokenBalances {
  tokens: { token_id: string; balance: number }[];
}

/** Credits-token balance for an account (0 decimals → whole credits). */
export async function fetchCreditsBalance(accountId: string): Promise<number> {
  const data = await mirrorGet<RawTokenBalances>(
    `/api/v1/accounts/${accountId}/tokens?token.id=${IDS.tokenId}`,
  );
  return data.tokens?.[0]?.balance ?? 0;
}

/** Account's HBAR balance in HBAR (kept for the fund/agent views). */
export async function fetchAccountBalanceHbar(accountId: string): Promise<number> {
  const data = await mirrorGet<{ balance?: { balance?: number } }>(
    `/api/v1/accounts/${accountId}`,
  );
  const tinybars = data.balance?.balance;
  if (typeof tinybars !== "number") throw new Error("Balance not found");
  return tinybars / 100_000_000;
}
