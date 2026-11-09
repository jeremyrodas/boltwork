/** Watchtower checks for the web vault, off the page's thread (the app's worker does the same job). */
import { ready } from '../core/crypto';
import { onlineChecks, type ListCache } from '../core/online';
import type { VaultData } from '../core/types';
import { runWatchtower } from '../core/watchtower';

interface Job {
  data: VaultData;
  now: number;
  enabled: { vulnerable: boolean; compromised: boolean; twoFactor: boolean };
}

/** Downloaded lists, for as long as the vault stays unlocked (the worker ends on lock). */
const lists = new Map<string, unknown>();
const cache: ListCache = { get: name => lists.get(name), set: (name, value) => { lists.set(name, value); } };

self.onmessage = async ({ data: job }: MessageEvent<Job>) => {
  try {
    await ready();
    const report = await runWatchtower(
      job.data,
      onlineChecks(cache, job.enabled),
      job.now,
      (h, n) => postMessage({ type: 'pwned', h, n }),
      (done, total, phase) => postMessage({ type: 'progress', done, total, phase }),
    );
    postMessage({ type: 'done', report });
  } catch (e) {
    postMessage({ type: 'error', message: (e as Error).message ?? String(e) });
  }
};
