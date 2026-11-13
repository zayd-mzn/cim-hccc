/**
 * Mirror Node reader: the HCS audit topic + AgentEscrow event logs.
 *
 * Read-only public REST (no keys, no gRPC), so the reputation engine runs
 * anywhere — including environments that can't submit transactions.
 */
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { EscrowEvent, EscrowEventKind, TopicEntry } from './types.js';

export const TESTNET_MIRROR = 'https://testnet.mirrornode.hedera.com';

/** keccak256 of the AgentEscrow event signatures = log topic[0]. */
const EVENT_SIGNATURES: Record<EscrowEventKind, string> = {
  JobFunded: 'JobFunded(bytes32,address,address,uint256,uint64)',
  JobReleased: 'JobReleased(bytes32,address,uint256,bytes32)',
  JobRefunded: 'JobRefunded(bytes32,address,uint256)',
};
export const EVENT_TOPICS: Record<string, EscrowEventKind> = Object.fromEntries(
  (Object.entries(EVENT_SIGNATURES) as Array<[EscrowEventKind, string]>).map(([kind, sig]) => [
    `0x${bytesToHex(keccak_256(utf8ToBytes(sig)))}`,
    kind,
  ]),
);

export interface MirrorLog {
  topics: string[];
  data: string;
  timestamp: string;
}

/**
 * Decode one AgentEscrow log. All three events index `jobId` as topic[1], and
 * `amount` is the first 32-byte word of `data`. Returns null for other logs.
 */
export function decodeEscrowLog(log: MirrorLog): EscrowEvent | null {
  const kind = EVENT_TOPICS[(log.topics[0] ?? '').toLowerCase()];
  const jobRef = log.topics[1];
  if (!kind || !jobRef) return null;
  const data = log.data.replace(/^0x/, '');
  const amount = data.length >= 64 ? Number(BigInt(`0x${data.slice(0, 64)}`)) : 0;
  return { kind, contractJobRef: normalizeBytes32(jobRef), amount, consensusTimestamp: log.timestamp };
}

function normalizeBytes32(hex: string): string {
  return `0x${hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;
}

export class MirrorNodeClient {
  constructor(
    private readonly baseUrl: string = TESTNET_MIRROR,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** All messages on a topic (paged), decoded from base64 JSON. */
  async topicEntries(topicId: string, opts: { afterSequence?: number } = {}): Promise<TopicEntry[]> {
    const q = opts.afterSequence ? `&sequencenumber=gt:${opts.afterSequence}` : '';
    const raw = await this.paged<{ sequence_number: number; consensus_timestamp: string; message: string }>(
      `/api/v1/topics/${topicId}/messages?limit=100&order=asc${q}`,
      'messages',
    );
    return raw.map((m) => ({
      sequenceNumber: m.sequence_number,
      consensusTimestamp: m.consensus_timestamp,
      record: safeJson(Buffer.from(m.message, 'base64').toString('utf8')),
    }));
  }

  /** All AgentEscrow events emitted by a contract (paged). */
  async escrowEvents(contractId: string): Promise<EscrowEvent[]> {
    const logs = await this.paged<MirrorLog>(`/api/v1/contracts/${contractId}/results/logs?limit=100&order=asc`, 'logs');
    return logs.map(decodeEscrowLog).filter((e): e is EscrowEvent => e !== null);
  }

  private async paged<T>(path: string, key: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    while (next) {
      const res = await this.fetchImpl(`${this.baseUrl}${next}`);
      if (!res.ok) throw new Error(`mirror node ${res.status} for ${next}`);
      const body = (await res.json()) as Record<string, unknown> & { links?: { next?: string | null } };
      out.push(...((body[key] as T[] | undefined) ?? []));
      next = body.links?.next ?? null;
    }
    return out;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
