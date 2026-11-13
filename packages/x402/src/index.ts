/**
 * @agent-market/x402 — HTTP 402 Payment Required over Hedera escrow (Youssef).
 *
 *   Provider:  withX402(...)            → answers 402 until a valid proof arrives
 *   Consumer:  fetchWithX402(...)       → 402 → pay → retry with X-PAYMENT
 *              createEscrowPayer(...)   → funds AgentEscrow + signs the `pay` message
 *   Both:      verifyPayment(...)       → the checks a proof must pass
 *
 * The proof is the protocol's signed `pay` message, so the x402 proof and the
 * HCS audit record are one and the same.
 */
export * from './wire.js';
export * from './requirements.js';
export * from './verifier.js';
export * from './payer.js';
export * from './server.js';
export * from './client.js';
