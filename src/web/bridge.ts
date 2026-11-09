/**
 * The web vault's side of the renderer's API: what the desktop app's main process does, done in the page.
 *
 * The vault lives only in memory. Signing in downloads it from this server, still sealed, and unlocks it here
 * with the account password and Secret Key; locking (or closing the tab) throws it away. Changes go back to
 * the server at once, sealed in the page, so the server never sees anything it couldn't already.
 * Features that need the computer itself (SSH agent, browser extension, Auto-Type, quick unlock) stay in the apps.
 */
import type { Api, ApiEvents, AppState, Bridge, ImportPreview, SyncStatus } from '../core/api';
import { normalizeSecretKey, ready } from '../core/crypto';
import { generatePassword, suggestUsername } from '../core/generator';
import { buildExport, encryptExport, exportCsv, importFile, NeedsPasswordError, type ImportResult } from '../core/importexport';
import { detectPreset, mergeSettings, SECURITY_PRESETS } from '../core/settings';
import { VaultStore, WrongPasswordError } from '../core/store';
import { rateStrength } from '../core/strength';
import {
  initSync, pushNewKeys, reconnect, scheduleSync, signInNewDevice, startSyncLoop, stopSyncLoop, syncNow, syncStatus,
} from '../core/syncLoop';
import { currentTotp } from '../core/totp';
import type { Settings, VaultData, WatchtowerReport } from '../core/types';
import { wipeAll } from './shims/fs';

declare const __VERSION__: string;

const VAULT_DIR = '/vault';
const SETTINGS_KEY = 'boltwork.web.settings';
const APPS_ONLY = 'This needs the Boltwork app on your computer or phone.';

let store: VaultStore | null = null;
let secretKey: string | null = null;
let token = '';
let lastActivity = Date.now();
let clipboardTimer: ReturnType<typeof setTimeout> | null = null;
let pendingImport: { fileName: string; bytes: Uint8Array; result?: ImportResult } | null = null;

let settings: Settings = mergeSettings(readJson(SETTINGS_KEY));

function readJson(key: string): Partial<Settings> | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}

// ---------- events ----------

const listeners = new Map<string, Set<(p: unknown) => void>>();
function emit<E extends keyof ApiEvents>(event: E, payload: ApiEvents[E]) {
  const copy = structuredClone(payload);
  queueMicrotask(() => listeners.get(event)?.forEach(cb => cb(copy)));
}

function state(): AppState {
  return { hasVault: true, locked: !store, needsSecretKey: false, platform: 'web', version: __VERSION__, window: 'main', quickUnlock: { method: null } };
}

/** Vault data as the page shows it: passkeys without their private keys, which the web vault never uses. */
function forPage(data: VaultData): VaultData {
  for (const i of data.items) if (i.passkeys) i.passkeys = i.passkeys.map(p => ({ ...p, privateKey: '' }));
  return data;
}

function requireStore(): VaultStore {
  if (!store) throw new Error('Boltwork is locked.');
  return store;
}

function changed() {
  if (store) emit('data', forPage(store.snapshot()));
  scheduleSync();
}

async function reauth(password: string) {
  if (typeof password !== 'string' || !password) throw new Error('Enter your account password.');
  if (!await requireStore().verifyPassword(password, secretKey!)) throw new WrongPasswordError();
}

// ---------- sync: this server only, with the session token kept in memory ----------

const deviceName = () => {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `Web vault (${browser})`;
};

initSync({
  store: () => store,
  onPulled: () => { if (store) emit('data', forPage(store.snapshot())); },
  deviceName: deviceName(),
  token: { save: t => { token = t; }, load: () => token, clear: () => { token = ''; } },
});

/** Ends the server session too, so a locked tab leaves nothing that can sign in. */
function endSession() {
  if (!token) return;
  void fetch('/api/v1/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` }, keepalive: true }).catch(() => undefined);
  token = '';
}

// ---------- Watchtower, in a worker so rating passwords never freezes the page ----------

let worker: Worker | null = null;
let wtRunning: Promise<WatchtowerReport> | null = null;

function watchtower(): Promise<WatchtowerReport> {
  if (wtRunning) return wtRunning;
  const s = requireStore();
  worker ??= new Worker('watchtower.js');
  const w = worker;
  let lastProgress = 0;
  wtRunning = new Promise<WatchtowerReport>((resolve, reject) => {
    w.onmessage = ({ data: m }) => {
      if (m.type === 'pwned') { if (store === s) s.recordPwned(m.h, m.n); return; }
      if (m.type === 'progress') {
        if (!m.total || m.done === m.total || Date.now() - lastProgress > 150) {
          lastProgress = Date.now();
          emit('watchtowerProgress', m.total && m.done < m.total ? { done: m.done, total: m.total, phase: m.phase } : null);
        }
        return;
      }
      if (m.type === 'done') { emit('watchtowerUpdated', m.report); resolve(m.report); } else reject(new Error(m.message));
    };
    w.onerror = e => reject(new Error(e.message || 'Watchtower stopped.'));
    w.postMessage({
      data: s.snapshot(), now: Date.now(),
      enabled: { vulnerable: settings.checkVulnerable, compromised: settings.checkCompromisedSites, twoFactor: settings.check2faSites },
    });
  }).finally(() => { emit('watchtowerProgress', null); wtRunning = null; });
  return wtRunning;
}

// ---------- files in and out of the page ----------

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

function download(name: string, data: BlobPart, type = 'application/octet-stream'): string {
  const url = URL.createObjectURL(new Blob([data], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', pdf: 'application/pdf', txt: 'text/plain' };

// ---------- lock ----------

async function lock() {
  if (!store) return;
  const s = store;
  // Changes not yet on the server would be lost with the page's copy, so send them first.
  if (s.records.dirty().length && !syncStatus().signedOut) await Promise.race([syncNow(), new Promise(r => setTimeout(r, 5000))]);
  stopSyncLoop();
  worker?.terminate();
  worker = null;
  endSession();
  s.lock();
  store = null;
  secretKey = null;
  pendingImport = null;
  wipeAll();
  if (clipboardTimer) { clearTimeout(clipboardTimer); clipboardTimer = null; void navigator.clipboard.writeText('').catch(() => undefined); }
  emit('state', state());
}

const IDLE_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
for (const e of IDLE_EVENTS) window.addEventListener(e, () => { lastActivity = Date.now(); }, { passive: true, capture: true });
setInterval(() => {
  if (store && settings.autolockMinutes > 0 && Date.now() - lastActivity > settings.autolockMinutes * 60_000) void lock();
}, 15_000);
window.addEventListener('beforeunload', e => { if (store?.records.dirty().length) e.preventDefault(); });
window.addEventListener('pagehide', () => endSession());

// ---------- the API ----------

type Handlers = { [M in keyof Api]: (...a: Parameters<Api[M]>) => ReturnType<Api[M]> | Promise<ReturnType<Api[M]>> };
const appsOnly = () => { throw new Error(APPS_ONLY); };

const handlers: Handlers = {
  getState: () => state(),
  createVault: () => { throw new Error('Create your vault in a Boltwork app, then turn on sync to this server.'); },
  unlock: () => { throw new Error('Sign in with your email, account password and Secret Key.'); },
  unlockQuick: appsOnly,
  quickUnlockStatus: () => ({ method: null, helloAvailable: false }),
  quickUnlockEnable: appsOnly,
  quickUnlockDisable: () => ({ method: null, helloAvailable: false }),
  lock: () => lock(),
  getData: () => forPage(requireStore().snapshot()),

  saveItem: input => { const i = requireStore().saveItem(input); changed(); return i; },
  duplicateItem: id => { const i = requireStore().duplicateItem(id); changed(); return i; },
  restoreVersion: (id, idx) => { const i = requireStore().restoreVersion(id, idx); changed(); return i; },
  setFavorite: (id, f) => { requireStore().setFavorite(id, f); changed(); },
  archive: id => { requireStore().archive(id); changed(); },
  trash: id => { requireStore().trash(id); changed(); },
  restore: id => { requireStore().restore(id); changed(); },
  purge: id => { requireStore().purge(id); changed(); },
  emptyTrash: () => { const n = requireStore().emptyTrash(0); changed(); return n; },
  move: (id, v) => { requireStore().move(id, v); changed(); },
  setWatchtowerIgnore: (id, ig) => { requireStore().setWatchtowerIgnore(id, ig); changed(); },
  markUsed: id => { requireStore().markUsed(id); changed(); },

  saveVault: v => { const r = requireStore().saveVault(v); changed(); return r; },
  deleteVault: (id, to) => { requireStore().deleteVault(id, to); changed(); },
  saveCollection: c => { const r = requireStore().saveCollection(c); changed(); return r; },
  deleteCollection: id => { requireStore().deleteCollection(id); changed(); },
  renameTag: (a, b) => { requireStore().renameTag(a, b); changed(); },

  addAttachments: async itemId => {
    const s = requireStore();
    const files = await pickFiles('', true);
    for (const f of files) {
      if (f.size > 100 * 1024 * 1024) throw new Error(`${f.name} is larger than 100 MB.`);
      s.addAttachment(itemId, f.name, f.type || MIME[f.name.split('.').pop()!.toLowerCase()] || 'application/octet-stream', new Uint8Array(await f.arrayBuffer()));
    }
    if (files.length) changed();
    return files.length;
  },
  saveAttachment: async (itemId, attId) => {
    const s = requireStore();
    if (!s.hasAttachmentFile(attId)) {
      await syncNow();
      if (!s.hasAttachmentFile(attId)) throw new Error('That file hasn’t reached the server yet. Try again in a moment.');
    }
    const { meta, bytes } = s.readAttachment(itemId, attId);
    download(meta.name, bytes as Uint8Array<ArrayBuffer>, meta.mime);
    return true;
  },
  removeAttachment: (itemId, attId) => { requireStore().removeAttachment(itemId, attId); changed(); },
  removePasskey: (itemId, credentialId) => { requireStore().removePasskey(itemId, credentialId); changed(); },

  generate: options => { const password = generatePassword(options); return { password, strength: rateStrength(password) }; },
  rateStrength: pw => rateStrength(pw),
  suggestUsername: () => suggestUsername(),
  totp: value => { try { return currentTotp(value); } catch (e) { return { error: (e as Error).message }; } },
  watchtower: () => watchtower(),

  copy: async (text, secret) => {
    await navigator.clipboard.writeText(text);
    if (clipboardTimer) clearTimeout(clipboardTimer);
    clipboardTimer = null;
    if (!secret || settings.clipboardClearSeconds <= 0) return;
    clipboardTimer = setTimeout(() => {
      clipboardTimer = null;
      // The page can't check what's on the clipboard without asking, so it clears it outright.
      void navigator.clipboard.writeText('').catch(() => undefined);
    }, settings.clipboardClearSeconds * 1000);
  },
  getSettings: () => settings,
  setSettings: patch => saveSettings(patch),
  applyPreset: name => saveSettings({ ...SECURITY_PRESETS[name].values, securityPreset: name }),

  importChoose: async () => {
    const [file] = await pickFiles('.csv,.json,.1pux', false);
    if (!file) return null;
    pendingImport = { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    return await previewImport();
  },
  importPreview: password => previewImport(password),
  importCommit: vaultId => {
    const s = requireStore();
    const result = pendingImport?.result;
    if (!result) throw new Error('Choose a file to import first.');
    let count = 0;
    if (vaultId === 'byName') {
      const groups = new Map<string, typeof result.items>();
      for (const it of result.items) groups.set(it.vaultName ?? 'Imported', [...(groups.get(it.vaultName ?? 'Imported') ?? []), it]);
      for (const [name, items] of groups) {
        const existing = s.snapshot().vaults.find(v => v.name === name) ?? s.saveVault({ name });
        count += s.importItems(items, existing.id);
      }
    } else count = s.importItems(result.items, vaultId);
    pendingImport = null;
    changed();
    return count;
  },
  exportData: async (format, accountPassword, exportPassword) => {
    await reauth(accountPassword);
    const { vaults, items } = requireStore().snapshot();
    const name = `Boltwork Export ${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'json'}`;
    if (format === 'csv') return download(name, exportCsv(vaults, items), 'text/csv');
    if (format === 'json') return download(name, JSON.stringify(buildExport(vaults, items), null, 2), 'application/json');
    if (!exportPassword || exportPassword.length < 8) throw new Error('Use an export password of at least 8 characters.');
    return download(name, JSON.stringify(await encryptExport(buildExport(vaults, items), exportPassword)), 'application/json');
  },
  emergencyKit: appsOnly,
  changePassword: async (oldPw, newPw) => {
    const s = requireStore();
    const auth = await s.changePassword(oldPw, newPw, secretKey!);
    try { await pushNewKeys(s, auth); } catch (e) {
      throw new Error(`The sync server couldn’t be updated (${(e as Error).message}), so the password hasn’t changed anywhere else. Try again.`);
    }
  },
  revealSecretKey: async pw => { await reauth(pw); return secretKey!; },

  largeType: appsOnly,
  getLargeTypeText: () => '',
  getPasskeyPrompt: () => null,
  answerPasskeyPrompt: () => undefined,
  fitPasskeyPrompt: () => undefined,
  openUrl: url => {
    const u = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    if (!/^https?:\/\//i.test(u)) throw new Error('Only web addresses can be opened.');
    window.open(u, '_blank', 'noopener,noreferrer');
  },
  scanQrFromScreen: appsOnly,
  addSearchHistory: q => { requireStore().addSearchHistory(q); },
  clearSearchHistory: () => { requireStore().clearSearchHistory(); changed(); },

  sshGenerate: appsOnly,
  sshImport: appsOnly,
  sshExport: (itemId, which) => {
    const item = requireStore().getItem(itemId);
    const f = (id: string) => item.fields.find(x => x.id === id)?.value ?? '';
    if (item.category !== 'sshKey' || !f('privateKey')) throw new Error('This item has no SSH key.');
    const base = item.title.replace(/[^\w.-]+/g, '_').toLowerCase() || 'id_boltwork';
    return which === 'private' ? download(base, f('privateKey'), 'text/plain') : download(`${base}.pub`, `${f('publicKey')}\n`, 'text/plain');
  },
  sshAgentStatus: () => ({ enabled: false, running: false, socket: '', keys: [] }),
  browserStatus: () => ({ enabled: false, running: false, registered: [], extensionId: '', extensionFolder: '', pairings: [] }),
  syncStatus: (): SyncStatus => syncStatus(),
  syncCheckServer: appsOnly,
  syncSetup: appsOnly,
  syncSignIn: async (_url, email, password, secretKeyInput) => {
    if (store) return;
    const sk = normalizeSecretKey(secretKeyInput);
    wipeAll();
    // Always this server: the page came from it, and it's the only one the page may talk to.
    store = await signInNewDevice(VAULT_DIR, location.origin, email, password, sk);
    store.historyLimit = settings.historyLimit;
    secretKey = sk;
    lastActivity = Date.now();
    if (settings.emptyTrashDays > 0) store.emptyTrash(settings.emptyTrashDays);
    emit('state', state());
    startSyncLoop();
  },
  syncNow: async () => { await syncNow(); return syncStatus(); },
  syncReconnect: async password => { await reconnect(requireStore(), password, secretKey!); changed(); return syncStatus(); },
  syncDisconnect: () => { throw new Error('The web vault always syncs with this server. Use Lock to sign out.'); },
  // The page came from this server and only talks to it.
  syncSetBackup: appsOnly,
  browserRevoke: () => undefined,
  browserShowExtensionFolder: appsOnly,
  passkeyProviderStatus: () => ({ installed: false, serving: false }),
  passkeyProviderRegister: appsOnly,
  passkeyProviderUnregister: appsOnly,
  openWindowsPasskeySettings: appsOnly,

  quickAccessAction: appsOnly,
  hideQuickAccess: () => undefined,
  showMain: () => undefined,
};

function saveSettings(patch: Partial<Settings>): Settings {
  settings = mergeSettings({ ...settings, ...patch });
  if (!('securityPreset' in patch)) settings.securityPreset = detectPreset(settings);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private window: settings last until the tab closes */ }
  if (store) store.historyLimit = settings.historyLimit;
  emit('settings', settings);
  return settings;
}

async function previewImport(password?: string): Promise<ImportPreview> {
  if (!pendingImport) throw new Error('Choose a file to import first.');
  try {
    const result = await importFile(pendingImport.fileName, pendingImport.bytes, password);
    pendingImport.result = result;
    const vaultNames = [...new Set(result.items.map(i => i.vaultName).filter((n): n is string => !!n))];
    return { fileName: pendingImport.fileName, needsPassword: false, source: result.source, count: result.items.length, newCount: requireStore().countNewItems(result.items), skipped: result.skipped, vaultNames };
  } catch (e) {
    if (e instanceof NeedsPasswordError) return { fileName: pendingImport.fileName, needsPassword: true };
    throw e;
  }
}

const sodiumReady = ready();

export const bridge: Bridge = {
  call: async (method, ...args) => {
    await sodiumReady;
    lastActivity = Date.now();
    const fn = handlers[method] as ((...a: unknown[]) => unknown) | undefined;
    if (!fn) throw new Error(`Unknown method ${String(method)}`);
    try {
      return structuredClone(await fn(...args)) as never;
    } catch (e) {
      throw new Error((e as Error).message ?? String(e));
    }
  },
  on: (event, cb) => {
    let set = listeners.get(event);
    if (!set) listeners.set(event, set = new Set());
    const fn = cb as (p: unknown) => void;
    set.add(fn);
    return () => { set.delete(fn); };
  },
};
