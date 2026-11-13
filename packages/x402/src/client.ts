/**
 * Consumer-side x402 fetch: request → 402 → pay → retry with X-PAYMENT.
 */
import {
  HEDERA_ESCROW_SCHEME,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PaymentRequiredResponseSchema,
  SettlementResponseSchema,
  decodeHeader,
  encodeHeader,
  toPaymentPayload,
  type PaymentRequirements,
  type SettlementResponse,
} from './wire.js';
import type { X402PayFn } from './payer.js';
import type { AgentMessage } from '@agent-market/protocol';

export interface X402FetchOptions {
  pay: X402PayFn;
  /** Only pay requirements on this network (default: accept what the server offers). */
  network?: string;
  /** Inspect the requirements before paying; return false to refuse (→ the 402 response is returned). */
  approve?: (req: PaymentRequirements) => boolean | Promise<boolean>;
  fetchImpl?: typeof fetch;
}

export interface X402FetchResult {
  response: Response;
  /** Present when a payment was made. */
  payment?: {
    requirements: PaymentRequirements;
    payMessage: AgentMessage<'pay'>;
    settlement?: SettlementResponse;
  };
}

export async function fetchWithX402(
  url: string | URL,
  init: RequestInit = {},
  opts: X402FetchOptions,
): Promise<X402FetchResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const first = await doFetch(url, init);
  if (first.status !== 402) return { response: first };

  const body = PaymentRequiredResponseSchema.parse(await first.json());
  const requirements = body.accepts.find(
    (r) => r.scheme === HEDERA_ESCROW_SCHEME && (!opts.network || r.network === opts.network),
  );
  if (!requirements) {
    throw new Error(`x402: no supported payment option (server error: ${body.error})`);
  }
  if (opts.approve && !(await opts.approve(requirements))) {
    return { response: new Response(JSON.stringify(body), { status: 402 }) };
  }

  const payMessage = await opts.pay(requirements);
  const headers = new Headers(init.headers);
  headers.set(PAYMENT_HEADER, encodeHeader(toPaymentPayload(payMessage, requirements.network)));
  const response = await doFetch(url, { ...init, headers });

  const settlementHeader = response.headers.get(PAYMENT_RESPONSE_HEADER);
  const settlement = settlementHeader
    ? decodeHeader(settlementHeader, SettlementResponseSchema)
    : undefined;
  return { response, payment: { requirements, payMessage, settlement } };
}
