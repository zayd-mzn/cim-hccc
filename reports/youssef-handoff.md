# Protocol + x402 + Reputation: hand-off (Youssef) · status: done locally, reputation verified on testnet Mirror Node

My three pieces are in. Nothing in the agent, MCP or chain layers had to change shape;
the integration points are the seams Zayd and Abdellah already defined.

## What exists (branch `youssef/x402-reputation`)
| Piece | Where | State |
|---|---|---|
| Protocol schema v1 | `packages/protocol` | **Signed off.** Zayd's draft kept as-is + `refs.ts` |
| x402 package | `packages/x402` | Done: wire format, HTTP guard, paying client, verifier |
| `X402PaymentGateway` | `services/mcp-server/src/x402-gateway.ts` | Done: drop-in for the `PaymentGateway` seam |
| Reputation engine | `services/reputation` | Done: replayable scores from HCS + escrow events, CLI |

Run: `pnpm test` (52 tests) · `pnpm demo:x402` (real HTTP 402 → pay → 200) ·
`pnpm reputation` (live scores from the testnet Mirror Node, read-only, no keys).

---

## 1. Protocol: locked v1
- No field changes. The schema Zayd drafted from `PROTOCOL.md` is now the official v1.
- Added to `@agent-market/protocol` (import these, don't re-derive):
  - `contractJobRef(jobId)` = `"0x" + sha256(jobId)`: the AgentEscrow key. hedera-core's `jobRef` now delegates to it.
  - `isDecisionRecord(message)`: `log_decision` writes a `deliver`-shaped self-addressed record
    (`resultLocation: "decision:<jobId>"`). **Dashboard: skip these in the timeline**, or a decision looks like a delivery.
  - `SENDER_ROLE`: which side sends each step (consumer: request/accept/pay; provider: offer/deliver).
- PROTOCOL.md open items, closed:
  - `contractJobRef` format → as above (Abdellah's).
  - Signature scheme → ECDSA over the 32-byte `contentHash` via the hedera-core wrapper (Abdellah's).
  - `resultLocation` transport → opaque string, agent-to-agent (today `mem://datasets/<jobId>`); only `resultHash` is authoritative. No schema change needed if it becomes an HTTP URL.

## 2. x402 (`packages/x402`)
Scheme `hedera-escrow`, x402 v1 shape:
- **402 body**: `{ x402Version: 1, error, accepts: [PaymentRequirements] }`, mirroring the `offer`:
  `maxAmountRequired`, `asset` (token id), `payTo` (provider), `extra: { jobId, contractAddress, contractJobRef, deadline }`.
- **`X-PAYMENT` header** (base64 JSON): carries the **signed protocol `pay` message**. The x402 proof and the
  HCS audit record are the same signed object.
- **`X-PAYMENT-RESPONSE` header**: `{ success, jobId, txId, payer }`.
- **Verifier** accepts only if: right job, right provider, right escrow slot, amount ≥ price, valid signature,
  **and on-chain escrow is `Held`** for that consumer → provider, amount and deadline.

Using it:
```ts
// Provider (node:http / Express raw handler)
createServer(withX402({ escrow, verifySignature: (m) => hedera.verifyMessage(m), requirements: lookupOffer }, serveResult));
// Consumer
const pay = createEscrowPayer({ payer: consumerId, escrow, sign: (a, m) => hedera.signMessage(a, m), maxAmount: 50 });
const { response } = await fetchWithX402(url, {}, { pay });
```

**Zayd:** `X402PaymentGateway` is a drop-in for the `PaymentGateway` seam (it extends `EscrowPaymentGateway`; release/refund unchanged).
Opt in with `createInMemoryEngine({ useX402: true })` / `createSdkEngine({ repoRoot, useX402: true })`. Defaults are unchanged.
I'd make it the testnet default once someone with gRPC access runs `demo:testnet` with it.

Small fixes in shared code (please sanity-check):
- `StubPaymentGateway` used `contractJobRef = "<addr>#<jobId>"`; it now uses the real `0x+sha256` key, so stub and testnet `pay` records match.
- `EscrowPaymentGateway.verify` now also checks the proof's `contractJobRef` is this job's slot (before, any held escrow of the same amount passed).
- `PaymentProof` gained an optional `x402?: string`; `EscrowPaymentGateway`'s `contexts`/`escrow` are now `protected`.

## 3. Reputation (`services/reputation`)
Reads **only** Hedera: the HCS topic + AgentEscrow `JobFunded/JobReleased/JobRefunded` logs (Mirror Node).
Stateless: every `compute()` replays the full history, so anyone can recompute and audit a score.

**Validation:** a record counts only if its schema, `contentHash`, signature (when a verifier is given),
handshake order, sender/recipient roles and consistency checks all pass. The consistency checks are
accepted price = offered price, paid amount ≥ price, and `pay.contractJobRef` = the job's escrow slot.
Otherwise it is an **anomaly against its sender**, so an agent can't forge a completed job.

**Outcomes:** `completed` (delivered) · `refunded` (escrow event) · `expired` (paid, undelivered, past deadline)
· `in-progress` · `abandoned` (stopped before paying: not the provider's fault, not scored).

**Score (0–100):**
```
100 × (0.60·reliability + 0.25·speed + 0.15·experience) × (1 − 0.15·anomalies)
reliability = (completed + 1) / (completed + refunded + expired + 2)    Beta(1,1) prior
speed       = 1 / (1 + medianLatency / 30s)       latency = request → deliver, consensus time
experience  = 1 − e^(−completed / 5)
```
All weights are in `DEFAULT_CONFIG` and can be tuned per call.

**Abdelghafour:** `computeReputation({ entries, escrowEvents })` returns `providers[]` with `score`,
`completed`, `medianLatencyMs`, `volume`, plus `jobs[]` (outcome + escrow state per job) and `anomalies[]`,
ready to render. `MirrorNodeClient` already pages the topic and decodes escrow logs (`decodeEscrowLog`).

## Open / next
- Signature checks need a verifier: `ReputationEngine({ verifySignature })`. The CLI runs without one
  (the hash is still checked). On testnet, pass `SdkHederaClient.verifyMessage`.
- Escrow events are matched to jobs by `contractJobRef`. Escrow-only jobs (the smoke tests) have no HCS trace and are ignored.
- Proposed (needs Zayd): a `get_reputation` MCP tool, and `discover_providers` sorted by score.
- The `X402PaymentGateway` testnet path is untested here (no gRPC from this machine). The verifier logic is
  identical to the local path; `SdkHederaClient.getJob` returns plain account ids, which it compares.
