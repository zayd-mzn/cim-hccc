/**
 * Handshake message builders.
 *
 * Convenience constructors that produce well-formed (but UNSIGNED) AgentMessages
 * for each step of the request → offer → accept → pay → deliver sequence.
 * Signing is done by the caller via the hedera-core wrapper (it holds the key).
 *
 * Source of truth: agent-market/PROTOCOL.md § The handshake.
 */
import type {
  AgentMessage,
  AcceptPayload,
  DeliverPayload,
  OfferPayload,
  PayPayload,
  RequestPayload,
} from './messages.js';

export interface MessageIdentity {
  jobId: string;
  fromAgent: string;
  toAgent: string;
  /** ISO 8601; defaults to now if omitted. */
  timestamp?: string;
}

function base<T extends AgentMessage['type']>(
  type: T,
  id: MessageIdentity,
): Omit<AgentMessage<T>, 'payload' | 'signature'> {
  return {
    type,
    jobId: id.jobId,
    fromAgent: id.fromAgent,
    toAgent: id.toAgent,
    timestamp: id.timestamp ?? new Date().toISOString(),
  };
}

/** signature is left empty — caller signs via hedera-core. */
const UNSIGNED = '';

export function buildRequest(id: MessageIdentity, payload: RequestPayload): AgentMessage<'request'> {
  return { ...base('request', id), payload, signature: UNSIGNED };
}

export function buildOffer(id: MessageIdentity, payload: OfferPayload): AgentMessage<'offer'> {
  return { ...base('offer', id), payload, signature: UNSIGNED };
}

export function buildAccept(id: MessageIdentity, payload: AcceptPayload): AgentMessage<'accept'> {
  return { ...base('accept', id), payload, signature: UNSIGNED };
}

export function buildPay(id: MessageIdentity, payload: PayPayload): AgentMessage<'pay'> {
  return { ...base('pay', id), payload, signature: UNSIGNED };
}

export function buildDeliver(id: MessageIdentity, payload: DeliverPayload): AgentMessage<'deliver'> {
  return { ...base('deliver', id), payload, signature: UNSIGNED };
}

/**
 * The canonical order of the 5-message handshake. Used by verifiers/tests to
 * assert a job followed the protocol.
 */
export const HANDSHAKE_ORDER = ['request', 'offer', 'accept', 'pay', 'deliver'] as const;
