import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Hbar, PrivateKey } from '@hiero-ledger/sdk';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: resolve(root, '.env') });
export const statePath = resolve(root, '.hedera-state.json');
export const loadState = () => JSON.parse(readFileSync(statePath, 'utf8'));
export const saveState = (s: unknown) => writeFileSync(statePath, JSON.stringify(s, null, 2));

/** A client that acts AS the given account (msg.sender in the contract = that account). */
export function clientFor(accountId: string, keyDer: string): Client {
  const c = Client.forTestnet();
  c.setOperator(accountId, PrivateKey.fromStringDer(keyDer));
  c.setDefaultMaxTransactionFee(new Hbar(20));
  return c;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mirrorTokenBalance(account: string, tokenId: string): Promise<number> {
  const r = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${account}/tokens?token.id=${tokenId}`);
  const j = (await r.json()) as { tokens?: { token_id: string; balance: number }[] };
  return j.tokens?.find((t) => t.token_id === tokenId)?.balance ?? 0;
}

/** Long-zero EVM address of any 0.0.N entity (token, account without alias, contract). */
export const toEvm = (id: string): string => '0x' + BigInt(id.split('.')[2]!).toString(16).padStart(40, '0');
