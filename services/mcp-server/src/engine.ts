/**
 * Marketplace engine — the core that the MCP tools call into.
 *
 * Responsibilities (SPEC.md Layer 6 + ARCHITECTURE.md data flow):
 *   - discover providers (registry)
 *   - open a job: get the provider's offer, return jobId + x402 payment details
 *   - drive payment into the settlement/escrow contract
 *   - fetch delivery (provider produces result + hash), release escrow
 *   - log every protocol message to HCS via hedera-core
 *
 * The engine is server-custodial (TRUST-MODEL.md): it holds a Hedera account
 * per connected agent and acts on its behalf.
 */
import {
  buildAccept,
  buildDeliver,
  buildOffer,
  buildPay,
  buildRequest,
  type AgentMessage,
} from '@agent-market/protocol';
import type { HederaClient } from '@agent-market/hedera-core';
import { ProviderRegistry, type ProviderProfile } from './registry.js';
import {
  StubPaymentGateway,
  type PaymentGateway,
  type PaymentRequired,
} from './payment.js';
import { randomUUID } from 'node:crypto';

/**
 * A provider connector lets the engine ask a provider agent to (a) quote an
 * offer for a request and (b) produce a delivery once paid. The provider agent
 * implements this; the engine never knows the agent's internals.
 */
export interface ProviderConnector {
  readonly providerId: string;
  /** Quote an offer for a request spec. */
  quote(input: { jobId: string; capability: string; spec: Record<string, unknown> }): Promise<{
    price: number;
    expiresAt: string;
  }>;
  /** Produce the deliverable; returns the data + its hash + a location ref. */
  deliver(input: { jobId: string; spec: Record<string, unknown> }): Promise<{
    resultHash: string;
    resultLocation: string;
  }>;
}

type JobStatus =
  | 'requested'
  | 'offered'
  | 'accepted'
  | 'paid'
  | 'delivered'
  | 'released'
  | 'failed';

export interface Job {
  jobId: string;
  consumerAccountId: string;
  providerId: string;
  providerAccountId: string;
  capability: string;
  spec: Record<string, unknown>;
  status: JobStatus;
  offer?: { price: number; tokenId: string; contractAddress: string; expiresAt: string };
  paymentRequired?: PaymentRequired;
  proof?: { txId: string; contractJobRef: string; amount: number };
  delivery?: { resultHash: string; resultLocation: string };
}

export interface MarketplaceEngineOptions {
  hedera: HederaClient;
  topicId: string;
  tokenId: string;
  registry?: ProviderRegistry;
  payment?: PaymentGateway;
}

export class MarketplaceEngine {
  readonly registry: ProviderRegistry;
  private readonly hedera: HederaClient;
  private readonly payment: PaymentGateway;
  private readonly topicId: string;
  private readonly tokenId: string;
  private readonly jobs = new Map<string, Job>();
  private readonly connectors = new Map<string, ProviderConnector>();
  /** Server-custodial account id per connected agent id. */
  private readonly custodialAccounts = new Map<string, string>();

  constructor(opts: MarketplaceEngineOptions) {
    this.hedera = opts.hedera;
    this.topicId = opts.topicId;
    this.tokenId = opts.tokenId;
    this.registry = opts.registry ?? new ProviderRegistry();
    this.payment = opts.payment ?? new StubPaymentGateway(opts.hedera);
  }

  /** Bind an agent id to its server-custodial Hedera account. */
  bindAccount(agentId: string, accountId: string): void {
    this.custodialAccounts.set(agentId, accountId);
  }

  /** Whether an agent id already has a bound custodial account. */
  hasAccount(agentId: string): boolean {
    return this.custodialAccounts.has(agentId);
  }

  /**
   * Register a (typically external, bring-your-own) agent: provision a
   * server-custodial Hedera account for it and bind it to the agentId it will
   * present on subsequent tool calls. Idempotent — returns the existing account
   * if the agent is already registered.
   *
   * This is Model B step 1–2 (TRUST-MODEL.md): the agent gets an on-chain
   * identity and joins the marketplace, without importing any of our code.
   *
   * `initialGrant` funds the account for the PoC; a real deployment would fund
   * via a real transfer. Only honoured if the stub client supports `grant`.
   */
  async registerAgent(input: {
    agentId: string;
    label?: string;
    initialGrant?: number;
  }): Promise<{ agentId: string; accountId: string; publicKey: string }> {
    const existing = this.custodialAccounts.get(input.agentId);
    if (existing) {
      return { agentId: input.agentId, accountId: existing, publicKey: '' };
    }
    const account = await this.hedera.createAccount(input.label ?? input.agentId);
    this.bindAccount(input.agentId, account.accountId);
    if (input.initialGrant && input.initialGrant > 0) {
      const granter = this.hedera as { grant?: (a: string, n: number) => void };
      granter.grant?.(account.accountId, input.initialGrant);
    }
    return {
      agentId: input.agentId,
      accountId: account.accountId,
      publicKey: account.publicKey,
    };
  }

  private accountFor(agentId: string): string {
    const acct = this.custodialAccounts.get(agentId);
    if (!acct) throw new Error(`no custodial account bound for agent ${agentId}`);
    return acct;
  }

  /** Register a provider agent + its connector + capability profile. */
  connectProvider(profile: ProviderProfile, connector: ProviderConnector): void {
    this.registry.register(profile);
    this.connectors.set(profile.providerId, connector);
  }

  // --- MCP tool: discover_providers ---------------------------------------
  discoverProviders(capability: string): ProviderProfile[] {
    return this.registry.findByCapability(capability);
  }

  // --- MCP tool: request_service ------------------------------------------
  /**
   * Consumer requests a service. Engine logs `request`, asks the provider for an
   * `offer`, logs the `offer`, and returns jobId + x402 payment details.
   */
  async requestService(input: {
    consumerAgentId: string;
    providerId: string;
    capability: string;
    spec: Record<string, unknown>;
  }): Promise<{ jobId: string; paymentRequired: PaymentRequired; offer: Job['offer'] }> {
    const connector = this.connectors.get(input.providerId);
    const profile = this.registry.get(input.providerId);
    if (!connector || !profile) throw new Error(`unknown provider ${input.providerId}`);

    const jobId = randomUUID();
    const consumerAccountId = this.accountFor(input.consumerAgentId);
    const providerAccountId = this.accountFor(input.providerId);

    const job: Job = {
      jobId,
      consumerAccountId,
      providerId: input.providerId,
      providerAccountId,
      capability: input.capability,
      spec: input.spec,
      status: 'requested',
    };
    this.jobs.set(jobId, job);

    // request (Consumer → Provider)
    await this.log(
      buildRequest(
        { jobId, fromAgent: consumerAccountId, toAgent: providerAccountId },
        { capability: input.capability, spec: input.spec },
      ),
      consumerAccountId,
    );

    // provider quotes
    const quote = await connector.quote({ jobId, capability: input.capability, spec: input.spec });
    // Escrow deadline: funds are refundable to the consumer after the offer
    // expires if the provider never delivers (mirrors AgentEscrow deadline).
    const deadline = Math.floor(new Date(quote.expiresAt).getTime() / 1000);
    const offer = {
      price: quote.price,
      tokenId: this.tokenId,
      contractAddress: this.payment.requirePayment({
        jobId,
        amount: quote.price,
        tokenId: this.tokenId,
        contractAddress: '',
        providerAccountId,
        deadline,
      }).contractAddress,
      expiresAt: quote.expiresAt,
    };
    job.offer = offer;
    job.status = 'offered';

    // offer (Provider → Consumer)
    await this.log(
      buildOffer({ jobId, fromAgent: providerAccountId, toAgent: consumerAccountId }, offer),
      providerAccountId,
    );

    const paymentRequired: PaymentRequired = {
      jobId,
      amount: offer.price,
      tokenId: offer.tokenId,
      contractAddress: offer.contractAddress,
      providerAccountId,
      deadline,
    };
    job.paymentRequired = paymentRequired;

    return { jobId, paymentRequired, offer };
  }

  // --- MCP tool: pay_for_job ----------------------------------------------
  /**
   * Consumer accepts + pays. Engine logs `accept`, pays into escrow via the
   * payment gateway, verifies, and logs `pay`.
   */
  async payForJob(input: { consumerAgentId: string; jobId: string }): Promise<{
    proof: { txId: string; contractJobRef: string; amount: number };
  }> {
    const job = this.mustJob(input.jobId);
    if (!job.offer || !job.paymentRequired) throw new Error(`job ${job.jobId} has no offer`);
    const consumerAccountId = this.accountFor(input.consumerAgentId);

    // accept (Consumer → Provider)
    await this.log(
      buildAccept(
        { jobId: job.jobId, fromAgent: consumerAccountId, toAgent: job.providerAccountId },
        { acceptedPrice: job.offer.price },
      ),
      consumerAccountId,
    );
    job.status = 'accepted';

    // pay into escrow (x402: pay → proof)
    const proof = await this.payment.pay(job.paymentRequired, consumerAccountId);
    const ok = await this.payment.verify(proof);
    if (!ok) {
      job.status = 'failed';
      throw new Error(`payment verification failed for job ${job.jobId}`);
    }
    job.proof = { txId: proof.txId, contractJobRef: proof.contractJobRef, amount: proof.amount };
    job.status = 'paid';

    // pay (Consumer → settlement contract), logged to HCS
    await this.log(
      buildPay(
        { jobId: job.jobId, fromAgent: consumerAccountId, toAgent: job.providerAccountId },
        { amount: proof.amount, txId: proof.txId, contractJobRef: proof.contractJobRef },
      ),
      consumerAccountId,
    );

    return { proof: job.proof };
  }

  // --- MCP tool: get_delivery ---------------------------------------------
  /**
   * Provider verifies payment, produces the deliverable, engine logs `deliver`
   * and releases escrow to the provider.
   */
  async getDelivery(input: { jobId: string }): Promise<{
    resultHash: string;
    resultLocation: string;
  }> {
    const job = this.mustJob(input.jobId);
    if (job.status !== 'paid') throw new Error(`job ${job.jobId} not paid (status=${job.status})`);
    const connector = this.connectors.get(job.providerId);
    if (!connector) throw new Error(`provider ${job.providerId} disconnected`);

    const delivery = await connector.deliver({ jobId: job.jobId, spec: job.spec });
    job.delivery = delivery;
    job.status = 'delivered';

    // deliver (Provider → Consumer)
    await this.log(
      buildDeliver(
        { jobId: job.jobId, fromAgent: job.providerAccountId, toAgent: job.consumerAccountId },
        delivery,
      ),
      job.providerAccountId,
    );

    // release escrow to provider (records the delivered result hash on-chain)
    await this.payment.release(job.jobId, delivery.resultHash);
    job.status = 'released';

    return delivery;
  }

  // --- refund (no/failed delivery) ----------------------------------------
  /**
   * Refund a paid-but-undelivered job back to the consumer. Mirrors
   * AgentEscrow.refund: only valid after the job deadline and before release.
   * Exposes the escrow's failure path (future work: surface as an MCP tool).
   */
  async refundJob(input: { jobId: string }): Promise<{ txId: string }> {
    const job = this.mustJob(input.jobId);
    if (job.status !== 'paid') {
      throw new Error(`job ${job.jobId} not refundable (status=${job.status})`);
    }
    const result = await this.payment.refund(job.jobId);
    job.status = 'failed';
    return result;
  }

  // --- MCP tool: log_decision ---------------------------------------------
  /**
   * Write an agent's reasoning to HCS. Uses a `deliver`-shaped envelope carrying
   * the rationale hash so it is auditable alongside the job (kept minimal for
   * the PoC; a dedicated `decision` message type can be added to the schema).
   */
  async logDecision(input: {
    agentId: string;
    jobId: string;
    rationale: string;
  }): Promise<{ sequenceNumber: number }> {
    const accountId = this.accountFor(input.agentId);
    const { sha256Hex } = await import('@agent-market/protocol');
    const msg = buildDeliver(
      { jobId: input.jobId, fromAgent: accountId, toAgent: accountId },
      {
        resultHash: sha256Hex(input.rationale),
        resultLocation: `decision:${input.jobId}`,
      },
    );
    const result = await this.submit(msg, accountId);
    return { sequenceNumber: result.sequenceNumber };
  }

  // --- helpers -------------------------------------------------------------
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  private mustJob(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);
    return job;
  }

  /** Sign + submit a built (unsigned) message to HCS via the wrapper. */
  private async log(message: AgentMessage, signerAccountId: string): Promise<void> {
    await this.submit(message, signerAccountId);
  }

  private async submit(message: AgentMessage, signerAccountId: string) {
    const signature = await this.hedera.signMessage(signerAccountId, message);
    return this.hedera.submitHcsMessage(this.topicId, { ...message, signature });
  }
}
