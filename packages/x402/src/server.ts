/**
 * Provider-side HTTP guard: wrap a node:http handler so it answers
 * `402 Payment Required` until a valid X-PAYMENT proof is presented.
 *
 * Framework-free (plain IncomingMessage/ServerResponse) so it works under
 * node:http, Express or Fastify's raw handlers alike.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyPayment, type X402VerifierDeps } from './verifier.js';
import {
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PaymentPayloadSchema,
  X402_VERSION,
  decodeHeader,
  encodeHeader,
  type PaymentPayload,
  type PaymentRequiredResponse,
  type PaymentRequirements,
  type SettlementResponse,
} from './wire.js';
import type { AgentMessage } from '@agent-market/protocol';

export interface PaidContext {
  requirements: PaymentRequirements;
  payer: string;
  payMessage: AgentMessage<'pay'>;
}

export interface X402GuardOptions extends X402VerifierDeps {
  /**
   * Requirements for this request, or null if the resource is unknown (→ 404).
   * Typically looks up the job's offer by the jobId in the URL.
   */
  requirements: (req: IncomingMessage) => Promise<PaymentRequirements | null> | PaymentRequirements | null;
  /** Called once per accepted payment (e.g. to log the `pay` message to HCS). */
  onPaid?: (ctx: PaidContext) => Promise<void> | void;
}

export type PaidHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PaidContext,
) => Promise<void> | void;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function send402(res: ServerResponse, requirements: PaymentRequirements, error: string): void {
  const body: PaymentRequiredResponse = { x402Version: X402_VERSION, error, accepts: [requirements] };
  sendJson(res, 402, body);
}

export function withX402(opts: X402GuardOptions, handler: PaidHandler) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const requirements = await opts.requirements(req);
      if (!requirements) {
        sendJson(res, 404, { error: 'unknown resource' });
        return;
      }

      const header = req.headers[PAYMENT_HEADER.toLowerCase()];
      if (typeof header !== 'string' || header.length === 0) {
        send402(res, requirements, `${PAYMENT_HEADER} header is required`);
        return;
      }

      let payment: PaymentPayload;
      try {
        payment = decodeHeader(header, PaymentPayloadSchema) as PaymentPayload;
      } catch {
        send402(res, requirements, `malformed ${PAYMENT_HEADER} header`);
        return;
      }

      const result = await verifyPayment(payment, requirements, opts);
      if (!result.valid) {
        send402(res, requirements, result.reason);
        return;
      }

      const ctx: PaidContext = { requirements, payer: result.payer, payMessage: result.payMessage };
      await opts.onPaid?.(ctx);

      const settlement: SettlementResponse = {
        success: true,
        network: requirements.network,
        jobId: requirements.extra.jobId,
        txId: result.payMessage.payload.txId,
        payer: result.payer,
      };
      res.setHeader(PAYMENT_RESPONSE_HEADER, encodeHeader(settlement));
      await handler(req, res, ctx);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
      else res.end();
    }
  };
}
