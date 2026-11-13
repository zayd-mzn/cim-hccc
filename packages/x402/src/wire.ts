/**
 * x402 wire format, adapted to Hedera escrow settlement.
 *
 * Follows the x402 v1 shape (HTTP 402 body with `accepts`, `X-PAYMENT` request
 * header, `X-PAYMENT-RESPONSE` response header, all JSON, headers base64) with
 * one scheme of our own:
 *
 *   scheme "hedera-escrow": the payer funds the AgentEscrow contract for the
 *   job, then proves it by sending the protocol's own signed `pay` AgentMessage.
 *
 * Using the `pay` message as the proof means the x402 proof and the HCS audit
 * record are the same signed object: what the provider verified is exactly what
 * lands on the topic.
 */
import { z } from 'zod';
import { AgentMessageSchema, type AgentMessage } from '@agent-market/protocol';

export const X402_VERSION = 1;
export const HEDERA_ESCROW_SCHEME = 'hedera-escrow';
export const DEFAULT_NETWORK = 'hedera-testnet';

/** Request header carrying the payment proof (base64 JSON PaymentPayload). */
export const PAYMENT_HEADER = 'X-PAYMENT';
/** Response header carrying the settlement result (base64 JSON SettlementResponse). */
export const PAYMENT_RESPONSE_HEADER = 'X-PAYMENT-RESPONSE';

/** What the Provider demands before serving `resource`. Mirrors the `offer` payload. */
export const PaymentRequirementsSchema = z.object({
  scheme: z.literal(HEDERA_ESCROW_SCHEME),
  network: z.string().min(1),
  /** Integer amount of `asset` (credits token has 0 decimals), as a string per x402. */
  maxAmountRequired: z.string().regex(/^\d+$/),
  resource: z.string().min(1),
  description: z.string(),
  mimeType: z.string(),
  /** Provider Hedera account id: who the escrow releases to on delivery. */
  payTo: z.string().min(1),
  maxTimeoutSeconds: z.number().int().positive(),
  /** HTS token id of the credits token. */
  asset: z.string().min(1),
  extra: z.object({
    jobId: z.string().uuid(),
    /** Escrow contract id/address to fund (offer.contractAddress). */
    contractAddress: z.string().min(1),
    /** "0x" + sha256(jobId): the escrow slot to fund. */
    contractJobRef: z.string().regex(/^0x[0-9a-f]{64}$/),
    /** Unix seconds; the escrow refunds the payer after this if undelivered. */
    deadline: z.number().int().positive(),
  }),
});
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

/** Body of an HTTP 402 response. */
export const PaymentRequiredResponseSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  error: z.string(),
  accepts: z.array(PaymentRequirementsSchema).min(1),
});
export type PaymentRequiredResponse = z.infer<typeof PaymentRequiredResponseSchema>;

/** Decoded `X-PAYMENT` header. */
export const PaymentPayloadSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  scheme: z.literal(HEDERA_ESCROW_SCHEME),
  network: z.string().min(1),
  payload: z.object({
    /** The signed protocol `pay` message (type, jobId, payload.txId/contractJobRef/amount). */
    payMessage: AgentMessageSchema,
  }),
});
export interface PaymentPayload {
  x402Version: typeof X402_VERSION;
  scheme: typeof HEDERA_ESCROW_SCHEME;
  network: string;
  payload: { payMessage: AgentMessage<'pay'> };
}

/** Decoded `X-PAYMENT-RESPONSE` header. */
export const SettlementResponseSchema = z.object({
  success: z.boolean(),
  network: z.string(),
  jobId: z.string(),
  /** Escrow funding transaction id. */
  txId: z.string(),
  /** Payer (consumer) Hedera account id. */
  payer: z.string(),
  errorReason: z.string().optional(),
});
export type SettlementResponse = z.infer<typeof SettlementResponseSchema>;

/** base64(JSON) — the x402 header encoding. */
export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

/** Decode a base64(JSON) header and validate it. Throws on malformed input. */
export function decodeHeader<T>(header: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const json: unknown = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  return schema.parse(json);
}

/** Build the X-PAYMENT payload for a signed `pay` message. */
export function toPaymentPayload(
  payMessage: AgentMessage<'pay'>,
  network: string = DEFAULT_NETWORK,
): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    scheme: HEDERA_ESCROW_SCHEME,
    network,
    payload: { payMessage },
  };
}
