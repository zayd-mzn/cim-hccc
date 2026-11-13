#!/usr/bin/env node
/**
 * Print provider reputation computed live from the Hedera Mirror Node.
 *
 *   pnpm reputation                 # ids from .hedera-state.json (repo root)
 *   pnpm reputation -- --json       # full report as JSON
 *   pnpm reputation -- --topic 0.0.X --escrow 0.0.Y [--mirror URL]
 *
 * Read-only: needs HTTPS to the Mirror Node, no keys.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MirrorNodeClient, TESTNET_MIRROR } from './mirror.js';
import { ReputationEngine, mirrorSource } from './engine.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function findState(): { topicId?: string; escrow?: { contractId?: string } } {
  let dir = resolve(process.cwd());
  for (;;) {
    const p = join(dir, '.hedera-state.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
    const up = dirname(dir);
    if (up === dir) return {};
    dir = up;
  }
}

function secs(ms: number | undefined): string {
  return ms === undefined ? '-' : `${(ms / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  const state = findState();
  const topicId = arg('topic') ?? state.topicId;
  const escrowContractId = arg('escrow') ?? state.escrow?.contractId;
  if (!topicId) throw new Error('no topic id: pass --topic or put .hedera-state.json in the repo root');

  const mirror = new MirrorNodeClient(arg('mirror') ?? TESTNET_MIRROR);
  const engine = new ReputationEngine({ source: mirrorSource({ topicId, escrowContractId, mirror }) });
  const report = await engine.compute();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\nAgent Market reputation — topic ${topicId}${escrowContractId ? `, escrow ${escrowContractId}` : ''}`);
  console.log(`as of ${report.asOf ? new Date(report.asOf).toISOString() : 'n/a'} · ${report.jobs.length} jobs · ${report.anomalies.length} anomalies\n`);
  console.table(
    report.providers.map((p) => ({
      provider: p.accountId,
      score: p.score,
      completed: p.completed,
      refunded: p.refunded,
      expired: p.expired,
      'in progress': p.inProgress,
      anomalies: p.anomalies,
      'median latency': secs(p.medianLatencyMs),
      volume: p.volume,
    })),
  );
  if (report.consumers.length) {
    console.table(report.consumers.map((c) => ({ consumer: c.accountId, accepted: c.accepted, paid: c.paid, anomalies: c.anomalies })));
  }
  for (const a of report.anomalies.slice(0, 20)) {
    console.log(`  ! #${a.sequenceNumber} ${a.agent ?? '?'}: ${a.reason}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
