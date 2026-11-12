/**
 * Provider registry — backs the `discover_providers` MCP tool.
 *
 * For the PoC this is an in-memory capability directory. In Model B (user-
 * connected agents, TRUST-MODEL.md) an agent would register its capability
 * profile here on connect. Sybil-resistant registration governance is explicitly
 * future work (TRUST-MODEL.md § Known gaps).
 */

export interface ProviderProfile {
  /** Stable provider id (also its Hedera account id for the PoC). */
  providerId: string;
  /** Human-friendly name, e.g. "Data Provider". */
  name: string;
  /** Capabilities this provider offers, e.g. ["dataset", "translation"]. */
  capabilities: string[];
  /** Advertised base price in credits (providers may still quote per-request). */
  basePrice: number;
  /** HTS token the provider prices in. */
  tokenId: string;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderProfile>();

  register(profile: ProviderProfile): void {
    this.providers.set(profile.providerId, profile);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  get(providerId: string): ProviderProfile | undefined {
    return this.providers.get(providerId);
  }

  all(): ProviderProfile[] {
    return [...this.providers.values()];
  }

  /** Providers advertising a given capability (case-insensitive). */
  findByCapability(capability: string): ProviderProfile[] {
    const needle = capability.toLowerCase();
    return this.all().filter((p) =>
      p.capabilities.some((c) => c.toLowerCase() === needle),
    );
  }
}
