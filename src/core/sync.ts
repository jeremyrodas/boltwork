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

export function normalizeServerUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const url = new URL(u);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  if (url.protocol === 'http:' && !local) throw new Error('Use an https:// address. Plain http is only allowed for localhost.');
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

export interface SyncResult { pulled: number; pushed: number; conflicts: number }

/** One round: pull everything newer than our cursor, then push local changes. */
export async function syncOnce(store: VaultStore, client: SyncClient): Promise<SyncResult> {
  const state = store.syncState;
  if (!state) throw new Error('Sync is not set up.');
  const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0 };

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
  state.lastSyncAt = Date.now();
  store.writeFile();
  return result;
}
