# CIM · Agent Market — Dashboard

The demo-facing dashboard (Abdelghafour's workstream, Layer 8). React + Vite +
Tailwind, adopting the **CIM** brand/look. It reads **only** from the public
Hedera Mirror Node — never from an agent's database or a backend API. That is
the whole trust model: the dashboard is a *viewer*, not an authority
(TRUST-MODEL.md).

## Run

From the repo root:

```bash
pnpm install
pnpm build            # builds the workspace packages the dashboard imports
pnpm dashboard        # vite dev server on http://localhost:5173
```

Or from here: `pnpm dev`.

By default it reads the **live testnet** topic. Set `VITE_USE_MOCK=1` (in
`.env.local`) for a fully offline demo using a built-in sample job.

## Views

- **Marketplace** — providers + economics derived from the audit log; globe hero.
- **Agent monitor** — the live `request → offer → accept → pay → deliver`
  handshake per job, as signed HCS records land. Each card shows a recomputed
  content-hash badge (the "tamper-proof" moment) and the escrow state.
- **Reputation** — provider scores computed in-browser by `@agent-market/reputation`
  (the same engine the CLI uses). Stateless and replayable.
- **Audit log** — the raw consensus-ordered HCS stream with hash verification.

## Data layer

All reads go through `src/lib/mirror.ts` against the Mirror Node:

| Source | Endpoint | Shown as |
|---|---|---|
| HCS topic `0.0.11431745` | `/topics/{id}/messages` | timeline + audit log |
| AgentEscrow `0.0.11431806` | `/contracts/{id}/results/logs` | escrow held → released/refunded |
| Credits token `0.0.11431744` | `/accounts/{id}/tokens` | settlement balances |

Types (`HcsRecord`, `AgentMessage`, `contentHash`, `isDecisionRecord`) are
imported from `@agent-market/protocol` — never redefined locally.

### node:crypto in the browser

`@agent-market/protocol` hashes with `node:crypto` (it is shared with the Node
services and must not change). Vite aliases `node:crypto` to
`src/lib/node-crypto-shim.ts`, backed by `@noble/hashes` — the same SHA-256, so
content hashes match byte-for-byte.

## Config (`.env.local`, optional)

```
VITE_MIRROR_BASE=https://testnet.mirrornode.hedera.com
VITE_TOPIC_ID=0.0.11431745
VITE_TOKEN_ID=0.0.11431744
VITE_ESCROW_ID=0.0.11431806
VITE_USE_MOCK=        # set to 1 to force offline mock data
```

## Known limitations

- HCS messages larger than one chunk aren't reassembled yet (the current topic
  uses single-chunk records). Multi-chunk support is a follow-up in `mirror.ts`.
- Escrow events decode by the known `AgentEscrow` event signatures; if the
  deployed ABI changes, update `EVENT_TOPIC0` in `mirror.ts`.
