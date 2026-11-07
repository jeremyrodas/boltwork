/**
 * The encrypted vault on disk.
 *
 * Layout of the data directory:
 *   vault.json           header (KDF params) + master key wrapped by the KEK + one sealed record per vault,
 *                        collection and item (see records.ts), so devices can sync item by item
 *   vault.json.bak       previous good copy, kept on every save
 *   vault.v1-backup.json the original file, kept when an old single-blob vault is upgraded
 *   attachments/<id>     each attachment sealed separately by the master key
 *
 * Changing the account password only re-wraps the master key; data is never re-encrypted.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  authKeyFrom, deriveKek, newKdfParams, open, openJson, randomId, randomKey, seal, sealJson, wipe,
  KDF_STRONG, type KdfParams, type Sealed,
} from './crypto';
import { RecordSet, recordAad, type RecordKind, type SealedRecord } from './records';
import { allFields, blankContent, fieldByPurpose } from './templates';
import type { Passkey } from './passkeys';
import { domainOf as domainOfUrl } from './search';
import type { Attachment, Collection, Item, ItemContent, Vault, VaultData } from './types';

// Internal format labels keep the app's earlier name (Strongroom): changing them would make existing data unreadable.
const FORMAT = 'strongroom-vault';
const VERSION = 2;
const AAD_KEY = 'strongroom:master-key:v1';
const AAD_DATA = 'strongroom:vault-data:v1';
const AAD_LOCAL = 'strongroom:local-data:v2';
const aadAttachment = (id: string) => `strongroom:attachment:v1:${id}`;

/**
 * An all-zero key. Boltwork 0.1.x and 0.2.0 wiped the master key after a quick unlock (PIN or Windows Hello)
 * while the open vault still used that same buffer, so anything saved afterwards on that device was sealed
 * with zeros. On unlock, data on this device's own disk that only opens with this key is re-sealed with the
 * real key. Data from a sync server never gets this fallback.
 */
const BLANK_KEY = new Uint8Array(32);

/** Version 1: everything in one sealed blob. Read only, to upgrade it. */
interface VaultFileV1 {
  format: typeof FORMAT;
  version: 1;
  kdf: KdfParams;
  wrappedKey: Sealed;
  data: Sealed;
  savedAt: number;
}

/** Where this vault syncs to, if anywhere. Not secret; the server only ever sees sealed records. */
export interface SyncState {
  serverUrl: string;
  email: string;
  /** Highest server revision this device has pulled. */
  cursor: number;
  lastSyncAt?: number;
}

interface VaultFileV2 {
  format: typeof FORMAT;
  version: 2;
  /** Random id for this account, shared by all its devices. */
  accountId: string;
  kdf: KdfParams;
  wrappedKey: Sealed;
  records: SealedRecord[];
  /** Device-local data (search history, Pwned Passwords cache). */
  local: Sealed;
  sync?: SyncState;
  savedAt: number;
}

type VaultFile = VaultFileV1 | VaultFileV2;

export class WrongPasswordError extends Error {
  constructor() { super('Incorrect password or Secret Key.'); }
}

export function vaultExists(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'vault.json'));
}

function emptyData(): VaultData {
  const now = Date.now();
  return {
    vaults: [{ id: randomId(), name: 'Personal', description: 'Your private vault', icon: 'house', color: '#3b82f6', createdAt: now }],
    items: [],
    collections: [],
    pwnedCache: {},
    searchHistory: [],
  };
}

function contentOf(item: Item): ItemContent {
  const { category, title, urls, fields, sections, notes, tags, icon, autosubmit } = item;
  return structuredClone({ category, title, urls, fields, sections, notes, tags, icon, autosubmit });
}

export class VaultStore {
  private key: Uint8Array | null;
  private data: VaultData;
  historyLimit = 30;
  /** @internal sealed records as on disk; used by sync. */
  records: RecordSet;
  accountId: string;
  syncState?: SyncState;

  private constructor(private dir: string, private kdf: KdfParams, private wrappedKey: Sealed, key: Uint8Array, data: VaultData,
    records = new RecordSet(), accountId = randomId(), syncState?: SyncState) {
    this.key = key;
    this.data = data;
    this.records = records;
    this.accountId = accountId;
    this.syncState = syncState;
  }

  static async create(dir: string, password: string, secretKey: string, cost = KDF_STRONG): Promise<VaultStore> {
    if (vaultExists(dir)) throw new Error('A vault already exists here.');
    if (password.length < 8) throw new Error('Use at least 8 characters for your account password.');
    fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true });
    const kdf = newKdfParams(cost);
    const kek = await deriveKek(password, secretKey, kdf);
    const key = randomKey();
    const wrappedKey = sealJson(kek, Array.from(key), AAD_KEY);
    wipe(kek);
    const store = new VaultStore(dir, kdf, wrappedKey, key, emptyData());
    store.persist();
    return store;
  }

  static async unlock(dir: string, password: string, secretKey: string): Promise<VaultStore> {
    const file = VaultStore.readFile(dir);
    const kek = await deriveKek(password, secretKey, file.kdf);
    let key: Uint8Array;
    try {
      key = Uint8Array.from(openJson<number[]>(kek, file.wrappedKey, AAD_KEY));
    } catch {
      throw new WrongPasswordError();
    } finally {
      wipe(kek);
    }
    return VaultStore.openWithKey(dir, file, key);
  }

  /** The vault's account id without unlocking it (null for an old-format vault or none). */
  static peekAccountId(dir: string): string | null {
    try { const f = VaultStore.readFile(dir); return f.version === 2 ? f.accountId : null; } catch { return null; }
  }

  /** Opens the vault with the master key itself (quick unlock already verified the user). */
  static unlockWithKey(dir: string, key: Uint8Array): VaultStore {
    const file = VaultStore.readFile(dir);
    // Prove the key is right before trusting it: it must be the one the account key wraps.
    try { VaultStore.checkKey(file, key); } catch { throw new Error('The saved quick-unlock key doesn’t match this vault. Enter your account password.'); }
    return VaultStore.openWithKey(dir, file, key);
  }

  /** Throws unless `key` decrypts this vault file. */
  private static checkKey(file: VaultFile, key: Uint8Array): void {
    if (file.version === 1) { openJson(key, file.data, AAD_DATA); return; }
    try { openJson(key, file.local, AAD_LOCAL); return; } catch { /* may be sealed with BLANK_KEY: check a record instead */ }
    for (const r of file.records) {
      if (!r.data) continue;
      try { open(key, r.data, recordAad(r.kind, r.id)); return; } catch { /* try the next */ }
    }
    throw new Error('Wrong key.');
  }

  private static openWithKey(dir: string, file: VaultFile, keyIn: Uint8Array): VaultStore {
    // The store keeps its own copy: callers wipe the key they passed in.
    const key = Uint8Array.from(keyIn);
    if (file.version === 1) {
      // Upgrade: keep the original, then rewrite as separate records.
      const data = openJson<VaultData>(key, file.data, AAD_DATA);
      data.collections ??= [];
      data.pwnedCache ??= {};
      data.searchHistory ??= [];
      const backup = path.join(dir, 'vault.v1-backup.json');
      if (!fs.existsSync(backup)) fs.copyFileSync(path.join(dir, 'vault.json'), backup);
      const store = new VaultStore(dir, file.kdf, file.wrappedKey, key, data);
      store.persist();
      return store;
    }
    const { set, vaults, collections, items, recovered } = RecordSet.open(key, file.records, BLANK_KEY);
    let local: Pick<VaultData, 'pwnedCache' | 'searchHistory'>;
    let localRecovered = false;
    try { local = openJson(key, file.local, AAD_LOCAL); } catch { local = openJson(BLANK_KEY, file.local, AAD_LOCAL); localRecovered = true; }
    vaults.sort((a, b) => a.createdAt - b.createdAt);
    const data: VaultData = { vaults, collections, items, pwnedCache: local.pwnedCache ?? {}, searchHistory: local.searchHistory ?? [] };
    const store = new VaultStore(dir, file.kdf, file.wrappedKey, key, data, set, file.accountId, file.sync);
    if (recovered.length || localRecovered) {
      // Re-seal with the real key; recovered records become local changes, so sync sends the fixed versions.
      store.repairedBlankKey = recovered.length + store.resealBlankAttachments();
      store.persist();
    }
    return store;
  }

  /** How many records and attachments were re-sealed on unlock because they were sealed with BLANK_KEY. */
  repairedBlankKey = 0;

  private resealBlankAttachments(): number {
    const key = this.requireKey();
    let n = 0;
    for (const id of this.referencedAttachmentIds()) {
      if (!this.hasAttachmentFile(id)) continue;
      const sealed = JSON.parse(fs.readFileSync(this.attachmentPath(id), 'utf8')) as Sealed;
      try { open(key, sealed, aadAttachment(id)); continue; } catch { /* check the blank key */ }
      let bytes: Uint8Array;
      try { bytes = open(BLANK_KEY, sealed, aadAttachment(id)); } catch { continue; }
      fs.writeFileSync(`${this.attachmentPath(id)}.tmp`, JSON.stringify(seal(key, bytes, aadAttachment(id))));
      fs.renameSync(`${this.attachmentPath(id)}.tmp`, this.attachmentPath(id));
      n++;
    }
    return n;
  }

  /**
   * Sets up this device from a sync server: unwraps the master key the server holds (sealed with the
   * account key) and starts with no data; the first sync pulls everything.
   */
  static async createFromRemote(dir: string, password: string, secretKey: string,
    remote: { kdf: KdfParams; wrappedKey: Sealed; accountId: string }, sync: SyncState): Promise<VaultStore> {
    if (vaultExists(dir)) throw new Error('A vault already exists here.');
    const kek = await deriveKek(password, secretKey, remote.kdf);
    let key: Uint8Array;
    try { key = Uint8Array.from(openJson<number[]>(kek, remote.wrappedKey, AAD_KEY)); } catch { throw new WrongPasswordError(); } finally { wipe(kek); }
    fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true });
    const data: VaultData = { vaults: [], items: [], collections: [], pwnedCache: {}, searchHistory: [] };
    const store = new VaultStore(dir, remote.kdf, remote.wrappedKey, key, data, new RecordSet(), remote.accountId, sync);
    store.writeFile();
    return store;
  }

  /** Derives the sync sign-in key, checking the password first. */
  async authKey(password: string, secretKey: string): Promise<Uint8Array> {
    const kek = await deriveKek(password, secretKey, this.kdf);
    try { open(kek, this.wrappedKey, AAD_KEY); return authKeyFrom(kek); } catch { throw new WrongPasswordError(); } finally { wipe(kek); }
  }

  /** What a sync server keeps so new devices can unlock: KDF params and the wrapped master key. Both are safe to share. */
  keyset(): { kdf: KdfParams; wrappedKey: Sealed; accountId: string } {
    return { kdf: this.kdf, wrappedKey: this.wrappedKey, accountId: this.accountId };
  }

  /**
   * Applies a record from the sync server. If this device changed the same record since the last sync,
   * the newer change wins; for items, the other version is kept in the item's history so nothing is lost.
   * Call writeFile() after a batch.
   */
  mergeRemote(r: SealedRecord): 'skipped' | 'applied' | 'conflict' {
    const key = this.requireKey();
    const local = this.records.get(r.id);
    if (local && local.rev === r.rev) return 'skipped'; // already have it (often our own change coming back)
    if (local && local.rev > r.rev) return 'skipped'; // stale
    const remote = r.deleted || !r.data ? null : openJson<Vault | Collection | Item>(key, r.data, recordAad(r.kind, r.id));
    const mine = this.findPlain(r.kind, r.id);
    if (!local || !local.dirty) {
      this.replacePlain(r.kind, r.id, remote);
      this.records.putRemote(r, remote);
      return 'applied';
    }
    // Both sides changed it.
    if (r.updatedAt > local.updatedAt) {
      let merged = remote;
      if (r.kind === 'item' && remote && mine) merged = this.withHistory(remote as Item, mine as Item);
      this.replacePlain(r.kind, r.id, merged);
      this.records.putRemote(r, remote);
      this.records.update(key, this.data); // re-seals the merged item, to be pushed back
    } else {
      if (r.kind === 'item' && remote && mine) this.replacePlain('item', r.id, this.withHistory(mine as Item, remote as Item));
      this.records.adoptRev(r.id, r.rev);
      this.records.update(key, this.data);
    }
    return 'conflict';
  }

  private withHistory(winner: Item, loser: Item): Item {
    const w = structuredClone(winner);
    w.history = [{ savedAt: loser.updatedAt, content: contentOf(loser) }, ...(w.history ?? [])].slice(0, this.historyLimit);
    // History doesn't hold attachments, so keep the other side's files on the item rather than lose them.
    const have = new Set(w.attachments.map(a => a.id));
    w.attachments.push(...structuredClone(loser.attachments.filter(a => !have.has(a.id))));
    // Same for passkeys: losing one would lock the user out of that site.
    const keys = new Set((w.passkeys ?? []).map(p => p.credentialId));
    const extra = (loser.passkeys ?? []).filter(p => !keys.has(p.credentialId));
    if (extra.length) w.passkeys = [...(w.passkeys ?? []), ...structuredClone(extra)];
    return w;
  }

  private listFor(kind: RecordKind): { id: string }[] {
    return kind === 'vault' ? this.data.vaults : kind === 'collection' ? this.data.collections : this.data.items;
  }

  private findPlain(kind: RecordKind, id: string) { return this.listFor(kind).find(x => x.id === id) as Vault | Collection | Item | undefined; }

  private replacePlain(kind: RecordKind, id: string, value: Vault | Collection | Item | null) {
    const list = this.listFor(kind);
    const i = list.findIndex(x => x.id === id);
    if (value === null) { if (i >= 0) list.splice(i, 1); return; }
    if (i >= 0) list[i] = value; else list.push(value);
    if (kind === 'vault') (list as Vault[]).sort((a, b) => a.createdAt - b.createdAt);
  }

  private static readFile(dir: string): VaultFile {
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'vault.json'), 'utf8')) as VaultFile;
    if (file.format !== FORMAT) throw new Error('This is not a Boltwork vault.');
    if (file.version > VERSION) throw new Error('This vault was made by a newer version of Boltwork.');
    return file;
  }

  get locked(): boolean { return this.key === null; }

  /** A copy of the master key, for quick unlock to protect on this device. Wipe it after use. */
  masterKeyCopy(): Uint8Array { return Uint8Array.from(this.requireKey()); }

  lock(): void {
    wipe(this.key);
    this.key = null;
    this.data = emptyData();
  }

  private requireKey(): Uint8Array {
    if (!this.key) throw new Error('The vault is locked.');
    return this.key;
  }

  snapshot(): VaultData {
    this.requireKey();
    return structuredClone(this.data);
  }

  persist(): void {
    const key = this.requireKey();
    this.records.update(key, this.data);
    this.writeFile();
  }

  /** Writes the current records to disk (atomically, keeping the previous file as .bak). */
  writeFile(): void {
    const key = this.requireKey();
    const file: VaultFileV2 = {
      format: FORMAT, version: VERSION, accountId: this.accountId, kdf: this.kdf, wrappedKey: this.wrappedKey,
      records: this.records.all(),
      local: sealJson(key, { pwnedCache: this.data.pwnedCache, searchHistory: this.data.searchHistory }, AAD_LOCAL),
      sync: this.syncState, savedAt: Date.now(),
    };
    const target = path.join(this.dir, 'vault.json');
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file));
    if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
    fs.renameSync(tmp, target);
  }

  /** Returns the new sync sign-in key, for updating a sync server. */
  async changePassword(oldPassword: string, newPassword: string, secretKey: string, cost = { ops: this.kdf.ops, mem: this.kdf.mem }): Promise<Uint8Array> {
    const key = this.requireKey();
    const oldKek = await deriveKek(oldPassword, secretKey, this.kdf);
    try { open(oldKek, this.wrappedKey, AAD_KEY); } catch { throw new WrongPasswordError(); } finally { wipe(oldKek); }
    if (newPassword.length < 8) throw new Error('Use at least 8 characters for your account password.');
    const kdf = newKdfParams(cost);
    const kek = await deriveKek(newPassword, secretKey, kdf);
    this.requireKey();
    this.kdf = kdf;
    this.wrappedKey = sealJson(kek, Array.from(key), AAD_KEY);
    const auth = authKeyFrom(kek);
    wipe(kek);
    this.persist();
    return auth;
  }

  /** Checks a password without changing state (used by re-authentication prompts). */
  async verifyPassword(password: string, secretKey: string): Promise<boolean> {
    const kek = await deriveKek(password, secretKey, this.kdf);
    try { open(kek, this.wrappedKey, AAD_KEY); return true; } catch { return false; } finally { wipe(kek); }
  }

  // ---- vaults & collections ----

  saveVault(v: Partial<Vault> & { name: string }): Vault {
    this.requireKey();
    const existing = v.id ? this.data.vaults.find(x => x.id === v.id) : undefined;
    const vault: Vault = existing
      ? Object.assign(existing, v)
      : { id: randomId(), description: '', icon: 'folder', color: '#8b5cf6', createdAt: Date.now(), ...v } as Vault;
    if (!existing) this.data.vaults.push(vault);
    this.persist();
    return structuredClone(vault);
  }

  deleteVault(id: string, moveItemsTo?: string): void {
    this.requireKey();
    if (this.data.vaults.length <= 1) throw new Error('You need at least one vault.');
    if (moveItemsTo) {
      if (!this.data.vaults.some(v => v.id === moveItemsTo)) throw new Error('Destination vault not found.');
      this.data.items.forEach(i => { if (i.vaultId === id) i.vaultId = moveItemsTo; });
    } else {
      this.data.items.filter(i => i.vaultId === id).forEach(i => this.removeAttachmentFiles(i));
      this.data.items = this.data.items.filter(i => i.vaultId !== id);
    }
    this.data.vaults = this.data.vaults.filter(v => v.id !== id);
    this.data.collections.forEach(c => { c.vaultIds = c.vaultIds.filter(x => x !== id); });
    this.persist();
  }

  saveCollection(c: Partial<Collection> & { name: string; vaultIds: string[] }): Collection {
    this.requireKey();
    const existing = c.id ? this.data.collections.find(x => x.id === c.id) : undefined;
    const col: Collection = existing ? Object.assign(existing, c) : { id: randomId(), ...c };
    if (!existing) this.data.collections.push(col);
    this.persist();
    return structuredClone(col);
  }

  deleteCollection(id: string): void {
    this.requireKey();
    this.data.collections = this.data.collections.filter(c => c.id !== id);
    this.persist();
  }

  // ---- items ----

  getItem(id: string): Item {
    this.requireKey();
    const item = this.data.items.find(i => i.id === id);
    if (!item) throw new Error('Item not found.');
    return item;
  }

  /** Creates or updates an item. Updates keep the previous content in item history. */
  saveItem(input: ItemContent & { id?: string; vaultId: string }): Item {
    this.requireKey();
    if (!this.data.vaults.some(v => v.id === input.vaultId)) throw new Error('Vault not found.');
    const now = Date.now();
    const content: ItemContent = {
      category: input.category, title: input.title.trim() || 'Untitled', urls: input.urls, fields: input.fields,
      sections: input.sections, notes: input.notes, tags: [...new Set(input.tags.map(t => t.trim()).filter(Boolean))],
      icon: input.icon, autosubmit: input.autosubmit,
    };
    const existing = input.id ? this.data.items.find(i => i.id === input.id) : undefined;
    if (!existing) {
      const item: Item = {
        ...structuredClone(content), id: randomId(), vaultId: input.vaultId, favorite: false, state: 'active',
        createdAt: now, updatedAt: now, useCount: 0, attachments: [], history: [], watchtowerIgnore: [],
        passwordChangedAt: fieldByPurpose(content, 'password') ? now : undefined,
      };
      this.data.items.push(item);
      this.persist();
      return structuredClone(item);
    }
    const before = contentOf(existing);
    if (JSON.stringify(before) !== JSON.stringify(content) || existing.vaultId !== input.vaultId) {
      existing.history.unshift({ savedAt: existing.updatedAt, content: before });
      existing.history = existing.history.slice(0, this.historyLimit);
      if (fieldByPurpose(before, 'password')?.value !== fieldByPurpose(content, 'password')?.value) existing.passwordChangedAt = now;
      Object.assign(existing, structuredClone(content), { vaultId: input.vaultId, updatedAt: now });
      this.persist();
    }
    return structuredClone(existing);
  }

  duplicateItem(id: string): Item {
    const src = this.getItem(id);
    return this.saveItem({ ...contentOf(src), title: `${src.title} (copy)`, vaultId: src.vaultId });
  }

  restoreVersion(itemId: string, index: number): Item {
    const item = this.getItem(itemId);
    const version = item.history[index];
    if (!version) throw new Error('That version no longer exists.');
    return this.saveItem({ ...structuredClone(version.content), id: item.id, vaultId: item.vaultId });
  }

  private patch(id: string, fn: (i: Item) => void, touch = true): Item {
    const item = this.getItem(id);
    fn(item);
    if (touch) item.updatedAt = Date.now();
    this.persist();
    return structuredClone(item);
  }

  setFavorite(id: string, favorite: boolean) { return this.patch(id, i => { i.favorite = favorite; }, false); }
  archive(id: string) { return this.patch(id, i => { i.state = 'archived'; }); }
  trash(id: string) { return this.patch(id, i => { i.state = 'deleted'; i.deletedAt = Date.now(); }); }
  restore(id: string) { return this.patch(id, i => { i.state = 'active'; delete i.deletedAt; }); }
  markUsed(id: string) { return this.patch(id, i => { i.useCount += 1; i.lastUsedAt = Date.now(); }, false); }
  move(id: string, vaultId: string) {
    if (!this.data.vaults.some(v => v.id === vaultId)) throw new Error('Vault not found.');
    return this.patch(id, i => { i.vaultId = vaultId; });
  }
  setWatchtowerIgnore(id: string, ignore: Item['watchtowerIgnore']) { return this.patch(id, i => { i.watchtowerIgnore = ignore; }, false); }

  /** Permanently deletes an item and its attachments. */
  purge(id: string): void {
    const item = this.getItem(id);
    this.removeAttachmentFiles(item);
    this.data.items = this.data.items.filter(i => i.id !== id);
    this.persist();
  }

  /** Permanently deletes trashed items older than `days` (0 = all trashed items). Returns how many. */
  emptyTrash(days = 0): number {
    this.requireKey();
    const cutoff = Date.now() - days * 86_400_000;
    const doomed = this.data.items.filter(i => i.state === 'deleted' && (days === 0 || (i.deletedAt ?? 0) < cutoff));
    doomed.forEach(i => this.removeAttachmentFiles(i));
    const ids = new Set(doomed.map(i => i.id));
    this.data.items = this.data.items.filter(i => !ids.has(i.id));
    if (doomed.length) this.persist();
    return doomed.length;
  }

  renameTag(from: string, to: string): void {
    this.requireKey();
    for (const item of this.data.items) {
      item.tags = [...new Set(item.tags.map(t => (t === from || t.startsWith(`${from}/`) ? to + t.slice(from.length) : t)).filter(Boolean))];
    }
    this.persist();
  }

  /** How many of these items an import would add (the rest are already here, or repeated in the file). */
  countNewItems(items: ItemContent[]): number {
    const seen = this.existingSignatures();
    let n = 0;
    for (const c of items) { const k = importSignature(c); if (!seen.has(k)) { seen.add(k); n++; } }
    return n;
  }

  private existingSignatures(): Set<string> {
    return new Set(this.data.items.filter(i => i.state !== 'deleted').map(importSignature));
  }

  importItems(items: (ItemContent & { favorite?: boolean })[], vaultId: string): number {
    this.requireKey();
    const now = Date.now();
    const seen = this.existingSignatures();
    let added = 0;
    for (const c of items) {
      const k = importSignature(c);
      if (seen.has(k)) continue;
      seen.add(k);
      added++;
      this.data.items.push({
        ...structuredClone(c), title: c.title || 'Untitled', id: randomId(), vaultId, favorite: !!c.favorite, state: 'active',
        createdAt: now, updatedAt: now, useCount: 0, attachments: [], history: [], watchtowerIgnore: [],
        passwordChangedAt: fieldByPurpose(c, 'password') ? now : undefined,
      });
    }
    if (added) this.persist();
    return added;
  }

  // ---- passkeys ----

  /** Active login items' passkeys for a relying party. */
  passkeysFor(rpId: string): { itemId: string; title: string; passkey: Passkey }[] {
    this.requireKey();
    return this.data.items
      .filter(i => i.state === 'active' && i.passkeys?.length)
      .flatMap(i => i.passkeys!.filter(p => p.rpId === rpId).map(p => ({ itemId: i.id, title: i.title, passkey: structuredClone(p) })));
  }

  /** Every passkey credential ID in the vault (to honor a site's excludeCredentials). */
  passkeyIds(): Set<string> {
    this.requireKey();
    return new Set(this.data.items.flatMap(i => (i.passkeys ?? []).map(p => p.credentialId)));
  }

  /**
   * Where a new passkey for this site and account could go: the site's logins, best match first. `suggested` is
   * where it goes unless the user picks otherwise ('new' for a new login).
   */
  passkeyTargets(rpId: string, userName: string): { targets: PasskeyTarget[]; suggested: string } {
    this.requireKey();
    const candidates = this.passkeyCandidates(rpId);
    const want = userName.toLowerCase();
    const targets = candidates.map(i => {
      const u = fieldByPurpose(i, 'username')?.value ?? '';
      return { itemId: i.id, title: i.title, userName: u, sameAccount: !!want && u.toLowerCase() === want,
        passkeys: (i.passkeys ?? []).filter(p => p.rpId === rpId).length };
    }).sort((a, b) => Number(b.sameAccount) - Number(a.sameAccount));
    return { targets, suggested: this.autoTarget(candidates, userName)?.id ?? 'new' };
  }

  private passkeyCandidates(rpId: string): Item[] {
    const site = (i: Item) => i.urls.some(u => { const h = domainOfUrl(u.url); return h === rpId || h.endsWith(`.${rpId}`); });
    return this.data.items.filter(i => i.state === 'active' && i.category === 'login' && site(i));
  }

  private autoTarget(candidates: Item[], userName: string): Item | undefined {
    const user = (i: Item) => (fieldByPurpose(i, 'username')?.value ?? '').toLowerCase();
    return candidates.find(i => userName && user(i) === userName.toLowerCase())
      ?? (candidates.length === 1 && !user(candidates[0]) ? candidates[0] : undefined);
  }

  /**
   * Saves a new passkey. `target` is the login the user chose for it, or 'new' for a new login; left out, it goes
   * on the login for that site and account, or a new one if there isn't one. Returns the item it went on.
   */
  addPasskey(passkey: Passkey, vaultId?: string, target?: string): Item {
    this.requireKey();
    const candidates = this.passkeyCandidates(passkey.rpId);
    const chosen = target === 'new' ? undefined
      : target ? candidates.find(i => i.id === target) : this.autoTarget(candidates, passkey.userName);
    if (target && target !== 'new' && !chosen) throw new Error('That login is no longer in your vault.');
    if (chosen) {
      return this.patch(chosen.id, i => { i.passkeys = [...(i.passkeys ?? []), passkey]; });
    }
    const c = blankContentForPasskey(passkey);
    const created = this.saveItem({ ...c, vaultId: vaultId ?? this.data.vaults[0].id });
    return this.patch(created.id, i => { i.passkeys = [passkey]; });
  }

  markPasskeyUsed(itemId: string, credentialId: string): void {
    this.patch(itemId, i => {
      const p = i.passkeys?.find(x => x.credentialId === credentialId);
      if (p) p.lastUsedAt = Date.now();
      i.useCount += 1; i.lastUsedAt = Date.now();
    }, false);
  }

  removePasskey(itemId: string, credentialId: string): void {
    this.patch(itemId, i => { i.passkeys = (i.passkeys ?? []).filter(p => p.credentialId !== credentialId); });
  }

  // ---- attachments ----

  private attachmentPath(id: string): string {
    return path.join(this.dir, 'attachments', id);
  }

  addAttachment(itemId: string, name: string, mime: string, bytes: Uint8Array): Attachment {
    const key = this.requireKey();
    if (bytes.length > 100 * 1024 * 1024) throw new Error('Attachments can be up to 100 MB.');
    const att: Attachment = { id: randomId(), name, mime, size: bytes.length, addedAt: Date.now() };
    fs.mkdirSync(path.join(this.dir, 'attachments'), { recursive: true });
    fs.writeFileSync(this.attachmentPath(att.id), JSON.stringify(seal(key, bytes, aadAttachment(att.id))));
    this.patch(itemId, i => { i.attachments.push(att); });
    return att;
  }

  readAttachment(itemId: string, attachmentId: string): { meta: Attachment; bytes: Uint8Array } {
    const key = this.requireKey();
    const meta = this.getItem(itemId).attachments.find(a => a.id === attachmentId);
    if (!meta) throw new Error('Attachment not found.');
    if (!this.hasAttachmentFile(meta.id)) {
      throw new Error(this.syncState ? 'This file hasn’t downloaded to this computer yet. It will after the next sync.' : 'This attachment’s file is missing from the vault folder.');
    }
    const sealed = JSON.parse(fs.readFileSync(this.attachmentPath(meta.id), 'utf8')) as Sealed;
    return { meta, bytes: open(key, sealed, aadAttachment(meta.id)) };
  }

  // ---- attachment files, for sync. Files move between devices still sealed; only the master key opens them. ----

  /** Ids of every attachment some item (including ones in Recently Deleted) refers to. */
  referencedAttachmentIds(): Set<string> {
    this.requireKey();
    return new Set(this.data.items.flatMap(i => i.attachments.map(a => a.id)));
  }

  hasAttachmentFile(id: string): boolean {
    return fs.existsSync(this.attachmentPath(id));
  }

  /** The sealed file as stored, for upload. */
  readAttachmentBlob(id: string): Uint8Array {
    return fs.readFileSync(this.attachmentPath(id));
  }

  /**
   * Stores a sealed file from the sync server, after checking it decrypts as the attachment it claims to be
   * (the id is bound into the encryption), so a server can't plant or swap files.
   */
  writeAttachmentBlob(id: string, blob: Uint8Array): void {
    const key = this.requireKey();
    if (!this.referencedAttachmentIds().has(id)) throw new Error('No item refers to that attachment.');
    let sealed: Sealed;
    try { sealed = JSON.parse(new TextDecoder().decode(blob)) as Sealed; } catch { throw new Error('Attachment file is damaged.'); }
    try { wipe(open(key, sealed, aadAttachment(id))); } catch { throw new Error('Attachment file is damaged.'); }
    fs.mkdirSync(path.join(this.dir, 'attachments'), { recursive: true });
    const target = this.attachmentPath(id);
    fs.writeFileSync(`${target}.tmp`, blob);
    fs.renameSync(`${target}.tmp`, target);
  }

  /** Deletes files no item refers to any more (removed or deleted on another device). Returns how many. */
  removeUnreferencedAttachmentFiles(): number {
    const keep = this.referencedAttachmentIds();
    let n = 0;
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(this.dir, 'attachments')); } catch { return 0; }
    for (const f of names) {
      const id = f.endsWith('.tmp') ? '' : f;
      if (id && keep.has(id)) continue;
      fs.rmSync(path.join(this.dir, 'attachments', f), { force: true });
      if (id) n++;
    }
    return n;
  }

  removeAttachment(itemId: string, attachmentId: string): void {
    this.patch(itemId, i => { i.attachments = i.attachments.filter(a => a.id !== attachmentId); });
    fs.rmSync(this.attachmentPath(attachmentId), { force: true });
  }

  private removeAttachmentFiles(item: Item): void {
    item.attachments.forEach(a => fs.rmSync(this.attachmentPath(a.id), { force: true }));
  }

  // ---- misc encrypted state ----

  recordPwned(sha1: string, count: number): void {
    this.requireKey();
    this.data.pwnedCache[sha1] = count;
  }

  flush(): void { this.persist(); }

  addSearchHistory(q: string): void {
    this.requireKey();
    const t = q.trim();
    if (!t) return;
    this.data.searchHistory = [t, ...this.data.searchHistory.filter(x => x !== t)].slice(0, 20);
    this.persist();
  }

  clearSearchHistory(): void {
    this.requireKey();
    this.data.searchHistory = [];
    this.persist();
  }
}

export { allFields };

/** Identifies an item for duplicate detection on import: same category, title, websites, field values and notes. */
function importSignature(c: ItemContent): string {
  return JSON.stringify([c.category, c.title || 'Untitled', c.urls.map(u => u.url),
    [...c.fields, ...c.sections.flatMap(s => s.fields)].filter(f => f.value).map(f => [f.label, f.value]).sort(), c.notes]);
}

/** A new login for a passkey made on a site Boltwork has no login for yet. */
/** A login a new passkey could be saved on (see VaultStore.passkeyTargets). */
export interface PasskeyTarget { itemId: string; title: string; userName: string; sameAccount: boolean; passkeys: number }

function blankContentForPasskey(p: Passkey): ItemContent {
  const c = blankContent('login');
  c.title = p.rpName?.trim() || p.rpId;
  const local = p.rpId === 'localhost' || p.rpId.endsWith('.localhost');
  c.urls = [{ label: 'website', url: `${local ? 'http' : 'https'}://${p.rpId}`, primary: true }];
  const u = c.fields.find(f => f.purpose === 'username');
  if (u) u.value = p.userName;
  return c;
}
