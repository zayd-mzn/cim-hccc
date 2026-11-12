/**
 * HCS audit record format.
 *
 * Source of truth: agent-market/PROTOCOL.md § HCS audit format.
 *   - One HCS topic for the PoC.
 *   - Each HCS message = the full AgentMessage JSON plus its content hash.
 *   - HCS provides authoritative ordering + timestamps; the `timestamp` field
 *     on the message is sender-claimed only.
 */
import { z } from 'zod';
import { AgentMessageSchema, type AgentMessage } from './messages.js';
import { contentHash } from './canonical.js';

export const HcsRecordSchema = z.object({
  message: AgentMessageSchema,
  contentHash: z.string().length(64), // sha256 hex
});

/** What gets written to the HCS topic for every protocol message. */
export interface HcsRecord {
  message: AgentMessage;
  /** sha256 of canonical(message minus signature). */
  contentHash: string;
}

/** Wrap an AgentMessage into the on-chain HcsRecord shape. */
export function toHcsRecord(message: AgentMessage): HcsRecord {
  return { message, contentHash: contentHash(message) };
}

/**
 * Verify that an HcsRecord's contentHash matches its message. Does NOT check
 * the signature (that requires the sender's Hedera public key — the verifier's
 * job, see verifyMessageIntegrity callers).
 */
export function hasValidContentHash(record: HcsRecord): boolean {
  return record.contentHash === contentHash(record.message);
}
