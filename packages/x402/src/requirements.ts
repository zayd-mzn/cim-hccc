/**
 * Translate between a job's offer/escrow terms and x402 PaymentRequirements.
 *
 * `EscrowOffer` has the same fields as the MCP server's `PaymentRequired`
 * (jobId, amount, tokenId, contractAddress, providerAccountId, deadline), so the
 * engine's 402 challenge maps onto the HTTP 402 body 1:1.
 */
import { contractJobRef } from '@agent-market/protocol';
import {
  DEFAULT_NETWORK,
  HEDERA_ESCROW_SCHEME,
  type PaymentRequirements,
} from './wire.js';

export interface EscrowOffer {
  jobId: string;
  amount: number;
  tokenId: string;
  contractAddress: string;
  providerAccountId: string;
  /** Unix seconds. */
  deadline: number;
}

export interface RequirementsOptions {
  /** What is being paid for, e.g. "https://provider.example/jobs/<id>/result". */
  resource: string;
  network?: string;
  description?: string;
  mimeType?: string;
  /** Unix seconds, for maxTimeoutSeconds. Defaults to now. */
  now?: number;
}

export function buildPaymentRequirements(
  offer: EscrowOffer,
  opts: RequirementsOptions,
): PaymentRequirements {
  if (!Number.isInteger(offer.amount) || offer.amount <= 0) {
    throw new Error(`x402: amount must be a positive integer, got ${offer.amount}`);
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  return {
    scheme: HEDERA_ESCROW_SCHEME,
    network: opts.network ?? DEFAULT_NETWORK,
    maxAmountRequired: String(offer.amount),
    resource: opts.resource,
    description: opts.description ?? `Agent Market job ${offer.jobId}`,
    mimeType: opts.mimeType ?? 'application/json',
    payTo: offer.providerAccountId,
    maxTimeoutSeconds: Math.max(1, offer.deadline - now),
    asset: offer.tokenId,
    extra: {
      jobId: offer.jobId,
      contractAddress: offer.contractAddress,
      contractJobRef: contractJobRef(offer.jobId),
      deadline: offer.deadline,
    },
  };
}

/** Inverse of buildPaymentRequirements: the escrow terms a payer must fund. */
export function offerFromRequirements(req: PaymentRequirements): EscrowOffer {
  return {
    jobId: req.extra.jobId,
    amount: Number(req.maxAmountRequired),
    tokenId: req.asset,
    contractAddress: req.extra.contractAddress,
    providerAccountId: req.payTo,
    deadline: req.extra.deadline,
  };
}
