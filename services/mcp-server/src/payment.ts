/**
 * Payment gateway — the x402 + settlement/escrow seam.
 *
 * DEPENDENCY FLAG:
 *   - x402 flow (402 → pay → retry w/ proof) is owned by Youssef.
 *   - settlement/escrow contract (hold per jobId → release/refund) is Abdellah's.
 *   - `contractJobRef` format is an open PROTOCOL.md item (Abdellah's contract).
 *
 * This interface is the clean seam my MCP server + agents code against. The
 * StubPaymentGateway below simulates the whole flow against the in-memory
 * HederaClient so the end-to-end loop runs with real token movement and escrow
 * accounting. When Youssef's x402 client + Abdellah's contract land, implement
 * this same interface over them — nothing else in my workstream changes.
 */
import type { HederaClient } from '@agent-market/hedera-core';

/** The x402 "402 Payment Required" challenge a Consumer must satisfy. */
export interface PaymentRequired {
  jobId: string;
  amount: number;
  tokenId: string;
  /** Settlement/escrow contract address funds are paid into. */
  contractAddress: string;
}

/** Proof that payment settled into the contract against a jobId. */
export interface PaymentProof {
  jobId: string;
  txId: string;
  /** Reference the on-chain settlement (PayPayload.contractJobRef). */
  contractJobRef: string;
  amount: number;
}

export interface PaymentGateway {
  /** Build the 402 challenge for a job (mirrors the `offer` payload). */
  requirePayment(input: PaymentRequired): PaymentRequired;

  /**
   * Consumer pays `amount` into the settlement/escrow contract against jobId.
   * Funds are HELD (escrow), not forwarded to the provider yet.
   * Returns proof-of-payment the Consumer attaches to its retry.
   */
  pay(
    challenge: PaymentRequired,
    consumerAccountId: string,
  ): Promise<PaymentProof>;

  /** Verify a proof references real, held funds for the job. */
  verify(proof: PaymentProof): Promise<boolean>;

  /** Release escrowed funds to the provider on verified delivery. */
  release(jobId: string, providerAccountId: string): Promise<{ txId: string }>;

  /** Refund escrowed funds to the consumer (no/failed delivery). */
  refund(jobId: string): Promise<{ txId: string }>;
}

interface EscrowEntry {
  jobId: string;
  consumerAccountId: string;
  amount: number;
  tokenId: string;
  contractJobRef: string;
  released: boolean;
  refunded: boolean;
}

/**
 * Stub gateway: a software escrow backed by the in-memory HederaClient.
 * The "contract" is this object; it holds a balance by moving tokens from the
 * consumer into an escrow account and releasing/refunding from there.
 */
export class StubPaymentGateway implements PaymentGateway {
  private readonly escrows = new Map<string, EscrowEntry>();
  private escrowAccountId: string | null = null;

  constructor(
    private readonly hedera: HederaClient,
    private readonly contractAddress = '0xESCROW_STUB',
  ) {}

  /** Lazily create the escrow holding account. */
  private async escrowAccount(): Promise<string> {
    if (!this.escrowAccountId) {
      const acct = await this.hedera.createAccount('escrow-contract-stub');
      this.escrowAccountId = acct.accountId;
    }
    return this.escrowAccountId;
  }

  requirePayment(input: PaymentRequired): PaymentRequired {
    return { ...input, contractAddress: this.contractAddress };
  }

  async pay(challenge: PaymentRequired, consumerAccountId: string): Promise<PaymentProof> {
    const escrow = await this.escrowAccount();
    const transfer = await this.hedera.transferToken(
      consumerAccountId,
      escrow,
      challenge.amount,
    );
    const contractJobRef = `${this.contractAddress}#${challenge.jobId}`;
    this.escrows.set(challenge.jobId, {
      jobId: challenge.jobId,
      consumerAccountId,
      amount: challenge.amount,
      tokenId: challenge.tokenId,
      contractJobRef,
      released: false,
      refunded: false,
    });
    return {
      jobId: challenge.jobId,
      txId: transfer.txId,
      contractJobRef,
      amount: challenge.amount,
    };
  }

  async verify(proof: PaymentProof): Promise<boolean> {
    const escrow = this.escrows.get(proof.jobId);
    if (!escrow) return false;
    return (
      escrow.contractJobRef === proof.contractJobRef &&
      escrow.amount === proof.amount &&
      !escrow.refunded
    );
  }

  async release(jobId: string, providerAccountId: string): Promise<{ txId: string }> {
    const escrow = this.escrows.get(jobId);
    if (!escrow) throw new Error(`no escrow for job ${jobId}`);
    if (escrow.released) throw new Error(`escrow already released for job ${jobId}`);
    if (escrow.refunded) throw new Error(`escrow already refunded for job ${jobId}`);
    const from = await this.escrowAccount();
    const transfer = await this.hedera.transferToken(from, providerAccountId, escrow.amount);
    escrow.released = true;
    return { txId: transfer.txId };
  }

  async refund(jobId: string): Promise<{ txId: string }> {
    const escrow = this.escrows.get(jobId);
    if (!escrow) throw new Error(`no escrow for job ${jobId}`);
    if (escrow.released) throw new Error(`cannot refund released job ${jobId}`);
    if (escrow.refunded) throw new Error(`escrow already refunded for job ${jobId}`);
    const from = await this.escrowAccount();
    const transfer = await this.hedera.transferToken(
      from,
      escrow.consumerAccountId,
      escrow.amount,
    );
    escrow.refunded = true;
    return { txId: transfer.txId };
  }
}
