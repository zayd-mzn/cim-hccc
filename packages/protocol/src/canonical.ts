/**
 * Canonicalization + hashing.
 *
 * Source of truth: agent-market/PROTOCOL.md § Signing rules.
 *   "Canonicalize the message (stable key order, exclude `signature`), hash it,
 *    sign with the sender's Hedera key."
 *
 * contentHash = sha256 of canonical(message minus signature).
 *
 * NOTE (dependency flag): the exact signature scheme (Hedera key type /
 * canonicalization detail) is an open item to confirm with Abdellah
 * (PROTOCOL.md § Open items). This module fixes a concrete, deterministic
 * canonical form so every component agrees; if Abdellah's signing requires a
 * different canonicalization we adjust here in ONE place.
 */
import { createHash } from 'node:crypto';
import type { AgentMessage } from './messages.js';

/**
 * Produce a deterministic JSON string with recursively sorted object keys.
 * Arrays keep their order; objects are key-sorted; primitives are stringified
 * by JSON.stringify. This is the canonical form that gets hashed and signed.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeys(obj[key]);
    }
    return sorted;
  }
  return value;
}

/** The message stripped of its signature — the thing that is hashed + signed. */
export function unsignedMessage(message: AgentMessage): Omit<AgentMessage, 'signature'> {
  const { signature: _signature, ...rest } = message;
  return rest;
}

/** sha256 (hex) of the canonical form of the unsigned message. */
export function contentHash(message: AgentMessage): string {
  return sha256Hex(canonicalize(unsignedMessage(message)));
}

/** sha256 (hex) of an arbitrary string — used for result-hash of delivered data. */
export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** sha256 (hex) of raw bytes — used for hashing delivered dataset buffers. */
export function sha256HexBytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
