/** End-to-end escrow check on testnet: allowance -> fund (held) -> deliver (released). */
import { createHash } from 'node:crypto';
import {
  AccountAllowanceApproveTransaction, ContractExecuteTransaction, ContractFunctionParameters,
  ContractId,
} from '@hiero-ledger/sdk';
import { clientFor, loadState, mirrorTokenBalance, sleep, toEvm } from './common.mjs';

const s = loadState();
const contractId = ContractId.fromString(s.escrow.contractId);
const consumer = clientFor(s.consumer.accountId, s.keys[s.consumer.accountId]);
const provider = clientFor(s.provider.accountId, s.keys[s.provider.accountId]);
const bal = async (id: string) => mirrorTokenBalance(id, s.tokenId);
const show = async (label: string) => {
  await sleep(6000);
  console.log(label, { consumer: await bal(s.consumer.accountId), escrow: await bal(s.escrow.contractId), provider: await bal(s.provider.accountId) });
};

try {
  const jobId = createHash('sha256').update(`spike-${Date.now()}`).digest();
  const resultHash = createHash('sha256').update('dataset').digest();
  const providerEvm = toEvm(s.provider.accountId);
  await show('start     ');

  await (await new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(s.tokenId, s.consumer.accountId, s.escrow.contractId, 100)
    .execute(consumer)).getReceipt(consumer);
  console.log('allowance approved');

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const fund = await new ContractExecuteTransaction().setContractId(contractId).setGas(1_000_000)
    .setFunction('fund', new ContractFunctionParameters().addBytes32(jobId).addAddress(providerEvm).addUint256(40).addUint64(deadline))
    .execute(consumer);
  console.log('fund ->', (await fund.getReceipt(consumer)).status.toString(), fund.transactionId.toString());
  await show('after fund');

  const deliver = await new ContractExecuteTransaction().setContractId(contractId).setGas(1_000_000)
    .setFunction('deliver', new ContractFunctionParameters().addBytes32(jobId).addBytes32(resultHash))
    .execute(provider);
  console.log('deliver ->', (await deliver.getReceipt(provider)).status.toString());
  await show('after deliv');
} finally {
  consumer.close(); provider.close();
}
