# HCS audit format: for the dashboard (and reputation)

Everything on the audit topic is read from the **public Mirror Node**. No agent databases.

- Topic (testnet): `0.0.11431745` (current ids always in `.hedera-state.json`, `topicId`)
- Credits token: `0.0.11431744` · Escrow contract: `0.0.11431806`

## 1. Read the topic

```
GET https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages?limit=100&order=asc
```
Page with `links.next`. Poll every ~2 s for "live", or pass `&sequencenumber=gt:{last}`.
Each item has `consensus_timestamp`, `sequence_number`, and `message` (**base64**).

## 2. Decode a message

`JSON.parse(atob(item.message))` gives an `HcsRecord`:

```json
{
  "message": {
    "type": "request",
    "jobId": "00000000-0000-4000-8000-000000000001",
    "fromAgent": "0.0.11431747",
    "toAgent": "0.0.11431749",
    "timestamp": "2026-11-12T22:22:44.187Z",
    "payload": { "capability": "dataset", "spec": {} },
    "signature": "2acb1ed4…06a17da"
  },
  "contentHash": "5ff6cbe1…f045b"
}
```
(This is a real record: topic `0.0.11431745`, sequence 1.)

- `type` ∈ `request | offer | accept | pay | deliver`: the 5-step timeline of one job.
- Group by `message.jobId`. Order by **`consensus_timestamp` / `sequence_number`** (authoritative).
  `message.timestamp` is sender-claimed; do not use it for ordering.
- Payloads: see `packages/protocol/src/messages.ts` (`offer` has price/tokenId/contractAddress,
  `pay` has amount/txId/contractJobRef, `deliver` has resultHash/resultLocation).
- Import `parseAgentMessage` / `HcsRecordSchema` from `@agent-market/protocol`; do not redefine types.

## 3. Verify (optional, "tamper-proof" demo moment)

- **Hash:** `hasValidContentHash(record)` (protocol): sha256 of the canonical message without `signature`.
- **Signature:** ECDSA(secp256k1) over the 32 raw bytes of `contentHash`, hex-encoded. Public key of
  `fromAgent`: `GET /api/v1/accounts/{fromAgent}` -> `key.key`. `SdkHederaClient.verifyMessage` does this.
  (A browser dashboard may just show "hash OK" and skip signature checks.)

## 4. Escrow state (held -> released)

Escrow is **contract state + events**, not an HCS message. Two ways to show it:
1. Cheap and good enough: on the `pay` message show "HELD"; on the `deliver` message show "RELEASED".
2. Real: Mirror Node contract logs for the escrow contract:
   `GET /api/v1/contracts/{contractId}/results/logs?order=asc`
   Events: `JobFunded(jobId, consumer, provider, amount, deadline)`,
   `JobReleased(jobId, provider, amount, resultHash)`, `JobRefunded(jobId, consumer, amount)`.
   `jobId` here is `0x` + sha256(uuid) = the `contractJobRef` in the `pay` payload.

## 5. Balances (payment settlement view)

`GET /api/v1/accounts/{id}/tokens?token.id={tokenId}` -> `tokens[0].balance` (whole credits, 0 decimals).
Mirror lag is ~3-5 s behind consensus.

## Mock data for the shell

Use the sample record above; a full job is 5 records with the same `jobId`, types in order
request, offer, accept, pay, deliver. Same `HcsRecord` shape for all.
