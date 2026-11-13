import { describe, it, expect } from 'vitest';
import {
  buildDeliver,
  contractJobRef,
  isDecisionRecord,
  sha256Hex,
} from '../src/index.js';

const JOB = '11111111-1111-1111-1111-111111111111';

describe('contractJobRef', () => {
  it('is 0x + sha256(jobId), the AgentEscrow bytes32 key', () => {
    expect(contractJobRef(JOB)).toBe(`0x${sha256Hex(JOB)}`);
    expect(contractJobRef(JOB)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('isDecisionRecord', () => {
  it('flags the log_decision envelope', () => {
    const msg = buildDeliver(
      { jobId: JOB, fromAgent: '0.0.5', toAgent: '0.0.5' },
      { resultHash: 'ab', resultLocation: `decision:${JOB}` },
    );
    expect(isDecisionRecord(msg)).toBe(true);
  });

  it('does not flag a real delivery', () => {
    const msg = buildDeliver(
      { jobId: JOB, fromAgent: '0.0.6', toAgent: '0.0.5' },
      { resultHash: 'ab', resultLocation: `mem://datasets/${JOB}` },
    );
    expect(isDecisionRecord(msg)).toBe(false);
  });
});
