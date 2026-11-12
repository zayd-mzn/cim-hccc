import { describe, expect, it } from 'vitest';
import { PrivateKey } from '@hiero-ledger/sdk';
import { SdkHederaClient } from '../src/sdk-client.js';

// Offline: signing/verification needs no network, only custodied keys.
describe('SdkHederaClient signing (offline)', () => {
  const op = PrivateKey.generateECDSA();
  const agent = PrivateKey.generateECDSA();
  const h = new SdkHederaClient('0.0.1', op.toStringDer(), {
    keys: { '0.0.2': agent.toStringDer() },
  });

  const base = {
    type: 'request', jobId: '00000000-0000-4000-8000-000000000000',
    fromAgent: '0.0.2', toAgent: '0.0.3', timestamp: new Date().toISOString(),
    payload: { capability: 'dataset', spec: {} }, signature: '',
  } as never;

  it('signs and verifies, and detects tampering', async () => {
    const sig = await h.signMessage('0.0.2', base);
    const signed = { ...(base as object), signature: sig } as never;
    expect(await h.verifyMessage(signed)).toBe(true);
    const tampered = { ...(signed as object), jobId: 'x' } as never;
    expect(await h.verifyMessage(tampered)).toBe(false);
    h.close();
  });
});
