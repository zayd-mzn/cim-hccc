import { describe, expect, it } from 'vitest';
import { InMemoryHederaClient } from '../src/in-memory-client.js';
import { InMemoryEscrowClient } from '../src/in-memory-escrow.js';
import { jobRef } from '../src/escrow.js';

describe('InMemoryEscrowClient', () => {
  async function setup() {
    const h = new InMemoryHederaClient();
    await h.createToken();
    const c = await h.createAccount('c');
    const p = await h.createAccount('p');
    h.grant(c.accountId, 100);
    let t = 1000;
    const e = new InMemoryEscrowClient(h, () => t);
    return { h, e, c: c.accountId, p: p.accountId, tick: (n: number) => { t = n; } };
  }

  it('holds on fund, releases on deliver', async () => {
    const { h, e, c, p } = await setup();
    await e.fundJob('j', c, p, 40, 2000);
    expect(await h.balanceOf(c)).toBe(60);
    expect((await e.getJob('j')).status).toBe('Held');
    await e.deliverJob('j', p, 'ab');
    expect(await h.balanceOf(p)).toBe(40);
    expect((await e.getJob('j')).status).toBe('Released');
  });

  it('refunds only after the deadline and never double-pays', async () => {
    const { h, e, c, p, tick } = await setup();
    await e.fundJob('j', c, p, 40, 2000);
    await expect(e.refundJob('j', c)).rejects.toThrow('deadline not passed');
    tick(2001);
    await e.refundJob('j', c);
    expect(await h.balanceOf(c)).toBe(100);
    await expect(e.deliverJob('j', p, 'ab')).rejects.toThrow('not held');
  });

  it('jobRef is a stable bytes32 hex', () => {
    expect(jobRef('x')).toMatch(/^0x[0-9a-f]{64}$/);
    expect(jobRef('x')).toBe(jobRef('x'));
  });
});
