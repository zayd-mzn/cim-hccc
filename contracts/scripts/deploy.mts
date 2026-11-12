/** Deploys AgentEscrow to testnet, associates it with the credits token, saves contractId to state. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ContractCreateTransaction, ContractExecuteTransaction, ContractFunctionParameters,
  FileAppendTransaction, FileCreateTransaction,
} from '@hiero-ledger/sdk';
import { clientFor, loadState, saveState, root, toEvm } from './common.mjs';

const state = loadState();
const client = clientFor(process.env.OPERATOR_ID!, process.env.OPERATOR_KEY!);
try {
  const artifact = JSON.parse(readFileSync(resolve(root, 'contracts/artifacts/contracts/AgentEscrow.sol/AgentEscrow.json'), 'utf8'));
  const bytecode: string = artifact.bytecode.replace(/^0x/, '');

  // Tx size is capped (~6 KB): upload bytecode as a file in chunks.
  const CHUNK = 4000;
  const first = await new FileCreateTransaction().setKeys([client.operatorPublicKey!]).setContents(bytecode.slice(0, CHUNK)).execute(client);
  const fileId = (await first.getReceipt(client)).fileId!;
  for (let i = CHUNK; i < bytecode.length; i += CHUNK) {
    await (await new FileAppendTransaction().setFileId(fileId).setContents(bytecode.slice(i, i + CHUNK)).execute(client)).getReceipt(client);
  }

  const tokenEvm = toEvm(state.tokenId);
  const create = await new ContractCreateTransaction()
    .setBytecodeFileId(fileId)
    .setGas(1_500_000)
    .setConstructorParameters(new ContractFunctionParameters().addAddress(tokenEvm))
    .execute(client);
  const contractId = (await create.getReceipt(client)).contractId!;
  console.log('deployed AgentEscrow', contractId.toString());

  // HTS requires the contract to be associated before it can hold the token.
  const assoc = await new ContractExecuteTransaction().setContractId(contractId).setGas(1_000_000).setFunction('associate').execute(client);
  const rec = await assoc.getRecord(client);
  console.log('associate ->', rec.receipt.status.toString());

  saveState({ ...state, escrow: { contractId: contractId.toString() } });
} finally {
  client.close();
}
