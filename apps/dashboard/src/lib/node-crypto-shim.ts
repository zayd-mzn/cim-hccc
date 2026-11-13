/**
 * Browser shim for the tiny slice of `node:crypto` that @agent-market/protocol
 * uses: `createHash('sha256').update(data).digest('hex')`.
 *
 * The protocol package is Youssef's locked v1 and is shared by Node services
 * (agents, MCP server, reputation CLI) where `node:crypto` is real. We must not
 * change it. Instead, the dashboard's Vite build aliases `node:crypto` to this
 * shim (see vite.config.ts), backed by @noble/hashes — the same SHA-256 the
 * rest of the stack relies on, so content hashes match byte-for-byte.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

type Input = string | Uint8Array;

class Sha256Hash {
  private chunks: Uint8Array[] = [];

  update(data: Input, _encoding?: string): this {
    this.chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
    return this;
  }

  digest(encoding?: "hex"): string {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    const hash = sha256(merged);
    if (encoding === "hex" || encoding === undefined) return bytesToHex(hash);
    throw new Error(`node-crypto-shim: unsupported digest encoding "${encoding}"`);
  }
}

export function createHash(algorithm: string): Sha256Hash {
  if (algorithm !== "sha256") {
    throw new Error(`node-crypto-shim: only sha256 is supported, got "${algorithm}"`);
  }
  return new Sha256Hash();
}

export default { createHash };
