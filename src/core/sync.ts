/**
 * Talks to a Strongroom sync server and keeps a VaultStore in step with it.
 * Only sealed records, the wrapped master key and KDF parameters ever leave the device.
 */
import { deriveKek, authKeyFrom, wipe, type KdfParams, type Sealed } from './crypto';
import type { SealedRecord } from './records';
import type { VaultStore } from './store';

export class SyncError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const b64u = (u: Uint8Array) => Buffer.from(u).toString('base64url');

/**
 * True for this computer and home-network addresses: private IPv4 ranges (10/8, 172.16/12, 192.168/16),
 * link-local, IPv6 unique-local, and names reserved for local networks (.local, .home.arpa).
 * Public names aren't included even if they resolve to a private address, since that can change.
 */
export function isLocalNetworkHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.home.arpa')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
}

/**
 * Plain http is allowed only on this computer or a home network. Vault data stays end-to-end encrypted
 * either way, but over http someone on the network could see the sync sign-in, so https is still better.
 */
export function normalizeServerUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const url = new URL(u);
  if (url.protocol === 'http:' && !isLocalNetworkHost(url.hostname)) {
    throw new Error('Use an https:// address. Plain http is only allowed for this computer or a home-network address (like 192.168.1.20).');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export class SyncClient {
  constructor(public serverUrl: string, public token = '') {}

  private async req<T>(method: string, route: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/api/v1${route}`, {
        method,
        headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new SyncError(0, `Can't reach the sync server (${(e as Error).message}).`);
    }
    const json = await res.json().catch(() => ({})) as T & { error?: string };
    if (!res.ok) throw new SyncError(res.status, json.error ?? `Sync server error ${res.status}.`);
    return json;
  }

  health() { return this.req<{ ok: boolean; name: string; signups: string }>('GET', '/health'); }
  prelogin(email: string) { return this.req<{ kdf: KdfParams }>('POST', '/prelogin', { email }); }

  async signup(email: string, authKey: Uint8Array, keyset: { kdf: KdfParams; wrappedKey: Sealed; accountId: string }, device: string) {
    const r = await this.req<{ token: string }>('POST', '/accounts', { email, authKey: b64u(authKey), ...keyset, device });
    this.token = r.token;
  }

  async login(email: string, authKey: Uint8Array, device: string) {
    const r = await this.req<{ token: string; accountId: string; kdf: KdfParams; wrappedKey: Sealed }>('POST', '/login', { email, authKey: b64u(authKey), device });
    this.token = r.token;
    return r;
  }

  logout() { return this.req('POST', '/logout'); }
  deleteAccount() { return this.req('DELETE', '/account'); }
  account() { return this.req<{ email: string; devices: { device: string; createdAt: number; lastUsedAt: number }[] }>('GET', '/account'); }
  updateKeys(authKey: Uint8Array, kdf: KdfParams, wrappedKey: Sealed) { return this.req('PUT', '/account/keys', { authKey: b64u(authKey), kdf, wrappedKey }); }
  listBlobs() { return this.req<{ blobs: { id: string; size: number; createdAt: number }[]; now: number }>('GET', '/blobs'); }
  deleteBlob(id: string) { return this.req('DELETE', `/blobs/${encodeURIComponent(id)}`); }

  async putBlob(id: string, bytes: Uint8Array) {
    const res = await this.raw('PUT', id, bytes);
    if (!res.ok) throw new SyncError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Sync server error ${res.status}.`);
  }

  /** The sealed file, or null if the server doesn't have it (yet). */
  async getBlob(id: string): Promise<Uint8Array | null> {
    const res = await this.raw('GET', id);
    if (res.status === 404) return null;
    if (!res.ok) throw new SyncError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Sync server error ${res.status}.`);
    return new Uint8Array(await res.arrayBuffer());
  }

  private async raw(method: string, id: string, body?: Uint8Array): Promise<Response> {
    try {
      return await fetch(`${this.serverUrl}/api/v1/blobs/${encodeURIComponent(id)}`, {
        method,
        headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${this.token}` },
        body: body as BodyInit | undefined,
        signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch (e) {
      throw new SyncError(0, `Can't reach the sync server (${(e as Error).message}).`);
    }
  }

  pull(since: number) { return this.req<{ records: SealedRecord[]; cursor: number; more: boolean }>('GET', `/records?since=${since}`); }
  push(records: { id: string; kind: string; baseRev: number; updatedAt: number; deleted: boolean; data?: Sealed }[]) {
    return this.req<{ accepted: { id: string; rev: number }[]; conflicts: SealedRecord[] }>('POST', '/records', { records });
  }
}

/** Signs in on a new device: fetches the KDF parameters, derives the auth key locally, and signs in. */
export async function signIn(client: SyncClient, email: string, password: string, secretKey: string, device: string) {
  const { kdf } = await client.prelogin(email);
  const kek = await deriveKek(password, secretKey, kdf);
  const auth = authKeyFrom(kek);
  wipe(kek);
  return client.login(email, auth, device);
}

export interface SyncResult { pulled: number; pushed: number; conflicts: number; filesUp: number; filesDown: number }

/** Files the server holds that no item refers to are only removed after this long, in case another device just uploaded one. */
const ORPHAN_GRACE_MS = 6 * 3600_000;

/** One round: pull everything newer than our cursor, then push local changes. */
export async function syncOnce(store: VaultStore, client: SyncClient, opts: { orphanGraceMs?: number } = {}): Promise<SyncResult> {
  const state = store.syncState;
  if (!state) throw new Error('Sync is not set up.');
  const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, filesUp: 0, filesDown: 0 };

  const pull = async () => {
    for (;;) {
      const page = await client.pull(state.cursor);
      for (const r of page.records) {
        const how = store.mergeRemote(r);
        if (how !== 'skipped') result.pulled++;
        if (how === 'conflict') result.conflicts++;
      }
      state.cursor = page.cursor;
      if (!page.more) break;
    }
  };

  await pull();
  for (let round = 0; round < 5; round++) {
    const dirty = store.records.dirty();
    if (!dirty.length) break;
    for (let i = 0; i < dirty.length; i += 500) {
      const batch = dirty.slice(i, i + 500);
      const res = await client.push(batch.map(r => ({ id: r.id, kind: r.kind, baseRev: r.rev, updatedAt: r.updatedAt, deleted: !!r.deleted, data: r.data })));
      const sent = new Map(batch.map(r => [r.id, r.updatedAt]));
      for (const a of res.accepted) { store.records.markSynced(a.id, a.rev, sent.get(a.id)!); result.pushed++; }
      for (const c of res.conflicts) { if (store.mergeRemote(c) === 'conflict') result.conflicts++; }
    }
  }
  store.writeFile();

  // Attachment files, after the records: a device only uploads a file once the item that refers to it is on the server.
  await syncFiles(store, client, result, opts.orphanGraceMs ?? ORPHAN_GRACE_MS);

  state.lastSyncAt = Date.now();
  store.writeFile();
  return result;
}

async function syncFiles(store: VaultStore, client: SyncClient, result: SyncResult, graceMs: number) {
  const wanted = store.referencedAttachmentIds();
  const { blobs, now } = await client.listBlobs();
  const onServer = new Map(blobs.map(b => [b.id, b]));

  for (const id of wanted) {
    if (store.hasAttachmentFile(id)) {
      if (!onServer.has(id)) { await client.putBlob(id, store.readAttachmentBlob(id)); result.filesUp++; }
    } else if (onServer.has(id)) {
      const blob = await client.getBlob(id);
      if (!blob) continue;
      try { store.writeAttachmentBlob(id, blob); result.filesDown++; } catch { /* damaged or tampered: leave it missing and try again next time */ }
    }
  }

  // Files no item refers to any more: removed or deleted for good, here or on another device.
  for (const b of blobs) {
    if (!wanted.has(b.id) && now - b.createdAt >= graceMs) await client.deleteBlob(b.id);
  }
  store.removeUnreferencedAttachmentFiles();
}
