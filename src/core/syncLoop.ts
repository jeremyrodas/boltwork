/**
 * Runs sync for an unlocked vault: after changes, every minute, on unlock, and as soon as the server says
 * another device changed something. Used by the desktop app and the web vault, which keep the session token
 * in their own ways.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SyncStatus } from './api';
import { syncAddresses, VaultStore } from './store';
import { normalizeServerUrl, signIn, SyncClient, SyncError, syncOnce } from './sync';

export interface SyncHost {
  store: () => VaultStore | null;
  /** Called when a sync brought in changes, so windows refresh. */
  onPulled: () => void;
  /** How this device appears in the account's device list. */
  deviceName: string;
  /** Keeps the sync session token (the app encrypts it with the system; the web vault keeps it in memory). */
  token: { save(token: string): void; load(): string; clear(): void };
}

let host: SyncHost;
let timer: NodeJS.Timeout | null = null;
let debounce: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let again = false;
let status: { syncing: boolean; error?: string; signedOut?: boolean } = { syncing: false };

const deviceName = () => host.deviceName;
const saveToken = (token: string) => host.token.save(token);
const loadToken = () => host.token.load();

export function initSync(h: SyncHost) { host = h; }

/** The address the last sync used; the wait for changes goes there too. */
let activeUrl: string | null = null;

/** A client for this vault's server: the main address if it answers, otherwise the backup address. */
async function clientFor(store: VaultStore): Promise<SyncClient> {
  const client = await SyncClient.reachable(syncAddresses(store.syncState!), loadToken());
  activeUrl = client.serverUrl;
  return client;
}

export function syncStatus(): SyncStatus {
  const s = host.store();
  const st = s?.syncState;
  return {
    configured: !!st, serverUrl: st?.serverUrl, backupUrl: st?.backupUrl, usingBackup: !!st?.backupUrl && activeUrl === st.backupUrl,
    email: st?.email, lastSyncAt: st?.lastSyncAt, ...status,
  };
}

/** Runs a sync now (or right after the one in progress). */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  const store = host.store();
  if (!store?.syncState || status.signedOut) return Promise.resolve();
  status = { syncing: true };
  running = (async () => {
    try {
      const r = await syncOnce(store, await clientFor(store));
      status = { syncing: false };
      if (r.pulled) host.onPulled();
    } catch (e) {
      const signedOut = e instanceof SyncError && e.status === 401;
      status = { syncing: false, signedOut, error: signedOut ? 'Signed out of the sync server (password changed on another device, or the session expired). Sign in again.' : (e as Error).message };
    } finally {
      running = null;
      if (again) { again = false; void syncNow(); }
    }
  })();
  return running;
}

/** Call after local changes; syncs shortly after the last one. */
export function scheduleSync() {
  if (!host.store()?.syncState) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { void syncNow(); }, 500);
}

export function startSyncLoop() {
  stopSyncLoop();
  if (!host.store()?.syncState) return;
  // Live updates do the real work; this is the fallback for servers without them, or a connection that drops quietly.
  timer = setInterval(() => { void syncNow(); }, 60_000);
  void syncNow().then(() => watchForChanges());
}

export function stopSyncLoop() {
  activeUrl = null;
  if (timer) clearInterval(timer);
  if (debounce) clearTimeout(debounce);
  timer = debounce = null;
  watch?.abort();
  watch = null;
}

let watch: AbortController | null = null;
const pause = (ms: number, signal: AbortSignal) => new Promise<void>(r => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

/**
 * Keeps a request open to the server, which answers as soon as another device changes something,
 * so changes show up here within a second or two instead of at the next timed sync.
 */
function watchForChanges() {
  watch?.abort();
  const ac = new AbortController();
  watch = ac;
  void (async () => {
    let backoff = 5_000;
    while (!ac.signal.aborted) {
      const store = host.store();
      if (!store?.syncState || status.signedOut) return;
      try {
        const r = await new SyncClient(activeUrl ?? store.syncState.serverUrl, loadToken()).waitForChanges(store.syncState.cursor, 25, ac.signal);
        backoff = 5_000;
        if (r.changed) {
          await syncNow();
          // If that sync failed, don't spin: the server will keep saying there's something new.
          if (status.error) await pause(15_000, ac.signal);
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof SyncError && e.status === 401) { void syncNow(); return; } // syncNow reports the sign-out
        if (e instanceof SyncError && e.status === 404) return; // an older server without live updates: timed syncs still run
        await pause(backoff, ac.signal);
        backoff = Math.min(backoff * 2, 120_000);
      }
    }
  })();
}

export async function checkServer(url: string) {
  const serverUrl = normalizeServerUrl(url);
  const h = await new SyncClient(serverUrl).health();
  if (h.name !== 'strongroom-server') throw new Error('That address isn’t a Boltwork sync server.');
  return { serverUrl, signups: h.signups };
}

/** Turns on sync for this vault by creating an account on the server and uploading everything. */
export async function setupSync(store: VaultStore, url: string, email: string, password: string, secretKey: string) {
  const serverUrl = normalizeServerUrl(url);
  const client = new SyncClient(serverUrl);
  const auth = await store.authKey(password, secretKey);
  try {
    await client.signup(email.trim().toLowerCase(), auth, store.keyset(), deviceName());
  } catch (e) {
    if (!(e instanceof SyncError && e.status === 409)) throw e;
    // The email already has an account: fine if it's this same vault (e.g. sync was turned off and on again).
    const remote = await client.login(email.trim().toLowerCase(), auth, deviceName()).catch(() => null);
    if (!remote || remote.accountId !== store.accountId) {
      throw new Error('That email already has a different vault on this server. To use it here, sign in from a fresh install instead.');
    }
  }
  saveToken(client.token);
  store.syncState = { serverUrl, email: email.trim().toLowerCase(), cursor: 0 };
  store.writeFile();
  status = { syncing: false };
  startSyncLoop();
  await running;
}

/** Signs in again after being signed out (e.g. the password was changed on another device). */
export async function reconnect(store: VaultStore, password: string, secretKey: string) {
  const st = store.syncState;
  if (!st) throw new Error('Sync is not set up.');
  const client = await SyncClient.reachable(syncAddresses(st));
  const remote = await signIn(client, st.email, password, secretKey, deviceName());
  if (remote.accountId !== store.accountId) throw new Error('That sync account belongs to a different vault.');
  saveToken(client.token);
  status = { syncing: false };
  startSyncLoop();
  await running;
}

/** Sets up a brand-new device from the server. Returns the unlocked store. */
export async function signInNewDevice(dir: string, url: string, email: string, password: string, secretKey: string): Promise<VaultStore> {
  const serverUrl = normalizeServerUrl(url);
  const client = new SyncClient(serverUrl);
  const e = email.trim().toLowerCase();
  const remote = await signIn(client, e, password, secretKey, deviceName());
  const store = await VaultStore.createFromRemote(dir, password, secretKey, remote, { serverUrl, email: e, cursor: 0 });
  try {
    saveToken(client.token);
    await syncOnce(store, client);
  } catch (err) {
    // Don't leave a half-downloaded vault behind; the user can simply try again.
    store.lock();
    for (const f of ['vault.json', 'vault.json.bak']) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* not there */ } }
    host.token.clear();
    throw err;
  }
  return store;
}

/** After a password change on this device: give the server the new auth key and re-wrapped master key. */
export async function pushNewKeys(store: VaultStore, authKey: Uint8Array) {
  if (!store.syncState) return;
  const ks = store.keyset();
  await (await clientFor(store)).updateKeys(authKey, ks.kdf, ks.wrappedKey);
}

/** Stops syncing this vault. Local data stays; the server copy stays until the account is deleted. */
export async function disconnectSync(store: VaultStore, deleteAccount: boolean) {
  if (store.syncState) {
    const client = await clientFor(store).catch(() => new SyncClient(store.syncState!.serverUrl, loadToken()));
    try { await (deleteAccount ? client.deleteAccount() : client.logout()); } catch (e) { if (deleteAccount) throw e; }
  }
  stopSyncLoop();
  host.token.clear();
  store.syncState = undefined;
  // Forget server revisions so a future setup uploads everything again.
  for (const r of store.records.all()) { r.rev = 0; r.dirty = true; }
  store.writeFile();
  status = { syncing: false };
}

/**
 * Sets or clears this device's backup address for the server. It must lead to the same server: this device's
 * session has to work there, for the same account.
 */
export async function setBackupAddress(store: VaultStore, input: string | null) {
  const st = store.syncState;
  if (!st) throw new Error('Sync is not set up.');
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    delete st.backupUrl;
  } else {
    const address = normalizeServerUrl(trimmed);
    if (address === st.serverUrl) throw new Error('That’s already the server’s main address.');
    const different = new Error(`${address} is a different sync server. Use an address that leads to the same server as ${st.serverUrl}.`);
    let account: { email: string };
    try {
      account = await new SyncClient(address, loadToken()).account();
    } catch (e) {
      if (e instanceof SyncError && e.status === 401) throw different;
      throw e;
    }
    if (account.email.toLowerCase() !== st.email.toLowerCase()) throw different;
    st.backupUrl = address;
  }
  activeUrl = null;
  store.writeFile();
  void syncNow();
}
