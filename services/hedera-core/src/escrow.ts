/**
 * EscrowClient — the interface for the settlement + escrow contract (Abdellah).
 *
 * Flow for one job:  fund (consumer pays, funds HELD)  ->  deliver (provider submits the
 * result hash, funds RELEASED)  |  refund (consumer, only after the deadline).
 *
 * `contractJobRef` (PROTOCOL.md `pay` payload) = jobRef(jobId): "0x" + sha256(jobId) hex,
 * i.e. the bytes32 key the contract stores the job under.
 */
import { contractJobRef } from '@agent-market/protocol';

export type EscrowStatus = 'None' | 'Held' | 'Released' | 'Refunded';

export interface EscrowJob {
  consumer: string; // Hedera account id
  provider: string; // Hedera account id
  amount: number;
  deadline: number; // unix seconds
  status: EscrowStatus;
  resultHash: string; // hex, "" until delivered
}

export interface EscrowTxResult {
  txId: string;
  contractJobRef: string;
}

export interface EscrowClient {
  /** Consumer pays into escrow against jobId. Funds are held. Use as the x402 "pay" step. */
  fundJob(jobId: string, consumerId: string, providerId: string, amount: number, deadlineSecs: number): Promise<EscrowTxResult>;
  /** Provider submits the delivery hash; the contract releases the funds to the provider. */
  deliverJob(jobId: string, providerId: string, resultHash: string): Promise<EscrowTxResult>;
  /** Consumer reclaims funds after the deadline if the provider never delivered. */
  refundJob(jobId: string, consumerId: string): Promise<EscrowTxResult>;
  /** Read on-chain job state. Used by the provider to confirm payment before delivering. */
  getJob(jobId: string): Promise<EscrowJob>;
  /** Contract id/address to put in the `offer` payload (`contractAddress`). */
  readonly escrowAddress: string;
}

/** bytes32 key of a job in the contract, as 0x-hex. Same value as protocol's `contractJobRef`. */
export function jobRef(jobId: string): string {
  return contractJobRef(jobId);
}

export const STATUS_NAMES: EscrowStatus[] = ['None', 'Held', 'Released', 'Refunded'];
