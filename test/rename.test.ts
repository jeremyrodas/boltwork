import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { moveFromStrongroom } from '../src/main/rename';

test('first launch as Boltwork copies the Strongroom data folder, once, and keeps the old one', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'boltwork-rename-'));
  const oldDir = path.join(appData, 'Strongroom'), newDir = path.join(appData, 'Boltwork');
  fs.mkdirSync(path.join(oldDir, 'vault', 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'vault', 'vault.json'), '{"format":"strongroom-vault"}');
  fs.writeFileSync(path.join(oldDir, 'vault', 'attachments', 'a1'), 'sealed');
  fs.writeFileSync(path.join(oldDir, 'settings.json'), '{}');
  fs.writeFileSync(path.join(oldDir, 'Local State'), 'os key');
  fs.mkdirSync(path.join(oldDir, 'Cache'));
  fs.writeFileSync(path.join(oldDir, 'Cache', 'big'), 'x');
  fs.mkdirSync(newDir); fs.writeFileSync(path.join(newDir, 'lockfile'), ''); // Electron's lock, made first

  assert.equal(moveFromStrongroom(newDir, appData), true);
  assert.equal(fs.readFileSync(path.join(newDir, 'vault', 'vault.json'), 'utf8'), '{"format":"strongroom-vault"}');
  assert.equal(fs.readFileSync(path.join(newDir, 'vault', 'attachments', 'a1'), 'utf8'), 'sealed');
  assert.ok(fs.existsSync(path.join(newDir, 'settings.json')) && fs.existsSync(path.join(newDir, 'Local State')));
  assert.ok(!fs.existsSync(path.join(newDir, 'Cache')), 'caches are not copied');
  assert.ok(!fs.existsSync(path.join(newDir, 'vault.moving')));
  assert.ok(fs.existsSync(path.join(oldDir, 'vault', 'vault.json')), 'the old folder stays as a backup');
  assert.match(fs.readFileSync(path.join(oldDir, 'MOVED-TO-BOLTWORK.txt'), 'utf8'), /Boltwork/);

  // Never again once Boltwork has its own vault, even if the old one changes.
  fs.writeFileSync(path.join(oldDir, 'vault', 'vault.json'), 'older');
  assert.equal(moveFromStrongroom(newDir, appData), false);
  assert.notEqual(fs.readFileSync(path.join(newDir, 'vault', 'vault.json'), 'utf8'), 'older');
  // Nothing to copy on a fresh computer.
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'boltwork-fresh-'));
  assert.equal(moveFromStrongroom(path.join(fresh, 'Boltwork'), fresh), false);
});
