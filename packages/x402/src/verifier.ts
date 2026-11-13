/**
 * Provider-side x402 verification for the "hedera-escrow" scheme.
 *
 * A payment is accepted only if ALL of these hold:
 *   1. The X-PAYMENT payload matches the requirements' version/scheme/network.
 *   2. It carries a well-formed protocol `pay` message for THIS job, addressed
 *      to THIS provider, referencing THIS job's escrow slot, for enough credits.
 *   3. The `pay` message signature verifies against the sender's Hedera key.
 *   4. On-chain, the escrow slot is `Held`, for at least the amount, between
 *      exactly this consumer and this provider.
 *
 * (4) is what makes it a payment rather than a promise: the funds are locked in
 * AgentEscrow and only the provider's delivery can release them.
 */
import {
  contractJobRef,
  safeParseAgentMessage,
  type AgentMessage,
} from '@agent-market/protocol';
import type { EscrowClient } from '@agent-market/hedera-core';
import type { PaymentPayload, PaymentRequirements } from './wire.js';

export interface X402VerifierDeps {
  /** Reads on-chain escrow state (EscrowClient / SdkHederaClient). */
  escrow: Pick<EscrowClient, 'getJob'>;
  /** Checks a message signature against the sender's key (HederaClient.verifyMessage). */
  verifySignature: (message: AgentMessage) => Promise<boolean>;
}

export type VerifyResult =
  | { valid: true; payer: string; payMessage: AgentMessage<'pay'> }
  | { valid: false; reason: string };

const ACCOUNT_ID = /^\d+\.\d+\.\d+$/;

function fail(reason: string): VerifyResult {
  return { valid: false, reason };
}

export async function verifyPayment(
  payment: PaymentPayload,
  req: PaymentRequirements,
  deps: X402VerifierDeps,
): Promise<VerifyResult> {
  if (payment.scheme !== req.scheme) return fail(`scheme mismatch: ${payment.scheme}`);
  if (payment.network !== req.network) return fail(`network mismatch: ${payment.network}`);

  const parsed = safeParseAgentMessage(payment.payload.payMessage);
  if (!parsed.success) return fail(`malformed pay message: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  const msg = parsed.message;
  if (msg.type !== 'pay') return fail(`expected a pay message, got ${msg.type}`);
  const pay = msg as AgentMessage<'pay'>;

  const { jobId } = req.extra;
  const required = Number(req.maxAmountRequired);
  const expectedRef = contractJobRef(jobId);

  if (pay.jobId !== jobId) return fail('pay message is for a different job');
  if (pay.toAgent !== req.payTo) return fail('pay message is addressed to a different provider');
  if (req.extra.contractJobRef !== expectedRef) return fail('requirements carry a wrong contractJobRef');
  if (pay.payload.contractJobRef !== expectedRef) return fail('pay message references a different escrow slot');
  if (pay.payload.amount < required) return fail(`underpaid: ${pay.payload.amount} < ${required}`);

  if (!(await deps.verifySignature(pay))) return fail('invalid signature on pay message');

  const job = await deps.escrow.getJob(jobId);
  if (job.status !== 'Held') return fail(`escrow is ${job.status}, not Held`);
  if (job.amount < required) return fail(`escrow holds ${job.amount} < ${required}`);
  // Parties are compared only when the escrow reports plain account ids
  // (an ECDSA alias would surface as an EVM address instead).
  if (ACCOUNT_ID.test(job.provider) && job.provider !== req.payTo) {
    return fail('escrow releases to a different provider');
  }
  if (ACCOUNT_ID.test(job.consumer) && job.consumer !== pay.fromAgent) {
    return fail('escrow was funded by a different account than the pay message signer');
  }
  if (job.deadline !== req.extra.deadline) return fail('escrow deadline differs from the offer');

  return { valid: true, payer: pay.fromAgent, payMessage: pay };
}
