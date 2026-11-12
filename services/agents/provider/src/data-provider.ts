/**
 * Provider/Data agent.
 *
 * Offers a dataset capability. Its "agent decisions" are:
 *   - quote(): price the request (here: base price + a size-based component)
 *   - deliver(): produce the dataset + its authoritative hash
 *
 * It implements the engine's ProviderConnector so the MarketplaceEngine can ask
 * it for offers and deliveries during the handshake. The delivered data is
 * passed agent-to-agent; only its hash is authoritative on-chain (PROTOCOL.md).
 */
import { sha256Hex } from '@agent-market/protocol';
import type { ProviderConnector } from '@agent-market/mcp-server';
import type { ProviderProfile } from '@agent-market/mcp-server';

export interface DataProviderOptions {
  providerId?: string;
  name?: string;
  /** Credits charged regardless of size. */
  basePrice?: number;
  /** Extra credits per requested row (size-based pricing). */
  pricePerRow?: number;
  tokenId: string;
  /** Offer validity window in ms. Default 60s. */
  offerTtlMs?: number;
  /** Produces the dataset payload for a given spec. Default: synthetic rows. */
  generate?: (spec: Record<string, unknown>) => string;
}

export class DataProviderAgent implements ProviderConnector {
  readonly providerId: string;
  readonly profile: ProviderProfile;
  private readonly basePrice: number;
  private readonly pricePerRow: number;
  private readonly offerTtlMs: number;
  private readonly generate: (spec: Record<string, unknown>) => string;

  constructor(opts: DataProviderOptions) {
    this.providerId = opts.providerId ?? 'data-provider';
    this.basePrice = opts.basePrice ?? 10;
    this.pricePerRow = opts.pricePerRow ?? 0.1;
    this.offerTtlMs = opts.offerTtlMs ?? 60_000;
    this.generate = opts.generate ?? defaultGenerate;
    this.profile = {
      providerId: this.providerId,
      name: opts.name ?? 'Data Provider',
      capabilities: ['dataset'],
      basePrice: this.basePrice,
      tokenId: opts.tokenId,
    };
  }

  /** Decide a price for this request. */
  async quote(input: {
    jobId: string;
    capability: string;
    spec: Record<string, unknown>;
  }): Promise<{ price: number; expiresAt: string }> {
    const rows = typeof input.spec.rows === 'number' ? input.spec.rows : 0;
    const price = Math.round((this.basePrice + rows * this.pricePerRow) * 100) / 100;
    return { price, expiresAt: new Date(Date.now() + this.offerTtlMs).toISOString() };
  }

  /** Produce the deliverable + its hash once payment is confirmed. */
  async deliver(input: {
    jobId: string;
    spec: Record<string, unknown>;
  }): Promise<{ resultHash: string; resultLocation: string }> {
    const data = this.generate(input.spec);
    return {
      resultHash: sha256Hex(data),
      // In the PoC data is handed over off-chain; location is a reference only.
      resultLocation: `mem://datasets/${input.jobId}`,
    };
  }
}

function defaultGenerate(spec: Record<string, unknown>): string {
  const rows = typeof spec.rows === 'number' ? spec.rows : 3;
  const cols = Array.isArray(spec.columns) ? (spec.columns as string[]) : ['id', 'value'];
  const header = cols.join(',');
  const body = Array.from({ length: rows }, (_, i) =>
    cols.map((c) => `${c}${i}`).join(','),
  ).join('\n');
  return `${header}\n${body}`;
}
