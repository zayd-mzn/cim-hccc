# @agent-market/hedera-core  (owner: Abdellah)

The ONLY package that touches Hedera. Everything else imports from here.

| Export | What it is |
|---|---|
| `HederaClient` | Interface: accounts, credits token, HCS topic, token transfer, sign/verify, balance |
| `EscrowClient` | Interface: `fundJob` / `deliverJob` / `refundJob` / `getJob` / `escrowAddress` |
| `SdkHederaClient` | **Real testnet** implementation of both |
| `InMemoryHederaClient`, `InMemoryEscrowClient` | Offline stubs, same semantics (for tests/local demos) |

## Using the real client
```ts
const state = JSON.parse(readFileSync('.hedera-state.json', 'utf8')); // ask Abdellah (contains keys)
const hedera = SdkHederaClient.fromEnv(state);   // needs OPERATOR_ID / OPERATOR_KEY in .env
```
`.hedera-state.json` holds the token id, topic id, escrow contract id and the custodied keys for
the consumer / provider / MCP accounts. It is gitignored. Never commit it.

## Escrow, per job (the x402 "pay" step)
```
consumer: fundJob(jobId, consumerId, providerId, amount, deadlineSecs)   -> funds HELD
provider: getJob(jobId).status === 'Held'  (verify payment on-chain!)
provider: deliverJob(jobId, providerId, resultHashHex)                  -> funds RELEASED
consumer: refundJob(jobId, consumerId)   only after deadline, if never delivered
```
- `contractJobRef` (PROTOCOL.md `pay` payload) = value returned by the call = `jobRef(jobId)`
  = `0x` + sha256(jobId). Put it in the `pay` message; the provider can recompute it.
- `offer.contractAddress` = `escrow.escrowAddress` (contract id, e.g. `0.0.11431806`);
  `offer.tokenId` = credits token id.
- Amounts are whole credits (token has 0 decimals).
- `deliverJob` must be called by the provider account; `resultHash` = the `deliver` message's `resultHash`.

## Notes
- `balanceOf` reads the Mirror Node: it can lag a transfer by ~5 s. Wait before asserting balances.
- Every state-changing call is paid by the acting account (consumer/provider), not the operator.
  They are funded with 10 HBAR each by `setup:testnet`.
- Testnet scripts: `pnpm --filter @agent-market/hedera-core setup:testnet` (bootstrap, once),
  `smoke:escrow` (full fund -> deliver on testnet).
- Contract source/tests/deploy: `contracts/`.
