/**
 * Runs Watchtower checks off the main thread, so rating hundreds of passwords never freezes the app.
 * One check at a time: the main process sends { data, now, cacheDir, enabled } and gets back progress,
 * Pwned Passwords counts to cache, and the report. Strength ratings stay cached in this worker until the
 * main process shuts it down (on lock).
 */
import { parentPort } from 'node:worker_threads';
import type { VaultData } from '../core/types';
import { runWatchtower } from '../core/watchtower';
import { onlineChecks } from './online';

interface Job {
  data: VaultData;
  now: number;
  cacheDir: string;
  enabled: { vulnerable: boolean; compromised: boolean; twoFactor: boolean };
}

const port = parentPort!;
port.on('message', async (job: Job) => {
  try {
    const report = await runWatchtower(
      job.data,
      onlineChecks(job.cacheDir, job.enabled),
      job.now,
      (h, n) => port.postMessage({ type: 'pwned', h, n }),
      (done, total, phase) => port.postMessage({ type: 'progress', done, total, phase }),
    );
    port.postMessage({ type: 'done', report });
  } catch (e) {
    port.postMessage({ type: 'error', message: (e as Error).message ?? String(e) });
  }
});
