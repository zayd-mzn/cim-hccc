/**
 * Consumer-side payment: fund the escrow, then produce the signed `pay` message
 * that serves as the x402 proof (and later as the HCS audit record).
 */
import { buildPay, type AgentMessage } from '@agent-market/protocol';
import type { EscrowClient } from '@agent-market/hedera-core';
import { offerFromRequirements } from './requirements.js';
import type { PaymentRequirements } from './wire.js';

/** Given a 402 challenge, pay it and return the signed `pay` message. */
export type X402PayFn = (req: PaymentRequirements) => Promise<AgentMessage<'pay'>>;

/** Build + sign a `pay` message for an already-funded escrow. */
export async function buildSignedPayMessage(input: {
  jobId: string;
  payer: string;
  provider: string;
  amount: number;
  txId: string;
  contractJobRef: string;
  sign: (accountId: string, message: AgentMessage) => Promise<string>;
}): Promise<AgentMessage<'pay'>> {
  const unsigned = buildPay(
    { jobId: input.jobId, fromAgent: input.payer, toAgent: input.provider },
    { amount: input.amount, txId: input.txId, contractJobRef: input.contractJobRef },
  );
  const signature = await input.sign(input.payer, unsigned);
  return { ...unsigned, signature };
}

export interface EscrowPayerOptions {
  /** Consumer Hedera account id paying for jobs. */
  payer: string;
  escrow: Pick<EscrowClient, 'fundJob'>;
  /** Signs with the payer's key (HederaClient.signMessage — server-custodial in the PoC). */
  sign: (accountId: string, message: AgentMessage) => Promise<string>;
  /** Refuse any single payment above this (agent spend guard). */
  maxAmount?: number;
}

/** An X402PayFn that funds AgentEscrow via an EscrowClient. */
export function createEscrowPayer(opts: EscrowPayerOptions): X402PayFn {
  return async (req) => {
    const offer = offerFromRequirements(req);
    if (opts.maxAmount !== undefined && offer.amount > opts.maxAmount) {
      throw new Error(`x402: payment of ${offer.amount} exceeds max ${opts.maxAmount}`);
    }
    const funded = await opts.escrow.fundJob(
      offer.jobId,
      opts.payer,
      offer.providerAccountId,
      offer.amount,
      offer.deadline,
    );
    return buildSignedPayMessage({
      jobId: offer.jobId,
      payer: opts.payer,
      provider: offer.providerAccountId,
      amount: offer.amount,
      txId: funded.txId,
      contractJobRef: funded.contractJobRef,
      sign: opts.sign,
    });
  };
}
