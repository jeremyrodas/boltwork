/**
 * Boltwork was called Strongroom. Its data folder is named after the app, so the first launch under the new name
 * would find an empty folder and look like a fresh install. This copies the Strongroom folder over once, before
 * anything reads it. The old folder is left in place (as a backup), with a note saying where things went.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Electron's caches and lock files: rebuilt on their own, and some are locked while the old app runs. */
const SKIP = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'GPUPersistentCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache',
  'ShaderCache', 'Shared Dictionary', 'blob_storage', 'Crashpad', 'lockfile', 'SingletonLock', 'SingletonCookie',
  'SingletonSocket', 'native-messaging',
]);

export const OLD_FOLDER_NAME = 'Strongroom';
const NOTE = 'MOVED-TO-BOLTWORK.txt';

/**
 * Copies `<appData>/Strongroom` into `userData` if the new folder has no vault yet and the old one has. Returns
 * true if it copied. The vault folder goes last, via a temporary name, so an interrupted copy never leaves a
 * half-copied vault where the app would open it; the next launch simply tries again.
 */
export function moveFromStrongroom(userData: string, appData = path.dirname(userData)): boolean {
  const oldDir = path.join(appData, OLD_FOLDER_NAME);
  const has = (dir: string) => fs.existsSync(path.join(dir, 'vault', 'vault.json'));
  // On Windows the names differ only by more than case, but guard against the same folder anyway.
  if (path.resolve(oldDir).toLowerCase() === path.resolve(userData).toLowerCase()) return false;
  if (has(userData) || !has(oldDir)) return false;

  fs.mkdirSync(userData, { recursive: true });
  for (const name of fs.readdirSync(oldDir)) {
    if (SKIP.has(name) || name === 'vault' || name === NOTE) continue;
    try {
      fs.cpSync(path.join(oldDir, name), path.join(userData, name), { recursive: true, force: false, errorOnExist: false });
    } catch { /* a locked or vanished file: not part of the vault, and Electron makes its own again */ }
  }
  const tmp = path.join(userData, 'vault.moving');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(path.join(oldDir, 'vault'), tmp, { recursive: true });
  fs.renameSync(tmp, path.join(userData, 'vault'));
  try {
    fs.writeFileSync(path.join(oldDir, NOTE),
      `Strongroom is now called Boltwork. Your data was copied to:\r\n${userData}\r\n\r\n`
      + `This folder is the copy from before the rename. You can delete it once Boltwork opens your vault.\r\n`);
  } catch { /* only a courtesy note */ }
  return true;
}
