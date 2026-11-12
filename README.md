# Agent Market — Agents + MCP (Zayd's workstream)

Node.js + TypeScript monorepo (pnpm workspaces) implementing the **Agents** and
**MCP server** layers of Agent Market, plus the shared seams needed to run them
end-to-end locally without any teammate's code or a Hedera testnet.

> Spec lives in `agent-market/` (planning docs, not part of the build / not pushed).

## What runs today

A full **two-agent settlement + audit loop** runs in-process against stubs:

```
discover_providers → request_service → pay_for_job → get_delivery → log_decision
```

with real token movement, escrow hold→release, and a consensus-ordered HCS audit
log where every message carries a verified content hash.

```bash
pnpm install
pnpm build
pnpm test            # 18 tests across protocol, hedera-core, engine, and the consumer loop
pnpm demo            # in-process two-agent demo + prints the HCS log
pnpm demo:external   # bring-your-own agent: a separate process joins over stdio
pnpm demo:testnet    # same loop, settled on real Hedera testnet (needs secrets, below)
```

### Running on Hedera testnet (`pnpm demo:testnet`)

Wires the real `SdkHederaClient` + `AgentEscrow` contract + HCS topic behind the
same engine/tools. Requires two gitignored files at the repo root (shared
privately by Abdellah — throwaway testnet keys only):

- `.env` — `OPERATOR_ID` / `OPERATOR_KEY`
- `.hedera-state.json` — token/topic/escrow ids + custodial keys (from
  `services/hedera-core/scripts/setup.ts`)

> Needs outbound **gRPC to Hedera consensus nodes** (`*.testnet.hedera.com:50211`).
> Read-only Mirror Node access (HTTPS) is not sufficient to submit transactions —
> environments that firewall gRPC can read balances but cannot run the write path.

### Bring-your-own-agent (Model B)

`pnpm demo:external` runs `services/agents/external-demo` — a standalone agent
that imports **only** the MCP SDK (zero `@agent-market/*` code). It spawns the
MCP server as a subprocess over stdio, discovers the tools dynamically, calls
`register_agent` to get an on-chain identity, and completes a full job. This is
the proof that any MCP-capable agent, built in any framework, can join the
marketplace without importing our code (TRUST-MODEL.md Model B).

## Packages

| Package | Owner | Status |
|---|---|---|
| `packages/protocol` | Youssef | **Provisional** — built from `PROTOCOL.md` so I'm unblocked. Reconcile with Youssef. |
| `services/hedera-core` | Abdellah | **Interface + in-memory stub**. Real `@hashgraph/sdk` impl is Abdellah's. |
| `services/mcp-server` | **Zayd** | Done — 6 MCP tools + marketplace engine + payment seam. |
| `packages/agent-kit` | **Zayd** | Done — provider-agnostic LLM loop + MCP client wiring. |
| `services/agents/provider` | **Zayd** | Done — Data Provider agent (pricing + delivery). |
| `services/agents/consumer` | **Zayd** | Done — Analysis agent (LLM tool-calling loop) + demo. |
| `services/agents/external-demo` | **Zayd** | Done — bring-your-own agent (MCP SDK only) over stdio. |

## Dependency seams (where teammates plug in)

Everything I depend on is behind a single interface with a working stub, so the
real implementations drop in without touching agent/MCP logic:

1. **`packages/protocol` (Youssef)** — I authored a provisional version straight
   from `PROTOCOL.md`. Needs sign-off or replacement. It's the day-1 blocking
   artifact; schema changes are breaking for all of us.
2. **`HederaClient` (Abdellah)** — the interface in `services/hedera-core/src/client.ts`
   is my provisional contract (`createToken`, `createTopic`, `createAccount`,
   `transferToken`, `submitHcsMessage`, `signMessage`, `verifyMessage`). Abdellah's
   real wrapper must satisfy this signature; reconcile there if it differs.
3. **x402 + settlement/escrow contract (Youssef + Abdellah)** — the
   `PaymentGateway` interface in `services/mcp-server/src/payment.ts` is the seam.
   `StubPaymentGateway` simulates `402 → pay → proof` + escrow hold/release/refund.
   Implement the same interface over the real x402 client + contract.
4. **LLM provider (team decision)** — `LlmClient` in `packages/agent-kit/src/llm.ts`
   is provider-agnostic. `MockLlmClient` drives the loop with **no API key** (used
   in CI/tests/demo). Drop in OpenAI/Anthropic/Vercel AI SDK for the live demo.

## Architecture notes

- Only `services/hedera-core` may touch `@hashgraph/sdk` (ARCHITECTURE.md boundary).
- Both agents reach the marketplace **only** through MCP tools — so our own agents
  are exactly as capable as an external bring-your-own agent (Model B).
- The in-memory HCS log (`services/hedera-core/src/hcs-log.ts`) exposes
  `subscribe()` / `history()` / `jobHistory()` the same way the dashboard +
  reputation engine will read Mirror Node — never from agent memory.
