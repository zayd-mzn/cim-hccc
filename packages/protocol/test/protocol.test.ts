import { describe, it, expect } from 'vitest';
import {
  buildOffer,
  buildRequest,
  canonicalize,
  contentHash,
  hasValidContentHash,
  parseAgentMessage,
  safeParseAgentMessage,
  toHcsRecord,
} from '../src/index.js';

const JOB = '11111111-1111-1111-1111-111111111111';

describe('canonicalize', () => {
  it('produces stable output regardless of key order', () => {
    const a = canonicalize({ b: 1, a: { d: 4, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 4 }, b: 1 });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('contentHash / HcsRecord', () => {
  it('is independent of the signature field', () => {
    const msg = buildRequest(
      { jobId: JOB, fromAgent: '0.0.1', toAgent: '0.0.2' },
      { capability: 'dataset', spec: { rows: 100 } },
    );
    const h1 = contentHash({ ...msg, signature: '' });
    const h2 = contentHash({ ...msg, signature: 'deadbeef' });
    expect(h1).toBe(h2);
  });

  it('toHcsRecord yields a verifiable content hash', () => {
    const msg = buildRequest(
      { jobId: JOB, fromAgent: '0.0.1', toAgent: '0.0.2' },
      { capability: 'dataset', spec: {} },
    );
    const record = toHcsRecord(msg);
    expect(hasValidContentHash(record)).toBe(true);
    expect(record.contentHash).toHaveLength(64);
  });
});

describe('parseAgentMessage', () => {
  it('validates a well-formed offer with its payload', () => {
    const msg = buildOffer(
      { jobId: JOB, fromAgent: '0.0.2', toAgent: '0.0.1' },
      {
        price: 10,
        tokenId: '0.0.999',
        contractAddress: '0x0000000000000000000000000000000000000abc',
        expiresAt: new Date().toISOString(),
      },
    );
    const parsed = parseAgentMessage(msg);
    expect(parsed.type).toBe('offer');
  });

  it('rejects a message whose payload does not match its type', () => {
    const bad = {
      type: 'offer',
      jobId: JOB,
      fromAgent: '0.0.2',
      toAgent: '0.0.1',
      timestamp: new Date().toISOString(),
      payload: { capability: 'dataset', spec: {} }, // request payload, not offer
      signature: '',
    };
    const result = safeParseAgentMessage(bad);
    expect(result.success).toBe(false);
  });
});
