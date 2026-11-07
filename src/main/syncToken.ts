/** The sync session token on disk, encrypted with safeStorage. */
import { safeStorage } from 'electron';
import fs from 'node:fs';
import type { SyncHost } from '../core/syncLoop';

export function syncTokenFile(file: string): SyncHost['token'] {
  return {
    save: token => {
      const enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token).toString('base64') : null;
      if (!enc) throw new Error('This system can’t store the sync session securely.');
      fs.writeFileSync(file, JSON.stringify({ token: enc }));
    },
    load: () => {
      try {
        const { token } = JSON.parse(fs.readFileSync(file, 'utf8')) as { token: string };
        return safeStorage.decryptString(Buffer.from(token, 'base64'));
      } catch { return ''; }
    },
    clear: () => { try { fs.unlinkSync(file); } catch { /* not there */ } },
  };
}
