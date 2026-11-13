/**
 * X402PaymentGateway — the PaymentGateway seam implemented with real x402
 * semantics over the AgentEscrow contract (Youssef).
 *
 *   requirePayment → x402 PaymentRequirements for the job (the "402" challenge)
 *   pay            → fund AgentEscrow + sign the protocol `pay` message, and
 *                    encode it as the X-PAYMENT proof
 *   verify         → the full x402 verifier: signature, job/provider/slot
 *                    binding, amount, and on-chain escrow status `Held`
 *   release/refund → unchanged (inherited from EscrowPaymentGateway)
 *
 * Drop-in: `new MarketplaceEngine({ payment: new X402PaymentGateway(escrow, hedera) })`.
 * Works with InMemoryEscrowClient locally and SdkHederaClient on testnet.
 */
import type { EscrowClient, HederaClient } from '@agent-market/hedera-core';
import {
  DEFAULT_NETWORK,
  PaymentPayloadSchema,
  buildPaymentRequirements,
  createEscrowPayer,
  decodeHeader,
  encodeHeader,
  toPaymentPayload,
  verifyPayment,
  type PaymentPayload,
  type PaymentRequirements,
} from '@agent-market/x402';
import {
  EscrowPaymentGateway,
  type PaymentProof,
  type PaymentRequired,
} from './payment.js';

export class X402PaymentGateway extends EscrowPaymentGateway {
  /** The provider-side terms per job, fixed when the 402 challenge is issued. */
  private readonly terms = new Map<string, PaymentRequirements>();
  private readonly failures = new Map<string, string>();

  constructor(
    escrow: EscrowClient,
    private readonly hedera: Pick<HederaClient, 'signMessage' | 'verifyMessage'>,
    private readonly network: string = DEFAULT_NETWORK,
  ) {
    super(escrow);
  }

  override requirePayment(input: PaymentRequired): PaymentRequired {
    const challenge = super.requirePayment(input);
    this.terms.set(challenge.jobId, this.toRequirements(challenge));
    return challenge;
  }

  /** The x402 requirements issued for a job (what an HTTP 402 body would carry). */
  requirementsFor(jobId: string): PaymentRequirements | undefined {
    return this.terms.get(jobId);
  }

  /** Why the last verify() of a job failed, if it did. */
  lastFailure(jobId: string): string | undefined {
    return this.failures.get(jobId);
  }

  override async pay(challenge: PaymentRequired, consumerAccountId: string): Promise<PaymentProof> {
    const requirements = this.terms.get(challenge.jobId) ?? this.toRequirements(challenge);
    const payer = createEscrowPayer({
      payer: consumerAccountId,
      escrow: this.escrow,
      sign: (accountId, message) => this.hedera.signMessage(accountId, message),
    });
    const payMessage = await payer(requirements);
    this.contexts.set(challenge.jobId, {
      consumerAccountId,
      providerAccountId: challenge.providerAccountId,
      amount: challenge.amount,
      contractJobRef: payMessage.payload.contractJobRef,
    });
    return {
      jobId: challenge.jobId,
      txId: payMessage.payload.txId,
      contractJobRef: payMessage.payload.contractJobRef,
      amount: payMessage.payload.amount,
      x402: encodeHeader(toPaymentPayload(payMessage, this.network)),
    };
  }

  override async verify(proof: PaymentProof): Promise<boolean> {
    const result = await this.check(proof);
    if (result === true) {
      this.failures.delete(proof.jobId);
      return true;
    }
    this.failures.set(proof.jobId, result);
    return false;
  }

  private async check(proof: PaymentProof): Promise<true | string> {
    const requirements = this.terms.get(proof.jobId);
    if (!requirements) return 'no 402 challenge was issued for this job';
    if (!proof.x402) return 'proof has no X-PAYMENT payload';

    let payment: PaymentPayload;
    try {
      payment = decodeHeader(proof.x402, PaymentPayloadSchema) as PaymentPayload;
    } catch {
      return 'malformed X-PAYMENT payload';
    }
    const pay = payment.payload.payMessage.payload;
    if (pay.txId !== proof.txId || pay.contractJobRef !== proof.contractJobRef || pay.amount !== proof.amount) {
      return 'proof fields do not match the signed pay message';
    }

    const result = await verifyPayment(payment, requirements, {
      escrow: this.escrow,
      verifySignature: (m) => this.hedera.verifyMessage(m),
    });
    return result.valid ? true : result.reason;
  }

  private toRequirements(challenge: PaymentRequired): PaymentRequirements {
    return buildPaymentRequirements(challenge, {
      resource: `agent-market://jobs/${challenge.jobId}`,
      network: this.network,
    });
  }
}
