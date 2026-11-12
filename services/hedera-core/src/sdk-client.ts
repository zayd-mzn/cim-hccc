/**
 * SdkHederaClient — the real, testnet-backed HederaClient (Abdellah).
 *
 * Implements the interface in client.ts. This is the ONLY file that imports the
 * Hedera SDK (@hiero-ledger/sdk is the renamed @hashgraph/sdk).
 *
 * Keys are custodied here (server-custodial PoC): the wrapper holds a private key per
 * account it created, plus the operator. Accounts are ECDSA (EVM-compatible).
 * Signing: ECDSA over the 32 raw bytes of contentHash(message) (sha256, from protocol).
 */
import {
  AccountAllowanceApproveTransaction,
  AccountCreateTransaction,
  ContractCallQuery,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  PublicKey,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransactionId,
  TransferTransaction,
} from '@hiero-ledger/sdk';
import { contentHash, toHcsRecord, type AgentMessage } from '@agent-market/protocol';
import { jobRef, STATUS_NAMES, type EscrowClient, type EscrowJob, type EscrowTxResult } from './escrow.js';
import type {
  HederaAccount,
  HederaClient,
  HcsSubmitResult,
  TokenTransferResult,
} from './client.js';

/** Serializable state so keys/ids survive between runs (persist OUTSIDE git). */
export interface SdkClientState {
  tokenId?: string;
  topicId?: string;
  escrow?: { contractId: string };
  /** accountId -> DER private key */
  keys: Record<string, string>;
}

const MIRROR = 'https://testnet.mirrornode.hedera.com';

export class SdkHederaClient implements HederaClient, EscrowClient {
  private readonly client: Client;
  private readonly operatorId: string;
  private readonly keys = new Map<string, PrivateKey>();
  tokenId?: string;
  topicId?: string;
  escrowContractId?: string;

  constructor(operatorId: string, operatorKeyDer: string, state?: SdkClientState) {
    this.operatorId = operatorId;
    const opKey = PrivateKey.fromStringDer(operatorKeyDer);
    this.client = Client.forTestnet();
    this.client.setOperator(AccountId.fromString(operatorId), opKey);
    this.client.setDefaultMaxTransactionFee(new Hbar(20));
    this.keys.set(operatorId, opKey);
    if (state) {
      this.tokenId = state.tokenId;
      this.topicId = state.topicId;
      this.escrowContractId = state.escrow?.contractId;
      for (const [id, der] of Object.entries(state.keys)) {
        this.keys.set(id, PrivateKey.fromStringDer(der));
      }
    }
  }

  static fromEnv(state?: SdkClientState): SdkHederaClient {
    const id = process.env.OPERATOR_ID;
    const key = process.env.OPERATOR_KEY;
    if (!id || !key) throw new Error('OPERATOR_ID and OPERATOR_KEY must be set');
    return new SdkHederaClient(id, key, state);
  }

  exportState(): SdkClientState {
    const keys: Record<string, string> = {};
    for (const [id, k] of this.keys) if (id !== this.operatorId) keys[id] = k.toStringDer();
    return {
      tokenId: this.tokenId,
      topicId: this.topicId,
      escrow: this.escrowContractId ? { contractId: this.escrowContractId } : undefined,
      keys,
    };
  }

  /** Credits token: whole units (0 decimals) so amounts equal what agents see. Operator = treasury. */
  async createToken(name = 'Agent Credits', symbol = 'ACR'): Promise<{ tokenId: string }> {
    const opKey = this.keyOf(this.operatorId);
    const res = await new TokenCreateTransaction()
      .setTokenName(name)
      .setTokenSymbol(symbol)
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(0)
      .setInitialSupply(1_000_000)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(this.operatorId)
      .setSupplyKey(opKey.publicKey)
      .setAdminKey(opKey.publicKey)
      .execute(this.client);
    const receipt = await res.getReceipt(this.client);
    this.tokenId = receipt.tokenId!.toString();
    return { tokenId: this.tokenId };
  }

  /** No submit key: every agent writes its own signed message; the signature is the authority. */
  async createTopic(memo = 'agent-market-audit'): Promise<{ topicId: string }> {
    const res = await new TopicCreateTransaction()
      .setTopicMemo(memo)
      .setAdminKey(this.keyOf(this.operatorId).publicKey)
      .execute(this.client);
    const receipt = await res.getReceipt(this.client);
    this.topicId = receipt.topicId!.toString();
    return { topicId: this.topicId };
  }

  /** New ECDSA account, auto-associates any token (no manual association step). */
  async createAccount(_label = 'agent'): Promise<HederaAccount> {
    void _label;
    const key = PrivateKey.generateECDSA();
    const res = await new AccountCreateTransaction()
      .setKeyWithoutAlias(key.publicKey)
      .setInitialBalance(new Hbar(10))
      .setMaxAutomaticTokenAssociations(-1)
      .execute(this.client);
    const accountId = (await res.getReceipt(this.client)).accountId!.toString();
    this.keys.set(accountId, key);
    return { accountId, publicKey: key.publicKey.toStringRaw() };
  }

  async transferToken(from: string, to: string, amount: number): Promise<TokenTransferResult> {
    if (!this.tokenId) throw new Error('credits token not created yet');
    if (amount < 0) throw new Error('transfer amount must be non-negative');
    const signed = await new TransferTransaction()
      .addTokenTransfer(this.tokenId, from, -amount)
      .addTokenTransfer(this.tokenId, to, amount)
      .freezeWith(this.client)
      .sign(this.keyOf(from));
    const res = await signed.execute(this.client);
    await res.getReceipt(this.client);
    return { txId: res.transactionId.toString(), tokenId: this.tokenId, from, to, amount };
  }

  async submitHcsMessage(topicId: string, message: AgentMessage): Promise<HcsSubmitResult> {
    const signed: AgentMessage = message.signature
      ? message
      : { ...message, signature: await this.signMessage(message.fromAgent, message) };
    const record = toHcsRecord(signed);
    const res = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(record))
      .execute(this.client);
    const receipt = await res.getReceipt(this.client);
    // Authoritative consensus timestamp comes from the record; the transaction id is a
    // stable fallback until the mirror node has it.
    const rec = await res.getRecord(this.client);
    return {
      topicId,
      consensusTimestamp: rec.consensusTimestamp.toString(),
      sequenceNumber: Number(receipt.topicSequenceNumber ?? 0),
      record,
    };
  }

  async signMessage(accountId: string, message: AgentMessage): Promise<string> {
    const sig = this.keyOf(accountId).sign(Buffer.from(contentHash(message), 'hex'));
    return Buffer.from(sig).toString('hex');
  }

  /** Verifies against the sender's on-ledger key (mirror node), so it works for any account. */
  async verifyMessage(message: AgentMessage): Promise<boolean> {
    try {
      const pub = await this.publicKeyOf(message.fromAgent);
      return pub.verify(
        Buffer.from(contentHash(message), 'hex'),
        Buffer.from(message.signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /** Mirror Node read (consensus-final, but may lag the latest transfer by a few seconds). */
  async balanceOf(accountId: string): Promise<number> {
    if (!this.tokenId) return 0;
    const r = await fetch(`${MIRROR}/api/v1/accounts/${accountId}/tokens?token.id=${this.tokenId}`);
    if (!r.ok) throw new Error(`mirror node ${r.status}`);
    const j = (await r.json()) as { tokens?: { token_id: string; balance: number }[] };
    return j.tokens?.find((t) => t.token_id === this.tokenId)?.balance ?? 0;
  }

  // ------------------------------------------------------------------ escrow

  get escrowAddress(): string {
    return this.escrowContractId ?? '';
  }

  /** Consumer approves the contract to pull `amount` credits, then funds the job (held in escrow). */
  async fundJob(jobId: string, consumerId: string, providerId: string, amount: number, deadlineSecs: number): Promise<EscrowTxResult> {
    const contract = this.escrow();
    const consumerKey = this.keyOf(consumerId);
    const allowance = await new AccountAllowanceApproveTransaction()
      .approveTokenAllowance(this.tokenId!, consumerId, contract.toString(), amount)
      .freezeWith(this.client)
      .sign(consumerKey);
    await (await allowance.execute(this.client)).getReceipt(this.client);

    return this.call('fund', consumerId, new ContractFunctionParameters()
      .addBytes32(this.ref(jobId))
      .addAddress(evm(providerId))
      .addUint256(amount)
      .addUint64(deadlineSecs), jobId);
  }

  /** Provider submits the delivery hash; contract releases the funds to the provider. */
  async deliverJob(jobId: string, providerId: string, resultHash: string): Promise<EscrowTxResult> {
    const hash = Buffer.from(resultHash.replace(/^0x/, '').padStart(64, '0'), 'hex');
    return this.call('deliver', providerId, new ContractFunctionParameters()
      .addBytes32(this.ref(jobId))
      .addBytes32(hash), jobId);
  }

  async refundJob(jobId: string, consumerId: string): Promise<EscrowTxResult> {
    return this.call('refund', consumerId, new ContractFunctionParameters().addBytes32(this.ref(jobId)), jobId);
  }

  async getJob(jobId: string): Promise<EscrowJob> {
    const r = await new ContractCallQuery()
      .setContractId(this.escrow())
      .setGas(200_000)
      .setFunction('jobs', new ContractFunctionParameters().addBytes32(this.ref(jobId)))
      .execute(this.client);
    return {
      consumer: fromEvm(r.getAddress(0)),
      provider: fromEvm(r.getAddress(1)),
      amount: r.getUint256(2).toNumber(),
      deadline: r.getUint64(3).toNumber(),
      status: STATUS_NAMES[r.getUint8(4)] ?? 'None',
      resultHash: Buffer.from(r.getBytes32(5)).toString('hex').replace(/^0+$/, ''),
    };
  }

  private escrow(): ContractId {
    if (!this.escrowContractId) throw new Error('escrow contract not deployed (no escrow.contractId in state)');
    return ContractId.fromString(this.escrowContractId);
  }

  private ref(jobId: string): Uint8Array {
    return Buffer.from(jobRef(jobId).slice(2), 'hex');
  }

  /** Executes a contract call AS `accountId` (msg.sender = that account). */
  private async call(fn: string, accountId: string, params: ContractFunctionParameters, jobId: string): Promise<EscrowTxResult> {
    const tx = await new ContractExecuteTransaction()
      .setContractId(this.escrow())
      .setGas(1_000_000)
      .setFunction(fn, params)
      // msg.sender in the contract is the tx PAYER, so the acting account must pay.
      .setTransactionId(TransactionId.generate(accountId))
      .freezeWith(this.client)
      .sign(this.keyOf(accountId));
    const res = await tx.execute(this.client);
    await res.getReceipt(this.client);
    return { txId: res.transactionId.toString(), contractJobRef: jobRef(jobId) };
  }

  close(): void {
    this.client.close();
  }

  private keyOf(accountId: string): PrivateKey {
    const k = this.keys.get(accountId);
    if (!k) throw new Error(`no custodied key for account ${accountId}`);
    return k;
  }

  private async publicKeyOf(accountId: string): Promise<PublicKey> {
    const local = this.keys.get(accountId);
    if (local) return local.publicKey;
    const r = await fetch(`${MIRROR}/api/v1/accounts/${accountId}`);
    if (!r.ok) throw new Error(`mirror node ${r.status}`);
    const j = (await r.json()) as { key: { _type: string; key: string } };
    return j.key._type.startsWith('ED25519')
      ? PublicKey.fromStringED25519(j.key.key)
      : PublicKey.fromStringECDSA(j.key.key);
  }
}

/** Long-zero EVM address for a 0.0.N entity (accounts here have no alias). */
function evm(id: string): string {
  return '0x' + BigInt(id.split('.')[2]!).toString(16).padStart(40, '0');
}

/** Inverse of evm(): contract returns long-zero addresses for our accounts. */
function fromEvm(addr: string): string {
  return `0.0.${BigInt('0x' + addr.replace(/^0x/, '')).toString()}`;
}
