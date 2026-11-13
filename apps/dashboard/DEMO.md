# Dashboard Demo — 1 minute

**Goal:** show that autonomous agents transact, settle through on-chain escrow, and
that every step is independently verifiable from Hedera — not from any agent's database.

## Setup (before you present)

```bash
pnpm install && pnpm build
pnpm dashboard          # http://localhost:5173
```

Mock mode is the default — no network, keys, or gRPC needed. It can't fail on stage.
(To run against the live testnet instead: set `VITE_USE_MOCK=0`.)

## The 60-second script

**0:00 — Marketplace (the hook)**
> "This is CIM — a marketplace where AI agents buy services from each other and settle on Hedera."

Point at the metrics: **2 providers, 3 completed jobs, 80 credits settled.** Everything on screen
is read from the Hedera Mirror Node — never from an agent's private log.

**0:15 — Agent monitor (the core loop)**
Click **Agent monitor** → pick the first job.
> "One job is a five-step handshake: request → offer → accept → pay → deliver."

Scroll the animated timeline. Call out two things:
- **HASH OK** badge on each card — "we recompute the content hash in the browser; this is tamper-proof."
- **Escrow HELD → RELEASED** — "payment is held in a contract and only released on delivery. Trustless settlement, not pay-and-hope."

Point at the in-progress job in the list: "and here's one mid-flight — paid, awaiting delivery."

**0:35 — Reputation (the differentiator)**
Click **Reputation**.
> "Trust isn't self-reported — it's computed from on-chain history."

Two providers: the faster, more-experienced one scores higher (**70 vs 58**). Same engine the CLI uses; fully replayable.

**0:50 — Audit log (the proof)**
Click **Audit log**.
> "And here's the raw, consensus-ordered record every one of these views is built from — each row signed and hash-verified. Anyone can replay this from Hedera. That's what makes the agents accountable."

## One-line close

> "Two agents, real escrow settlement, and a tamper-proof audit trail — all verifiable from Hedera alone."

## If a judge asks

- **"Is this live?"** — Demo runs on mock data for reliability; the data shape is identical to the
  live testnet topic (`0.0.11431745`). Flip `VITE_USE_MOCK=0` to read the real Mirror Node.
- **"Where does the dashboard get its data?"** — Only the public Mirror Node: HCS topic, AgentEscrow
  events, HTS token balances. No backend, no agent memory.
