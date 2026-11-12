/**
 * In-memory EscrowClient: same semantics as the AgentEscrow contract, no network.
 * Moves balances on the InMemoryHederaClient so escrow math is real in local runs.
 */
import { STATUS_NAMES, jobRef, type EscrowClient, type EscrowJob, type EscrowTxResult } from './escrow.js';
import type { InMemoryHederaClient } from './in-memory-client.js';

export class InMemoryEscrowClient implements EscrowClient {
  readonly escrowAddress = '0.0.999999';
  private readonly jobs = new Map<string, EscrowJob>();
  private now: () => number;

  constructor(private readonly hedera: InMemoryHederaClient, now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.now = now;
  }

  private tx(jobId: string): EscrowTxResult {
    return { txId: `mem-${this.jobs.size}-${Date.now()}`, contractJobRef: jobRef(jobId) };
  }

  async fundJob(jobId: string, consumerId: string, providerId: string, amount: number, deadlineSecs: number): Promise<EscrowTxResult> {
    if (this.jobs.has(jobId)) throw new Error('job exists');
    if (amount <= 0) throw new Error('amount=0');
    if (providerId === consumerId) throw new Error('bad provider');
    if (deadlineSecs <= this.now()) throw new Error('deadline in past');
    await this.hedera.transferToken(consumerId, this.escrowAddress, amount);
    this.jobs.set(jobId, { consumer: consumerId, provider: providerId, amount, deadline: deadlineSecs, status: 'Held', resultHash: '' });
    return this.tx(jobId);
  }

  async deliverJob(jobId: string, providerId: string, resultHash: string): Promise<EscrowTxResult> {
    const j = this.held(jobId);
    if (providerId !== j.provider) throw new Error('only provider');
    if (!resultHash) throw new Error('empty hash');
    await this.hedera.transferToken(this.escrowAddress, j.provider, j.amount);
    j.status = 'Released';
    j.resultHash = resultHash.replace(/^0x/, '');
    return this.tx(jobId);
  }

  async refundJob(jobId: string, consumerId: string): Promise<EscrowTxResult> {
    const j = this.held(jobId);
    if (consumerId !== j.consumer) throw new Error('only consumer');
    if (this.now() <= j.deadline) throw new Error('deadline not passed');
    await this.hedera.transferToken(this.escrowAddress, j.consumer, j.amount);
    j.status = 'Refunded';
    return this.tx(jobId);
  }

  async getJob(jobId: string): Promise<EscrowJob> {
    return this.jobs.get(jobId) ?? { consumer: '', provider: '', amount: 0, deadline: 0, status: STATUS_NAMES[0]!, resultHash: '' };
  }

  private held(jobId: string): EscrowJob {
    const j = this.jobs.get(jobId);
    if (!j || j.status !== 'Held') throw new Error('not held');
    return j;
  }
}
