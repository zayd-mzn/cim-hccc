/**
 * Cross-component references and record classification.
 *
 * These live in the protocol package (not in hedera-core or the MCP server) so
 * every reader of the audit log — agents, x402 verifier, reputation engine,
 * dashboard — derives them the SAME way.
 */
import { sha256Hex } from './canonical.js';
import type { AgentMessage } from './messages.js';

/**
 * The on-chain key of a job in the AgentEscrow contract, as 0x-hex bytes32.
 *
 *   contractJobRef(jobId) = "0x" + sha256(jobId)
 *
 * Locked with Abdellah (AgentEscrow stores jobs under this key, and the
 * JobFunded/JobReleased/JobRefunded events carry it as `jobId`). It is the value
 * of `PayPayload.contractJobRef`.
 */
export function contractJobRef(jobId: string): string {
  return `0x${sha256Hex(jobId)}`;
}

/** Prefix the MCP `log_decision` tool uses for `deliver.resultLocation`. */
export const DECISION_LOCATION_PREFIX = 'decision:';

/**
 * Whether a message is an agent decision note rather than a handshake step.
 *
 * For the PoC, `log_decision` writes a `deliver`-shaped envelope addressed to
 * the agent itself with `resultLocation = "decision:<jobId>"`. Readers that
 * reconstruct jobs (reputation, dashboard timeline) must skip these, or a
 * decision would look like a delivery.
 */
export function isDecisionRecord(message: AgentMessage): boolean {
  if (message.type !== 'deliver') return false;
  const location = (message.payload as { resultLocation?: unknown }).resultLocation;
  return (
    message.fromAgent === message.toAgent &&
    typeof location === 'string' &&
    location.startsWith(DECISION_LOCATION_PREFIX)
  );
}

/**
 * Who sends each handshake step: 'consumer' or 'provider'. `pay` is sent by
 * the consumer (addressed to the provider; the funds go to the escrow).
 */
export const SENDER_ROLE = {
  request: 'consumer',
  offer: 'provider',
  accept: 'consumer',
  pay: 'consumer',
  deliver: 'provider',
} as const satisfies Record<AgentMessage['type'], 'consumer' | 'provider'>;
