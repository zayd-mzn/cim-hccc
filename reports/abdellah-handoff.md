# Chain layer: hand-off (Abdellah) · status: working on Hedera testnet

## What exists (branch `abdellah/hedera-core`)
| Piece | Where | State |
|---|---|---|
| Real `HederaClient` (`SdkHederaClient`) | `services/hedera-core/src/sdk-client.ts` | Verified on testnet: token, topic, accounts, transfer, HCS write, sign/verify |
| `EscrowClient` (real + in-memory) | `services/hedera-core/src/escrow.ts`, `in-memory-escrow.ts` | Verified on testnet (fund -> held -> deliver -> released) |
| `AgentEscrow` contract | `contracts/contracts/AgentEscrow.sol` | Deployed, 6 local tests pass |
| Setup / deploy / spike scripts | `hedera-core/scripts`, `contracts/scripts` | Working |
| Interface doc | `services/hedera-core/README.md` | Written |

## Testnet ids (public; keys live only in `.hedera-state.json`)
- Credits token (HTS, 0 decimals): `0.0.11431744`
- HCS audit topic: `0.0.11431745`
- Escrow contract: `0.0.11431806`
- Accounts: consumer `0.0.11431747` · provider `0.0.11431749` · MCP `0.0.11431750`

## How escrow works
`fundJob` (consumer pays, funds HELD) -> `deliverJob` (provider submits result hash, funds RELEASED)
or `refundJob` (consumer, only after deadline). Provider verifies payment with `getJob(jobId).status === 'Held'`.
`contractJobRef` = `jobRef(jobId)` = `0x` + sha256(jobId).

## Findings worth knowing (de-risked)
- HTS tokens work inside a contract through the ERC20 facade at the token's EVM address.
  Needs: contract associated with token once (`associate()`), consumer allowance before `fund`.
- Contract `msg.sender` = the **tx payer**, so each escrow call is paid by the acting account.
- `AccountBalanceQuery` fails on this SDK version -> balances come from the Mirror Node (3-5 s lag).
- SDK package is `@hiero-ledger/sdk` (renamed `@hashgraph/sdk`); same API.
- Contract bytecode exceeds the tx size cap, so deploy uploads it as a chunked Hedera file.

## What each teammate does next
- **Youssef:** put `contractJobRef` (from `fundJob`) in the `pay` payload; x402 verification = `getJob`
  status `Held`. Reputation can read escrow events (see `hcs-format-for-dashboard.md` §4).
- **Zayd:** swap `InMemoryHederaClient` for `SdkHederaClient.fromEnv(state)`; `offer.contractAddress`
  = `escrow.escrowAddress`, `offer.tokenId` from state.
- **Abdelghafour:** read `hcs-format-for-dashboard.md`.

## Open / not done
- Branch not merged to `main` yet.
- Refund path verified only on local EVM tests, not on testnet.
- Real HTS `associate()` has no local test (precompile exists only on Hedera); covered by the testnet run.
- No retry/backoff in the client; fine for the demo, add if testnet flakes.
- Scope notes (per TRUST-MODEL): server-custodial keys, no dispute resolution, no sybil governance.

## Shared secret handling
`.env` (operator key) and `.hedera-state.json` (agent keys) are gitignored. Share privately. They are
throwaway testnet keys; never reuse them anywhere real.
