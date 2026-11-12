/**
 * In-memory stub of HederaClient.
 *
 * Lets the agents + MCP server run the FULL request→offer→accept→pay→deliver
 * loop locally with zero testnet dependency. Swapped for Abdellah's real
 * `@hashgraph/sdk` implementation (same interface) when it lands.
 *
 * Faithful to the real semantics where it matters for my workstream:
 *   - HCS: append-only, consensus-ordered log with monotonic seq + timestamps.
 *   - HTS: balances that actually move on transfer (so escrow math is real).
 *   - Signing: deterministic fake signature = sha256(canonical ++ secret), so
 *     verifyMessage is a genuine check, not a no-op. Real crypto is Abdellah's.
 */
import {
  canonicalize,
  sha256Hex,
  toHcsRecord,
  unsignedMessage,
  type AgentMessage,
} from '@agent-market/protocol';
import type {
  HederaAccount,
  HederaClient,
  HcsSubmitResult,
  TokenTransferResult,
} from './client.js';
import { InMemoryHcsLog } from './hcs-log.js';

interface StubAccount extends HederaAccount {
  /** Fake private key material — never leaves the stub. */
  secret: string;
}

export interface InMemoryHederaClientOptions {
  /** Shared log instance so a mirror-node reader can observe the same topic. */
  hcsLog?: InMemoryHcsLog;
  /** Starting balance granted to every new account (credits). Default 0. */
  initialBalance?: number;
}

let counter = 0;
function nextId(prefix: number): string {
  counter += 1;
  return `0.0.${prefix}${counter}`;
}

export class InMemoryHederaClient implements HederaClient {
  readonly hcsLog: InMemoryHcsLog;
  private readonly accounts = new Map<string, StubAccount>();
  private readonly balances = new Map<string, number>();
  private readonly initialBalance: number;
  private tokenId: string | null = null;

  constructor(options: InMemoryHederaClientOptions = {}) {
    this.hcsLog = options.hcsLog ?? new InMemoryHcsLog();
    this.initialBalance = options.initialBalance ?? 0;
  }

  async createToken(name = 'credits', symbol = 'CRED'): Promise<{ tokenId: string }> {
    void name;
    void symbol;
    this.tokenId = nextId(7);
    return { tokenId: this.tokenId };
  }

  async createTopic(memo = 'agent-market-audit'): Promise<{ topicId: string }> {
    return { topicId: this.hcsLog.ensureTopic(memo) };
  }

  async createAccount(label = 'agent'): Promise<HederaAccount> {
    const accountId = nextId(4);
    const secret = sha256Hex(`${accountId}:${label}:${Math.random()}`);
    const publicKey = sha256Hex(`pub:${secret}`);
    this.accounts.set(accountId, { accountId, publicKey, secret });
    this.balances.set(accountId, this.initialBalance);
    return { accountId, publicKey };
  }

  async transferToken(from: string, to: string, amount: number): Promise<TokenTransferResult> {
    if (amount < 0) throw new Error('transfer amount must be non-negative');
    const fromBal = this.balances.get(from) ?? 0;
    if (fromBal < amount) {
      throw new Error(`insufficient balance: ${from} has ${fromBal}, needs ${amount}`);
    }
    this.balances.set(from, fromBal - amount);
    this.balances.set(to, (this.balances.get(to) ?? 0) + amount);
    return {
      txId: `tx-${sha256Hex(`${from}:${to}:${amount}:${Date.now()}:${Math.random()}`).slice(0, 16)}`,
      tokenId: this.tokenId ?? 'unset',
      from,
      to,
      amount,
    };
  }

  async submitHcsMessage(topicId: string, message: AgentMessage): Promise<HcsSubmitResult> {
    // Ensure the message is signed (sign if the caller left it blank).
    const signed =
      message.signature && message.signature.length > 0
        ? message
        : { ...message, signature: await this.signMessage(message.fromAgent, message) };
    const record = toHcsRecord(signed);
    const entry = this.hcsLog.append(topicId, record);
    return {
      topicId,
      consensusTimestamp: entry.consensusTimestamp,
      sequenceNumber: entry.sequenceNumber,
      record,
    };
  }

  async signMessage(accountId: string, message: AgentMessage): Promise<string> {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`unknown account: ${accountId}`);
    return sha256Hex(`${canonicalize(unsignedMessage(message))}::${account.secret}`);
  }

  async verifyMessage(message: AgentMessage): Promise<boolean> {
    const account = this.accounts.get(message.fromAgent);
    if (!account) return false;
    const expected = sha256Hex(`${canonicalize(unsignedMessage(message))}::${account.secret}`);
    return expected === message.signature;
  }

  async balanceOf(accountId: string): Promise<number> {
    return this.balances.get(accountId) ?? 0;
  }

  /** Test/demo helper: mint credits into an account (stub-only). */
  grant(accountId: string, amount: number): void {
    this.balances.set(accountId, (this.balances.get(accountId) ?? 0) + amount);
  }
}
