/** Watchtower's online lookups in the app, with the downloaded lists cached in a folder for a day. */
import fs from 'node:fs';
import path from 'node:path';
import { onlineChecks as checksWith, type ListCache } from '../core/online';
import type { OnlineChecks } from '../core/watchtower';

const DAY = 86_400_000;

function folderCache(cacheDir: string): ListCache {
  const file = (name: string) => path.join(cacheDir, `${name}.json`);
  return {
    get: name => {
      try {
        if (Date.now() - fs.statSync(file(name)).mtimeMs < DAY) return JSON.parse(fs.readFileSync(file(name), 'utf8'));
      } catch { /* no cache yet */ }
      return undefined;
    },
    set: (name, value) => {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(file(name), JSON.stringify(value));
    },
  };
}

export function onlineChecks(cacheDir: string, enabled: { vulnerable: boolean; compromised: boolean; twoFactor: boolean }): OnlineChecks {
  return checksWith(folderCache(cacheDir), enabled);
}
