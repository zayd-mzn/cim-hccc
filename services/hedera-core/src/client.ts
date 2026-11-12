/**
 * HederaClient — the ONE interface everything uses to touch Hedera.
 *
 * Ownership: Abdellah (ROLES.md). This file is the CONTRACT that Abdellah's real
 * `@hashgraph/sdk`-backed implementation must satisfy, and that my agents + MCP
 * server code against. Nothing except this package may import `@hashgraph/sdk`
 * (ARCHITECTURE.md § Boundaries that must not be crossed).
 *
 * Methods required by SPEC.md § Layer 2:
 *   createToken()                      — create the HTS "credits" token (once)
 *   transferToken(from, to, amount)    — token movement
 *   submitHcsMessage(topicId, message) — sign + hash a protocol message, write to HCS
 *   createTopic()                      — create the audit topic (once)
 *   createAccount()                    — create a Hedera account (per agent, server-custodial)
 *
 * DEPENDENCY FLAG (for Zayd ↔ Abdellah): these signatures are my provisional
 * contract. If Abdellah's wrapper differs, we reconcile HERE only — agent/MCP
 * code depends solely on this interface.
 */
import type { AgentMessage, HcsRecord } from '@agent-market/protocol';

/** A Hedera account owned (custodially, for the PoC) by the platform. */
export interface HederaAccount {
  /** Hedera account id, e.g. "0.0.12345". */
  accountId: string;
  /** Public key (hex or DER). Used by verifiers to check signatures. */
  publicKey: string;
}

/** Result of submitting a message to an HCS topic. */
export interface HcsSubmitResult {
  topicId: string;
  /** Hedera consensus timestamp — the AUTHORITATIVE order/time (PROTOCOL.md). */
  consensusTimestamp: string;
  /** Monotonic sequence number assigned by consensus. */
  sequenceNumber: number;
  /** The record as written (message + contentHash). */
  record: HcsRecord;
}

/** Result of an HTS token transfer. */
export interface TokenTransferResult {
  txId: string;
  tokenId: string;
  from: string;
  to: string;
  amount: number;
}

export interface HederaClient {
  /** Create the HTS "credits" token. Called once at setup. Returns tokenId. */
  createToken(name?: string, symbol?: string): Promise<{ tokenId: string }>;

  /** Create the HCS audit topic. Called once at setup. Returns topicId. */
  createTopic(memo?: string): Promise<{ topicId: string }>;

  /** Create a (server-custodial) Hedera account for an agent. */
  createAccount(label?: string): Promise<HederaAccount>;

  /** Transfer `amount` of the credits token from one account to another. */
  transferToken(from: string, to: string, amount: number): Promise<TokenTransferResult>;

  /**
   * Sign + hash a protocol message and write it to the HCS topic.
   * The wrapper is responsible for signing `message` with `fromAgent`'s key and
   * wrapping it into an HcsRecord before submission.
   */
  submitHcsMessage(topicId: string, message: AgentMessage): Promise<HcsSubmitResult>;

  /**
   * Sign a message with the given account's key, returning the signature only.
   * (Agents build messages via the protocol builders, then ask the wrapper to
   * sign since the wrapper custodies the keys.)
   */
  signMessage(accountId: string, message: AgentMessage): Promise<string>;

  /** Verify a message's signature against the sender's account public key. */
  verifyMessage(message: AgentMessage): Promise<boolean>;

  /** Current credits-token balance of an account. */
  balanceOf(accountId: string): Promise<number>;
}
