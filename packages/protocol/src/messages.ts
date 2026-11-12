/**
 * Message envelope + per-type payloads.
 *
 * Source of truth: agent-market/PROTOCOL.md (the day-1 shared contract).
 * Owner per ROLES.md: Youssef. This is a PROVISIONAL implementation built by
 * Zayd so the agents + MCP server can run end-to-end; reconcile before merge.
 *
 * A single job is a fixed 5-message sequence:
 *   Consumer ── request ──▶ Provider
 *   Consumer ◀── offer  ──  Provider
 *   Consumer ── accept  ──▶ Provider
 *   Consumer ── pay     ──▶ (settlement contract)   [x402: 402 → pay → retry w/ proof]
 *   Consumer ◀── deliver ── Provider
 */
import { z } from 'zod';

/** The five message types that make up one job handshake. */
export const MESSAGE_TYPES = ['request', 'offer', 'accept', 'pay', 'deliver'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-type payloads (PROTOCOL.md § Per-type payloads)
// ---------------------------------------------------------------------------

/** request — Consumer asks for a service. */
export const RequestPayloadSchema = z.object({
  capability: z.string().min(1),
  spec: z.record(z.unknown()),
});
export type RequestPayload = z.infer<typeof RequestPayloadSchema>;

/** offer — Provider quotes a price. */
export const OfferPayloadSchema = z.object({
  price: z.number().nonnegative(),
  tokenId: z.string().min(1),
  contractAddress: z.string().min(1),
  expiresAt: z.string().datetime(),
});
export type OfferPayload = z.infer<typeof OfferPayloadSchema>;

/** accept — Consumer agrees to the offer. */
export const AcceptPayloadSchema = z.object({
  acceptedPrice: z.number().nonnegative(),
});
export type AcceptPayload = z.infer<typeof AcceptPayloadSchema>;

/** pay — Consumer records payment into the settlement contract. */
export const PayPayloadSchema = z.object({
  amount: z.number().nonnegative(),
  txId: z.string().min(1),
  contractJobRef: z.string().min(1),
});
export type PayPayload = z.infer<typeof PayPayloadSchema>;

/** deliver — Provider delivers the result (only the hash is authoritative). */
export const DeliverPayloadSchema = z.object({
  resultHash: z.string().min(1),
  resultLocation: z.string().min(1),
});
export type DeliverPayload = z.infer<typeof DeliverPayloadSchema>;

/** Maps a message type to its payload type. */
export interface PayloadByType {
  request: RequestPayload;
  offer: OfferPayload;
  accept: AcceptPayload;
  pay: PayPayload;
  deliver: DeliverPayload;
}

const payloadSchemaByType = {
  request: RequestPayloadSchema,
  offer: OfferPayloadSchema,
  accept: AcceptPayloadSchema,
  pay: PayPayloadSchema,
  deliver: DeliverPayloadSchema,
} as const satisfies Record<MessageType, z.ZodType>;

// ---------------------------------------------------------------------------
// Message envelope (PROTOCOL.md § Message envelope)
// ---------------------------------------------------------------------------

export const AgentMessageSchema = z.object({
  type: z.enum(MESSAGE_TYPES),
  jobId: z.string().uuid(),
  fromAgent: z.string().min(1), // Hedera account id of sender
  toAgent: z.string().min(1), // Hedera account id of recipient
  timestamp: z.string().datetime(), // ISO 8601, sender-claimed (HCS gives authoritative order)
  payload: z.record(z.unknown()),
  signature: z.string(), // sender signs canonical(message minus signature) with its Hedera key
});

/** The envelope every protocol message shares. */
export interface AgentMessage<T extends MessageType = MessageType> {
  type: T;
  jobId: string;
  fromAgent: string;
  toAgent: string;
  timestamp: string;
  payload: PayloadByType[T];
  signature: string;
}

/**
 * Validate an unknown value as an AgentMessage, including the type-specific
 * payload. Throws a ZodError on failure.
 */
export function parseAgentMessage(input: unknown): AgentMessage {
  const base = AgentMessageSchema.parse(input);
  const payloadSchema = payloadSchemaByType[base.type];
  const payload = payloadSchema.parse(base.payload);
  return { ...base, payload } as AgentMessage;
}

/** Non-throwing variant. */
export function safeParseAgentMessage(
  input: unknown,
): { success: true; message: AgentMessage } | { success: false; error: z.ZodError } {
  const base = AgentMessageSchema.safeParse(input);
  if (!base.success) return { success: false, error: base.error };
  const payloadResult = payloadSchemaByType[base.data.type].safeParse(base.data.payload);
  if (!payloadResult.success) return { success: false, error: payloadResult.error };
  return {
    success: true,
    message: { ...base.data, payload: payloadResult.data } as AgentMessage,
  };
}
