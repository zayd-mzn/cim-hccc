# Agents + MCP: hand-off (Zayd) · status: done, running end-to-end

The agent layer + MCP server are complete and integrated with the chain layer.
This note tells **Youssef** and **Abdelghafour** exactly where their work plugs
into mine. Nothing here blocks you — the seams already exist with working stubs.

## What exists (on `main`)
| Piece | Where | State |
|---|---|---|
| MCP server (6 tools) | `services/mcp-server/src/server.ts` | Done |
| Marketplace engine | `services/mcp-server/src/engine.ts` | Done — drives request→offer→accept→pay→deliver + HCS log |
| Payment seam | `services/mcp-server/src/payment.ts` | Done — stub + real (`EscrowPaymentGateway` over Abdellah's `EscrowClient`) |
| Engine factories | `services/mcp-server/src/sdk-engine.ts` | `createInMemoryEngine()` / `createSdkEngine()` (testnet) |
| Consumer agent | `services/agents/consumer` | Done — LLM tool-calling loop + demos |
| Provider agent | `services/agents/provider` | Done — pricing + delivery |
| External BYO agent | `services/agents/external-demo` | Done — MCP SDK only, over stdio |
| LLM client | `packages/agent-kit` | Mock (no key) + real OpenAI-compatible |

Run it: `pnpm demo` (stub), `pnpm demo:external` (BYO), `pnpm demo:testnet`
(real Hedera, needs gRPC + secrets). 22 tests pass.

## The 6 MCP tools (the integration surface)
`register_agent` · `discover_providers` · `request_service` · `pay_for_job`
· `get_delivery` · `log_decision`. Any MCP-capable agent uses these; our own
agents use nothing else.

---

## Youssef — x402 + reputation

### x402 plugs in at ONE seam: `PaymentGateway` (`services/mcp-server/src/payment.ts`)
The engine only ever calls this interface:
```ts
interface PaymentGateway {
  requirePayment(input: PaymentRequired): PaymentRequired; // build the 402 challenge
  pay(challenge, consumerAccountId): Promise<PaymentProof>; // 402 → pay (escrow hold)
  verify(proof): Promise<boolean>;                          // proof references held funds
  release(jobId, resultHash): Promise<{ txId }>;            // on delivery
  refund(jobId): Promise<{ txId }>;                         // after deadline
}
```
Two implementations already exist: `StubPaymentGateway` (software escrow) and
`EscrowPaymentGateway` (delegates to Abdellah's `EscrowClient` → real
`AgentEscrow` contract). **Your x402 work is the `requirePayment`/`verify` side:**
- `requirePayment` already returns the 402 fields (`amount`, `tokenId`,
  `contractAddress`, `providerAccountId`, `deadline`) — mirror these in your HTTP
  `402 Payment Required` response.
- `verify` already checks escrow status is `Held` via `getJob`. If your x402
  flow adds a proof-of-payment token, verify it here.
- You do **not** need to touch the engine or the tools. If you want x402 to wrap
  the on-chain `fund`, implement a `PaymentGateway` that does the HTTP 402 dance
  and then calls `EscrowClient.fundJob` — inject it via `MarketplaceEngine({ payment })`.

### HTS↔contract plumbing you'll need (from Abdellah's handoff)
`fund` needs: contract associated with the token once (`associate()`), and the
consumer must `approve` an allowance before `fundJob`. The stub hides this; the
real path requires it. See `reports/abdellah-handoff.md`.

### `contractJobRef` format (locked by Abdellah)
`contractJobRef = jobRef(jobId) = "0x" + sha256(jobId)`. Put it in the `pay`
message payload (`PayPayload.contractJobRef`). My `EscrowPaymentGateway` already
uses this via `EscrowClient`.

### Reputation
Read the HCS topic from Mirror Node (never from agent memory). Each record is an
`HcsRecord { message: AgentMessage, contentHash }`. A completed job = the ordered
sequence `request, offer, accept, pay, deliver` for one `jobId`
(`jobHistory(jobId)` on the in-memory log shows the shape). Latency = consensus
timestamp delta between `request` and `deliver`. Escrow release/refund events are
on-chain (`JobReleased` / `JobRefunded`) — see `hcs-format-for-dashboard.md` §4.

---

## Abdelghafour — dashboard

### You read ONLY from Hedera (Mirror Node), never from agent memory
Each HCS message decodes to:
```ts
interface HcsRecord {
  message: AgentMessage;   // type, jobId, fromAgent, toAgent, timestamp, payload, signature
  contentHash: string;     // sha256 hex of canonical(message minus signature)
}
```
`AgentMessage.type` ∈ `request | offer | accept | pay | deliver`. Group by
`jobId` and order by consensus timestamp to render the live timeline:
`request → offer → accept → pay → deliver`.

- **Payloads per type** (what to show on each card): see
  `agent-market/PROTOCOL.md` § Per-type payloads — e.g. `offer` has
  `price`/`tokenId`/`contractAddress`/`expiresAt`; `deliver` has
  `resultHash`/`resultLocation`; `pay` has `amount`/`txId`/`contractJobRef`.
- **Escrow state (held → released/refunded):** from the contract events
  `JobFunded` / `JobReleased` / `JobRefunded` (Mirror Node contract-results), not
  from the HCS messages. See `reports/hcs-format-for-dashboard.md`.
- **Integrity badge:** you can recompute `contentHash` from `message` (import
  `contentHash` from `@agent-market/protocol`) and show ✓ when it matches — this
  is the "tamper-proof" visual.
- **Verifying signatures (optional flex):** `verifyMessage(message)` on the
  Hedera client checks the sender's on-ledger key.

### Testnet ids to point the dashboard at (Abdellah's)
token `0.0.11431744` · topic `0.0.11431745` · escrow `0.0.11431806`. Mirror Node:
`https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.11431745/messages`.
`demo-testnet.ts` has a working `fetchTopicMessages()` you can copy.

---

## Open items (team-level, not mine to close)
- x402 proof-of-payment token shape (Youssef) — the `verify` hook is ready for it.
- Reputation scoring formula (Youssef) — inputs are all on-chain.
- Dashboard escrow-event decoding (Abdelghafour) — format doc'd by Abdellah.
- Live demo needs: a machine with outbound gRPC to `*.testnet.hedera.com:50211`
  (this env only has Mirror Node/HTTPS), plus `OPENAI_API_KEY` for the reasoning
  LLM (optional — mock works without it).
