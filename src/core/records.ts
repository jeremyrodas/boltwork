/**
 * Vault storage as separately encrypted records, so devices can sync one item at a time.
 *
 * Every vault, collection and item is its own record, sealed with the master key. The associated data
 * binds each blob to its kind and id, so a sync server can't swap one record's contents for another's.
 * Deleted records stay as tombstones (no data) so the deletion can reach other devices.
 * Search history and the Pwned Passwords cache stay on this device and are sealed separately.
 */
import { createHash } from 'node:crypto';
import { openJson, sealJson, type Sealed } from './crypto';
import type { Collection, Item, Vault, VaultData } from './types';

export type RecordKind = 'vault' | 'collection' | 'item';

export interface SealedRecord {
  id: string;
  kind: RecordKind;
  /** Server revision this record was last synced at; 0 if it never was. */
  rev: number;
  /** When the plaintext last changed (or the record was deleted). */
  updatedAt: number;
  /** Changed locally since the last sync. */
  dirty: boolean;
  deleted?: boolean;
  data?: Sealed;
}

export const recordAad = (kind: RecordKind, id: string) => `strongroom:record:v2:${kind}:${id}`;

const hash = (s: string) => createHash('sha256').update(s).digest('base64');

type Plain = Vault | Collection | Item;

function plaintextRecords(data: VaultData): { id: string; kind: RecordKind; value: Plain }[] {
  return [
    ...data.vaults.map(v => ({ id: v.id, kind: 'vault' as const, value: v })),
    ...data.collections.map(c => ({ id: c.id, kind: 'collection' as const, value: c })),
    ...data.items.map(i => ({ id: i.id, kind: 'item' as const, value: i })),
  ];
}

/**
 * Keeps the sealed form of each record and re-seals only what changed, so saving a vault with
 * thousands of items stays fast and unchanged records keep their exact ciphertext.
 */
export class RecordSet {
  private records = new Map<string, SealedRecord>();
  private hashes = new Map<string, string>();

  /**
   * Loads records and the plaintext they decrypt to (for change detection).
   * With `fallbackKey`, records that only open with that key are loaded too and left without a hash,
   * so the next update() re-seals them with `key` (see BLANK_KEY in store.ts). Their ids are in `recovered`.
   */
  static open(key: Uint8Array, sealed: SealedRecord[], fallbackKey?: Uint8Array): { set: RecordSet; vaults: Vault[]; collections: Collection[]; items: Item[]; recovered: string[] } {
    const set = new RecordSet();
    const vaults: Vault[] = [], collections: Collection[] = [], items: Item[] = [];
    const recovered: string[] = [];
    for (const r of sealed) {
      set.records.set(r.id, r);
      if (r.deleted || !r.data) continue;
      let value: Plain;
      try {
        value = openJson<Plain>(key, r.data, recordAad(r.kind, r.id));
        set.hashes.set(r.id, hash(JSON.stringify(value)));
      } catch (e) {
        if (!fallbackKey) throw e;
        value = openJson<Plain>(fallbackKey, r.data, recordAad(r.kind, r.id)); // throws if it doesn't open either
        recovered.push(r.id);
      }
      if (r.kind === 'vault') vaults.push(value as Vault);
      else if (r.kind === 'collection') collections.push(value as Collection);
      else items.push(value as Item);
    }
    return { set, vaults, collections, items, recovered };
  }

  /** Brings the sealed records in line with `data`: seals new or changed records, tombstones removed ones. */
  update(key: Uint8Array, data: VaultData, now = Date.now()): void {
    const seen = new Set<string>();
    for (const { id, kind, value } of plaintextRecords(data)) {
      seen.add(id);
      const json = JSON.stringify(value);
      const h = hash(json);
      const existing = this.records.get(id);
      if (existing && !existing.deleted && this.hashes.get(id) === h) continue;
      this.records.set(id, { id, kind, rev: existing?.rev ?? 0, updatedAt: now, dirty: true, data: sealJson(key, value, recordAad(kind, id)) });
      this.hashes.set(id, h);
    }
    for (const r of this.records.values()) {
      if (seen.has(r.id) || r.deleted) continue;
      this.records.set(r.id, { id: r.id, kind: r.kind, rev: r.rev, updatedAt: now, dirty: true, deleted: true });
      this.hashes.delete(r.id);
    }
  }

  all(): SealedRecord[] { return [...this.records.values()]; }
  get(id: string): SealedRecord | undefined { return this.records.get(id); }

  /** Records with local changes not yet sent to a server. */
  dirty(): SealedRecord[] { return this.all().filter(r => r.dirty); }

  /** After the server accepted a record at revision `rev`. Ignored if the record changed again meanwhile. */
  markSynced(id: string, rev: number, updatedAt: number): void {
    const r = this.records.get(id);
    if (!r) return;
    r.rev = rev;
    if (r.updatedAt === updatedAt) r.dirty = false;
  }

  /** Keeps local changes but bases them on the server's newer revision, so the next push is accepted. */
  adoptRev(id: string, rev: number): void {
    const r = this.records.get(id);
    if (r) r.rev = rev;
  }

  /** Stores a record exactly as it came from the server (its plaintext must already be applied to the data). */
  putRemote(r: SealedRecord, plaintext: Plain | null): void {
    this.records.set(r.id, { ...r, dirty: false });
    if (plaintext) this.hashes.set(r.id, hash(JSON.stringify(plaintext)));
    else this.hashes.delete(r.id);
  }
}
