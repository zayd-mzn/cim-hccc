/**
 * Payment gateway — the x402 + settlement/escrow seam.
 *
 * DEPENDENCY FLAG:
 *   - x402 flow (402 → pay → retry w/ proof) is owned by Youssef.
 *   - settlement/escrow contract (hold per jobId → release/refund) is Abdellah's
 *     `contracts/contracts/AgentEscrow.sol` (merged on main).
 *
 * This interface is the clean seam my MCP server + agents code against, and it
 * mirrors AgentEscrow's shape 1:1 so the real implementation is a drop-in:
 *   PaymentGateway.pay     → AgentEscrow.fund(jobId, provider, amount, deadline)
 *   PaymentGateway.release → AgentEscrow.deliver(jobId, resultHash)
 *   PaymentGateway.refund  → AgentEscrow.refund(jobId)   [only after deadline]
 *   PaymentGateway.verify  → read the JobFunded event / jobs[jobId].status==Held
 *
 * The StubPaymentGateway below simulates the whole flow against the in-memory
 * HederaClient (including the deadline + refund-after-deadline rule) so the loop
 * runs with real token movement and escrow accounting. When Youssef's x402
 * client wires AgentEscrow in, implement this same interface over it — nothing
 * else in my workstream changes.
 */
import { contractJobRef } from '@agent-market/protocol';
import type { EscrowClient, HederaClient } from '@agent-market/hedera-core';

/** The x402 "402 Payment Required" challenge a Consumer must satisfy. */
export interface PaymentRequired {
  jobId: string;
  amount: number;
  tokenId: string;
  /** Settlement/escrow contract address funds are paid into. */
  contractAddress: string;
  /** Provider that will receive the funds on delivery (AgentEscrow.fund). */
  providerAccountId: string;
  /** Unix seconds; refund allowed only after this (AgentEscrow deadline). */
  deadline: number;
}

/** Proof that payment settled into the contract against a jobId. */
export interface PaymentProof {
  jobId: string;
  txId: string;
  /** Reference the on-chain settlement (PayPayload.contractJobRef). */
  contractJobRef: string;
  amount: number;
  /** x402 `X-PAYMENT` header value (base64), set by X402PaymentGateway. */
  x402?: string;
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

  /**
   * Release escrowed funds to the provider on verified delivery.
   * Mirrors AgentEscrow.deliver(jobId, resultHash): the delivered result hash is
   * recorded on-chain as part of the release.
   */
  release(jobId: string, resultHash: string): Promise<{ txId: string }>;

  /**
   * Refund escrowed funds to the consumer. Mirrors AgentEscrow.refund: only
   * permitted once the job's deadline has passed and it was never delivered.
   */
  refund(jobId: string): Promise<{ txId: string }>;
}

interface EscrowEntry {
  jobId: string;
  consumerAccountId: string;
  providerAccountId: string;
  amount: number;
  tokenId: string;
  contractJobRef: string;
  /** Unix seconds; refund only allowed after this (mirrors AgentEscrow). */
  deadline: number;
  released: boolean;
  refunded: boolean;
  resultHash?: string;
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
    // Same key the real AgentEscrow uses, so stub and testnet `pay` records match.
    const jobRef = contractJobRef(challenge.jobId);
    this.escrows.set(challenge.jobId, {
      jobId: challenge.jobId,
      consumerAccountId,
      providerAccountId: challenge.providerAccountId,
      amount: challenge.amount,
      tokenId: challenge.tokenId,
      contractJobRef: jobRef,
      deadline: challenge.deadline,
      released: false,
      refunded: false,
    });
    return {
      jobId: challenge.jobId,
      txId: transfer.txId,
      contractJobRef: jobRef,
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

  async release(jobId: string, resultHash: string): Promise<{ txId: string }> {
    const escrow = this.escrows.get(jobId);
    if (!escrow) throw new Error(`no escrow for job ${jobId}`);
    if (escrow.released) throw new Error(`escrow already released for job ${jobId}`);
    if (escrow.refunded) throw new Error(`escrow already refunded for job ${jobId}`);
    if (!resultHash) throw new Error('empty result hash');
    const from = await this.escrowAccount();
    const transfer = await this.hedera.transferToken(
      from,
      escrow.providerAccountId,
      escrow.amount,
    );
    escrow.released = true;
    escrow.resultHash = resultHash;
    return { txId: transfer.txId };
  }

  async refund(jobId: string): Promise<{ txId: string }> {
    const escrow = this.escrows.get(jobId);
    if (!escrow) throw new Error(`no escrow for job ${jobId}`);
    if (escrow.released) throw new Error(`cannot refund released job ${jobId}`);
    if (escrow.refunded) throw new Error(`escrow already refunded for job ${jobId}`);
    if (nowSeconds() <= escrow.deadline) {
      throw new Error(`cannot refund job ${jobId} before deadline`);
    }
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

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * EscrowPaymentGateway — a PaymentGateway backed by an EscrowClient.
 *
 * Works with BOTH of Abdellah's implementations behind the same code path:
 *   - InMemoryEscrowClient  (local runs / CI, no network)
 *   - SdkHederaClient        (real AgentEscrow contract on Hedera testnet)
 *
 * This is the real settlement path. The engine is identical whether it runs on
 * the stub or on-chain; only which EscrowClient we inject changes.
 *
 * Per-job consumer/provider context is captured at `pay` time so `release` and
 * `refund` can supply the ids the EscrowClient methods require.
 */
export interface EscrowContext {
  consumerAccountId: string;
  providerAccountId: string;
  amount: number;
  contractJobRef: string;
}

export class EscrowPaymentGateway implements PaymentGateway {
  protected readonly contexts = new Map<string, EscrowContext>();

  constructor(protected readonly escrow: EscrowClient) {}

  requirePayment(input: PaymentRequired): PaymentRequired {
    // The real contract address comes from the EscrowClient.
    return { ...input, contractAddress: this.escrow.escrowAddress };
  }

  async pay(challenge: PaymentRequired, consumerAccountId: string): Promise<PaymentProof> {
    const result = await this.escrow.fundJob(
      challenge.jobId,
      consumerAccountId,
      challenge.providerAccountId,
      challenge.amount,
      challenge.deadline,
    );
    this.contexts.set(challenge.jobId, {
      consumerAccountId,
      providerAccountId: challenge.providerAccountId,
      amount: challenge.amount,
      contractJobRef: result.contractJobRef,
    });
    return {
      jobId: challenge.jobId,
      txId: result.txId,
      contractJobRef: result.contractJobRef,
      amount: challenge.amount,
    };
  }

  async verify(proof: PaymentProof): Promise<boolean> {
    // The proof must point at THIS job's escrow slot, not just any held funds.
    if (proof.contractJobRef !== contractJobRef(proof.jobId)) return false;
    const job = await this.escrow.getJob(proof.jobId);
    return job.status === 'Held' && job.amount === proof.amount;
  }

  async release(jobId: string, resultHash: string): Promise<{ txId: string }> {
    const ctx = this.mustContext(jobId);
    const result = await this.escrow.deliverJob(jobId, ctx.providerAccountId, resultHash);
    return { txId: result.txId };
  }

  async refund(jobId: string): Promise<{ txId: string }> {
    const ctx = this.mustContext(jobId);
    const result = await this.escrow.refundJob(jobId, ctx.consumerAccountId);
    return { txId: result.txId };
  }

  private mustContext(jobId: string): EscrowContext {
    const ctx = this.contexts.get(jobId);
    if (!ctx) throw new Error(`no escrow context for job ${jobId} (was pay() called?)`);
    return ctx;
  }
}
