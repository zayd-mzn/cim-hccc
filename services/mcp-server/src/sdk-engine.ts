/**
 * Engine factories — wire a MarketplaceEngine against either the in-memory stub
 * or the real Hedera testnet, behind one API.
 *
 *   createInMemoryEngine() — no network, no secrets; used by demo/tests/CI.
 *   createSdkEngine()      — real SdkHederaClient + AgentEscrow on testnet,
 *                            configured from .env + .hedera-state.json.
 *
 * The engine, tools, and agents are identical across both; only the injected
 * HederaClient + PaymentGateway differ.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  InMemoryEscrowClient,
  InMemoryHederaClient,
  SdkHederaClient,
  type SdkClientState,
} from '@agent-market/hedera-core';
import { MarketplaceEngine } from './engine.js';
import { EscrowPaymentGateway, StubPaymentGateway, type PaymentGateway } from './payment.js';
import { X402PaymentGateway } from './x402-gateway.js';

export interface InMemoryEngineResult {
  engine: MarketplaceEngine;
  hedera: InMemoryHederaClient;
  topicId: string;
  tokenId: string;
}

/**
 * Fully local engine. Uses the in-memory Hedera stub + the in-memory escrow
 * client (real balance movement, no network). Optionally routes payment through
 * the EscrowPaymentGateway so the local path exercises the same code as testnet.
 */
export async function createInMemoryEngine(options: {
  useEscrowGateway?: boolean;
  /** Route payment through x402 (402 → escrow fund → signed proof → verify). */
  useX402?: boolean;
} = {}): Promise<InMemoryEngineResult> {
  const hedera = new InMemoryHederaClient();
  const { topicId } = await hedera.createTopic();
  const { tokenId } = await hedera.createToken();
  let payment: PaymentGateway;
  if (options.useX402) payment = new X402PaymentGateway(new InMemoryEscrowClient(hedera), hedera);
  else if (options.useEscrowGateway) payment = new EscrowPaymentGateway(new InMemoryEscrowClient(hedera));
  else payment = new StubPaymentGateway(hedera);
  const engine = new MarketplaceEngine({ hedera, topicId, tokenId, payment });
  return { engine, hedera, topicId, tokenId };
}

export interface SdkEngineResult {
  engine: MarketplaceEngine;
  hedera: SdkHederaClient;
  topicId: string;
  tokenId: string;
  state: SdkClientState & {
    tokenId: string;
    topicId: string;
    consumer: { accountId: string };
    provider: { accountId: string };
    mcp: { accountId: string };
  };
}

/** Shape of .hedera-state.json produced by hedera-core/scripts/setup.ts. */
interface HederaStateFile extends SdkClientState {
  tokenId: string;
  topicId: string;
  consumer: { accountId: string; publicKey: string };
  provider: { accountId: string; publicKey: string };
  mcp: { accountId: string; publicKey: string };
}

/**
 * Real testnet engine. Reads OPERATOR_ID/OPERATOR_KEY from the environment
 * (load .env before calling) and ids/keys from .hedera-state.json at `repoRoot`.
 *
 * Does NOT create a token/topic — it reuses the ones Abdellah's setup provisioned.
 * Provider/consumer accounts come from the state file.
 */
export async function createSdkEngine(options: {
  repoRoot: string;
  /** Verify payments with the full x402 checks (signed proof + on-chain escrow). */
  useX402?: boolean;
}): Promise<SdkEngineResult> {
  const statePath = resolve(options.repoRoot, '.hedera-state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as HederaStateFile;

  const hedera = SdkHederaClient.fromEnv(state);
  // The client learns token/topic/escrow + custodied keys from the state.
  hedera.tokenId = state.tokenId;
  hedera.topicId = state.topicId;

  const payment = options.useX402
    ? new X402PaymentGateway(hedera, hedera)
    : new EscrowPaymentGateway(hedera);
  const engine = new MarketplaceEngine({
    hedera,
    topicId: state.topicId,
    tokenId: state.tokenId,
    payment,
  });

  return { engine, hedera, topicId: state.topicId, tokenId: state.tokenId, state };
}
