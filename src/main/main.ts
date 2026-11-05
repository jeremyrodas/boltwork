import {
  app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, Notification, powerMonitor,
  safeStorage, screen, shell, Tray, type MenuItemConstructorOptions, type WebContents,
} from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsQR from 'jsqr';
import type { Api, ApiEvents, AppState, ImportPreview, QuickAccessAction } from '../core/api';
import { generateSecretKey, normalizeSecretKey, ready } from '../core/crypto';
import { generatePassword, suggestUsername } from '../core/generator';
import { buildExport, encryptExport, exportCsv, importFile, NeedsPasswordError, type ImportResult } from '../core/importexport';
import { detectPreset, mergeSettings, SECURITY_PRESETS } from '../core/settings';
import { vaultExists, VaultStore, WrongPasswordError } from '../core/store';
import { rateStrength } from '../core/strength';
import { fieldByPurpose } from '../core/templates';
import { currentTotp } from '../core/totp';
import type { Settings } from '../core/types';
import { runWatchtower } from '../core/watchtower';
import { makeIcon } from './icon';
import { onlineChecks } from './online';
import { initSshAgent, setSshAgentEnabled, sshAgentLocked, sshAgentStatus } from './sshAgentHost';
import { browserHostStatus, getBridge, registerNativeHost, startBrowserHost, stopBrowserHost } from './browserHost';
import {
  checkServer, disconnectSync, initSync, pushNewKeys, reconnect, scheduleSync, setupSync, signInNewDevice, startSyncLoop,
  stopSyncLoop, syncNow, syncStatus,
} from './syncHost';
import { generateSshKey, importSshKey } from '../core/ssh';
import { repairSshItems } from '../core/sshRepair';
import { QuickUnlock, QuickUnlockError } from '../core/quickUnlock';
import { helloAvailable, helloDelete, helloSign } from './hello';

// ---------- single instance & CLI ----------

// Separate profiles (e.g. for testing): STRONGROOM_PROFILE=C:\path\to\dir
if (process.env.STRONGROOM_PROFILE) app.setPath('userData', process.env.STRONGROOM_PROFILE);

const argv = process.argv.slice(1);
if (!app.requestSingleInstanceLock({ argv })) {
  app.quit();
  process.exit(0);
}

const userData = app.getPath('userData');
const vaultDir = path.join(userData, 'vault');
const settingsFile = path.join(userData, 'settings.json');
const deviceFile = path.join(userData, 'device.json');
const cacheDir = path.join(userData, 'cache');

let store: VaultStore | null = null;
let settings: Settings = mergeSettings(readJson(settingsFile));
let secretKeyInMemory: string | null = null;
let mainWin: BrowserWindow | null = null;
let quickWin: BrowserWindow | null = null;
let largeTypeWin: BrowserWindow | null = null;
let largeTypeText = '';
let tray: Tray | null = null;
let quitting = false;
let lastCopied: { text: string; timer: NodeJS.Timeout } | null = null;
let pendingImport: { fileName: string; bytes: Uint8Array; result?: ImportResult } | null = null;

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}

// ---------- Secret Key storage (OS-protected: DPAPI on Windows, Keychain on macOS, libsecret on Linux) ----------

function storedSecretKey(): string | null {
  const d = readJson<{ secretKey?: string; plain?: string }>(deviceFile);
  if (d?.secretKey && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(d.secretKey, 'base64')); } catch { return null; }
  }
  return null;
}

function rememberSecretKey(sk: string) {
  if (!safeStorage.isEncryptionAvailable()) return; // fall back to asking for it at every unlock
  fs.writeFileSync(deviceFile, JSON.stringify({ secretKey: safeStorage.encryptString(sk).toString('base64') }));
}

// ---------- events ----------

function allWindows(): BrowserWindow[] {
  return [mainWin, quickWin, largeTypeWin].filter((w): w is BrowserWindow => !!w && !w.isDestroyed());
}

function emit<E extends keyof ApiEvents>(event: E, payload: ApiEvents[E]) {
  for (const w of allWindows()) w.webContents.send(`event:${event}`, payload);
}

function windowKind(wc: WebContents | null): AppState['window'] {
  if (quickWin && wc === quickWin.webContents) return 'quickAccess';
  if (largeTypeWin && wc === largeTypeWin.webContents) return 'largeType';
  return 'main';
}

function state(wc: WebContents | null = null): AppState {
  return {
    hasVault: vaultExists(vaultDir),
    locked: !store,
    needsSecretKey: !secretKeyInMemory && !storedSecretKey(),
    platform: process.platform,
    version: app.getVersion(),
    window: windowKind(wc),
    quickUnlock: quickStatus(),
  };
}

function broadcastState() {
  for (const w of allWindows()) w.webContents.send('event:state', state(w.webContents));
  updateTray();
}

function changed() {
  if (store) emit('data', store.snapshot());
  scheduleSync();
}

function requireStore(): VaultStore {
  if (!store) throw new Error('Strongroom is locked.');
  return store;
}

function currentSecretKey(): string {
  const sk = secretKeyInMemory ?? storedSecretKey();
  if (!sk) throw new Error('Secret Key not available on this device.');
  return sk;
}

// ---------- lock / unlock ----------

function lock() {
  if (!store) return;
  stopSyncLoop();
  store.lock();
  store = null;
  sshAgentLocked();
  if (lastCopied) {
    const { text, timer } = lastCopied;
    clearTimeout(timer);
    void clipboard.readText().then(t => { if (t === text) clipboard.clear(); });
  }
  lastCopied = null;
  quickWin?.hide();
  largeTypeWin?.close();
  broadcastState();
}

let lastActivity = Date.now();
setInterval(() => {
  if (!store || settings.autolockMinutes <= 0) return;
  const idleMs = Math.min(powerMonitor.getSystemIdleTime() * 1000, Date.now() - lastActivity);
  if (idleMs >= settings.autolockMinutes * 60_000) lock();
}, 10_000);

// ---------- clipboard ----------

function copy(text: string, secret: boolean) {
  clipboard.writeText(text);
  if (lastCopied) clearTimeout(lastCopied.timer);
  lastCopied = null;
  if (!secret || settings.clipboardClearSeconds <= 0) return;
  const timer = setTimeout(async () => {
    if ((await clipboard.readText()) === text) {
      clipboard.clear();
      if (settings.notifyClipboardCleared && Notification.isSupported()) {
        new Notification({ title: 'Strongroom', body: 'Copied item cleared from the clipboard.', silent: true }).show();
      }
    }
    lastCopied = null;
  }, settings.clipboardClearSeconds * 1000);
  lastCopied = { text, timer };
}

// ---------- auto-type (Windows) ----------

/** Escapes text for System.Windows.Forms.SendKeys. */
function sendKeysEscape(s: string): string {
  return s.replace(/[+^%~(){}[\]]/g, c => `{${c}}`).replace(/\r?\n/g, '{ENTER}');
}

function autoType(sequence: string): Promise<void> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Auto-Type is currently available on Windows only.'));
  return new Promise((resolve, reject) => {
    // The keystrokes are passed on stdin so they never appear in a process command line.
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::InputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $s=[Console]::In.ReadToEnd(); Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait($s)'],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    ps.stderr.on('data', d => { err += d; });
    ps.on('error', reject);
    ps.on('exit', code => (code === 0 ? resolve() : reject(new Error(err || `Auto-Type failed (${code}).`))));
    ps.stdin.end(sequence, 'utf8');
  });
}

// ---------- windows ----------

const preload = path.join(__dirname, 'preload.js');
const indexHtml = path.join(__dirname, 'index.html');

function hardenWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.setContentProtection(settings.screenCaptureProtection);
  win.webContents.on('before-input-event', () => { lastActivity = Date.now(); });
}

function createMainWindow(show = true) {
  mainWin = new BrowserWindow({
    width: 1180, height: 760, minWidth: 820, minHeight: 520, show: false, title: 'Strongroom',
    icon: makeIcon(256), backgroundColor: '#111318', autoHideMenuBar: true,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  hardenWindow(mainWin);
  mainWin.loadFile(indexHtml, { hash: 'main' });
  mainWin.once('ready-to-show', () => { if (show) mainWin?.show(); mainWin?.webContents.setZoomFactor(settings.zoom); });
  mainWin.on('close', e => {
    if (!quitting && settings.keepInTray) {
      e.preventDefault();
      mainWin?.hide();
      if (settings.lockOnTrayClose) lock();
    }
  });
  mainWin.on('closed', () => { mainWin = null; });
}

function showMain(route?: string) {
  if (!mainWin) createMainWindow();
  mainWin!.show();
  if (mainWin!.isMinimized()) mainWin!.restore();
  mainWin!.focus();
  if (route) mainWin!.webContents.send('event:navigate', route);
}

function toggleMain() {
  if (mainWin?.isVisible() && mainWin.isFocused()) mainWin.hide();
  else showMain();
}

function createQuickAccess() {
  quickWin = new BrowserWindow({
    width: 680, height: 460, show: false, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    transparent: false, backgroundColor: '#16181d', title: 'Strongroom Quick Access',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  hardenWindow(quickWin);
  quickWin.loadFile(indexHtml, { hash: 'quickAccess' });
  quickWin.on('blur', () => quickWin?.hide());
  quickWin.on('closed', () => { quickWin = null; });
}

function toggleQuickAccess() {
  if (!quickWin) createQuickAccess();
  if (quickWin!.isVisible()) { quickWin!.hide(); return; }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  quickWin!.setBounds({ x: Math.round(x + (width - 680) / 2), y: Math.round(y + height * 0.22), width: 680, height: 460 });
  quickWin!.show();
  quickWin!.focus();
  quickWin!.webContents.send('event:quickAccessShown', null);
}

function showLargeType(text: string) {
  largeTypeText = text;
  largeTypeWin?.close();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = Math.min(display.workArea.width - 80, Math.max(480, text.length * 64 + 80));
  largeTypeWin = new BrowserWindow({
    width, height: 280, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, backgroundColor: '#0b0c10',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  hardenWindow(largeTypeWin);
  largeTypeWin.loadFile(indexHtml, { hash: 'largeType' });
  largeTypeWin.on('blur', () => largeTypeWin?.close());
  largeTypeWin.on('closed', () => { largeTypeWin = null; largeTypeText = ''; });
}

// ---------- tray & menu ----------

function updateTray() {
  if (!tray) return;
  tray.setImage(makeIcon(16, !store));
  tray.setToolTip(store ? 'Strongroom (unlocked)' : 'Strongroom (locked)');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Strongroom', click: () => showMain() },
    { label: 'Quick Access', accelerator: settings.quickAccessShortcut, click: toggleQuickAccess },
    { label: 'New Item', enabled: !!store, click: () => showMain('/new') },
    { label: 'Password Generator', enabled: !!store, click: () => showMain('/generator') },
    { type: 'separator' },
    store ? { label: 'Lock', accelerator: settings.lockShortcut, click: lock } : { label: 'Unlock…', click: () => showMain() },
    { label: 'Settings', click: () => showMain('/settings') },
    { type: 'separator' },
    { label: 'Quit Strongroom', click: () => { quitting = true; app.quit(); } },
  ]));
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [
      { label: 'New Item', accelerator: 'CommandOrControl+N', click: () => showMain('/new') },
      { label: 'Import…', click: () => showMain('/settings/import') },
      { label: 'Export…', click: () => showMain('/settings/export') },
      { type: 'separator' },
      { label: 'Lock', accelerator: settings.lockShortcut, click: lock },
      { label: 'Close Window', accelerator: 'CommandOrControl+W', role: 'close' },
      { label: 'Quit', accelerator: 'CommandOrControl+Q', click: () => { quitting = true; app.quit(); } },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Quick Access', accelerator: settings.quickAccessShortcut, click: toggleQuickAccess },
      { label: 'Watchtower', click: () => showMain('/watchtower') },
      { label: 'Password Generator', accelerator: 'CommandOrControl+G', click: () => showMain('/generator') },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
    ] },
    { label: 'Help', submenu: [
      { label: 'Keyboard Shortcuts', click: () => showMain('/settings/shortcuts') },
      { label: 'About Strongroom', click: () => showMain('/settings/about') },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const reg = (acc: string, fn: () => void) => { try { if (acc) globalShortcut.register(acc, fn); } catch { /* invalid accelerator */ } };
  reg(settings.quickAccessShortcut, toggleQuickAccess);
  reg(settings.showShortcut, toggleMain);
  reg(settings.lockShortcut, lock);
}

function applySettingsSideEffects(prev: Settings) {
  if (prev.quickAccessShortcut !== settings.quickAccessShortcut || prev.showShortcut !== settings.showShortcut || prev.lockShortcut !== settings.lockShortcut) {
    registerShortcuts();
    buildMenu();
    updateTray();
  }
  if (prev.screenCaptureProtection !== settings.screenCaptureProtection) allWindows().forEach(w => w.setContentProtection(settings.screenCaptureProtection));
  if (prev.zoom !== settings.zoom) mainWin?.webContents.setZoomFactor(settings.zoom);
  if (prev.startAtLogin !== settings.startAtLogin && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, args: ['--silent'] });
  }
  if (store) store.historyLimit = settings.historyLimit;
  if (prev.sshAgentEnabled !== settings.sshAgentEnabled) void setSshAgentEnabled(settings.sshAgentEnabled);
  if (prev.browserIntegration !== settings.browserIntegration) void setBrowserIntegration(settings.browserIntegration);
}

function saveSettings(patch: Partial<Settings>): Settings {
  const prev = settings;
  settings = mergeSettings({ ...settings, ...patch });
  if (!('securityPreset' in patch)) settings.securityPreset = detectPreset(settings);
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  applySettingsSideEffects(prev);
  emit('settings', settings);
  return settings;
}

// ---------- QR from screen ----------

async function scanQrFromScreen(): Promise<string | null> {
  const wasVisible = mainWin?.isVisible();
  mainWin?.hide();
  await new Promise(r => setTimeout(r, 250));
  try {
    for (const display of screen.getAllDisplays()) {
      const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      for (const src of sources) {
        const img = src.thumbnail;
        const { width, height } = img.getSize();
        const bgra = img.toBitmap();
        const rgba = new Uint8ClampedArray(bgra.length);
        for (let i = 0; i < bgra.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = 255; }
        const found = jsQR(rgba, width, height);
        if (found?.data) return found.data;
      }
    }
    return null;
  } finally {
    if (wasVisible) showMain();
  }
}

// ---------- Emergency Kit ----------

function emergencyKitHtml(secretKey: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:Segoe UI,system-ui,sans-serif;margin:48px;color:#111}h1{margin:0 0 4px;font-size:28px}
  .sub{color:#555;margin-bottom:28px}.box{border:2px solid #84621c;border-radius:12px;padding:18px 22px;margin:18px 0}
  .label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#84621c;font-weight:700}
  .key{font-family:Consolas,monospace;font-size:24px;letter-spacing:.06em;margin-top:6px}
  .blank{border-bottom:1px solid #999;height:34px}.small{font-size:13px;color:#444;line-height:1.5}</style></head><body>
  <h1>Strongroom Emergency Kit</h1><div class="sub">Created ${esc(new Date().toLocaleString())} on ${esc(os.hostname())}</div>
  <div class="box"><div class="label">Secret Key</div><div class="key">${esc(secretKey)}</div></div>
  <div class="box"><div class="label">Account password</div><div class="blank"></div>
  <div class="small">Write your account password here by hand, or keep it somewhere else safe.</div></div>
  <div class="small"><p>You need <b>both</b> your account password and your Secret Key to unlock Strongroom on a new device or after reinstalling.
  Nobody, including the makers of Strongroom, can recover them for you.</p><p>Print this page and store it somewhere safe, like a fireproof box. Do not keep it on this computer.</p>
  <p>Your vault file is stored at: <code>${esc(vaultDir)}</code>. Back up that folder to keep a copy of your data.</p></div></body></html>`;
}

async function saveEmergencyKit(): Promise<string | null> {
  const sk = currentSecretKey();
  const { filePath, canceled } = await dialog.showSaveDialog(mainWin!, { title: 'Save Emergency Kit', defaultPath: 'Strongroom Emergency Kit.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (canceled || !filePath) return null;
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(emergencyKitHtml(sk))}`);
    fs.writeFileSync(filePath, await w.webContents.printToPDF({ pageSize: 'Letter', printBackground: true }));
    return filePath;
  } finally {
    w.destroy();
  }
}

// ---------- API handlers ----------

type Handlers = { [M in keyof Api]: (...a: Parameters<Api[M]>) => ReturnType<Api[M]> | Promise<ReturnType<Api[M]>> };
let sender: WebContents | null = null;

// ---------- quick unlock (Windows Hello or PIN) ----------

const quick = new QuickUnlock(path.join(userData, 'quick-unlock.json'), {
  encrypt: data => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t protect the quick-unlock key.');
    return safeStorage.encryptString(Buffer.from(data).toString('base64')).toString('base64');
  },
  decrypt: data => Uint8Array.from(Buffer.from(safeStorage.decryptString(Buffer.from(data, 'base64')), 'base64')),
});

function quickStatus() {
  const id = store?.accountId ?? VaultStore.peekAccountId(vaultDir);
  return id ? quick.status(id) : { method: null };
}

/** Everything that happens after any successful unlock. */
function afterUnlock() {
  const s = store!;
  s.historyLimit = settings.historyLimit;
  lastActivity = Date.now();
  if (settings.emptyTrashDays > 0) s.emptyTrash(settings.emptyTrashDays);
  try { repairSshItems(s); } catch (e) { console.error('SSH item repair failed', e); }
  broadcastState();
  startSyncLoop();
}

async function reauth(password: string) {
  if (typeof password !== 'string' || !password) throw new Error('Enter your account password.');
  if (!await requireStore().verifyPassword(password, currentSecretKey())) throw new WrongPasswordError();
}

const handlers: Handlers = {
  getState: () => state(sender),

  createVault: async password => {
    const secretKey = generateSecretKey();
    store = await VaultStore.create(vaultDir, password, secretKey);
    secretKeyInMemory = secretKey;
    rememberSecretKey(secretKey);
    lastActivity = Date.now();
    broadcastState();
    return { secretKey };
  },

  unlock: async (password, secretKeyInput) => {
    const sk = secretKeyInput ? normalizeSecretKey(secretKeyInput) : (secretKeyInMemory ?? storedSecretKey());
    if (!sk) throw new Error('Enter your Secret Key to unlock on this device.');
    store = await VaultStore.unlock(vaultDir, password, sk);
    secretKeyInMemory = sk;
    if (secretKeyInput) rememberSecretKey(sk);
    quick.notePasswordUnlock(store.accountId);
    afterUnlock();
  },

  unlockQuick: async pin => {
    const accountId = VaultStore.peekAccountId(vaultDir);
    const st = accountId ? quick.status(accountId) : { method: null };
    if (!accountId || !st.method) throw new Error('Quick unlock isn’t set up. Enter your account password.');
    let key: Uint8Array;
    try {
      key = st.method === 'pin' ? await quick.unlockWithPin(accountId, pin ?? '') : await quick.unlockWithHello(accountId, helloSign);
    } catch (e) {
      if (e instanceof QuickUnlockError && e.disabled) broadcastState(); // lock screen falls back to the password
      throw e;
    }
    try { store = VaultStore.unlockWithKey(vaultDir, key); } finally { key.fill(0); }
    afterUnlock();
  },

  quickUnlockStatus: async () => ({ ...quickStatus(), helloAvailable: await helloAvailable() }),

  quickUnlockEnable: async (method, password, pin) => {
    await reauth(password);
    const s = requireStore();
    if (method === 'hello' && !(await helloAvailable())) throw new Error('Windows Hello isn’t set up on this computer. Set it up in Windows Settings → Accounts → Sign-in options, or use a PIN.');
    const key = s.masterKeyCopy();
    try {
      if (method === 'pin') await quick.enablePin(key, s.accountId, pin ?? '');
      else await quick.enableHello(key, s.accountId, helloSign);
    } finally { key.fill(0); }
    if (method === 'pin') void helloDelete();
    return { ...quickStatus(), helloAvailable: method === 'hello' || await helloAvailable() };
  },

  quickUnlockDisable: async () => {
    const was = quickStatus().method;
    quick.disable();
    if (was === 'hello') await helloDelete();
    return { ...quickStatus(), helloAvailable: await helloAvailable() };
  },

  lock: () => lock(),
  getData: () => requireStore().snapshot(),

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
    const { filePaths } = await dialog.showOpenDialog(mainWin!, { title: 'Attach files', properties: ['openFile', 'multiSelections'] });
    for (const p of filePaths) {
      const ext = path.extname(p).toLowerCase();
      const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.pdf': 'application/pdf', '.txt': 'text/plain' } as Record<string, string>)[ext] ?? 'application/octet-stream';
      s.addAttachment(itemId, path.basename(p), mime, fs.readFileSync(p));
    }
    changed();
    return filePaths.length;
  },
  saveAttachment: async (itemId, attId) => {
    const { meta, bytes } = requireStore().readAttachment(itemId, attId);
    const { filePath, canceled } = await dialog.showSaveDialog(mainWin!, { defaultPath: meta.name });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, bytes);
    return true;
  },
  removeAttachment: (itemId, attId) => { requireStore().removeAttachment(itemId, attId); changed(); },

  generate: options => { const password = generatePassword(options); return { password, strength: rateStrength(password) }; },
  rateStrength: pw => rateStrength(pw),
  suggestUsername: () => suggestUsername(),
  totp: value => { try { return currentTotp(value); } catch (e) { return { error: (e as Error).message }; } },

  watchtower: async () => {
    const s = requireStore();
    const report = await runWatchtower(
      s.snapshot(),
      onlineChecks(cacheDir, { vulnerable: settings.checkVulnerable, compromised: settings.checkCompromisedSites, twoFactor: settings.check2faSites }),
      Date.now(),
      (h, n) => s.recordPwned(h, n),
    );
    if (store === s) s.flush();
    return report;
  },

  copy: (text, secret) => copy(text, secret),
  getSettings: () => settings,
  setSettings: patch => saveSettings(patch),
  applyPreset: name => saveSettings({ ...SECURITY_PRESETS[name].values, securityPreset: name }),

  importChoose: async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWin!, {
      title: 'Import passwords', properties: ['openFile'],
      filters: [{ name: 'Password exports', extensions: ['csv', 'json', '1pux'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (!filePaths[0]) return null;
    pendingImport = { fileName: path.basename(filePaths[0]), bytes: fs.readFileSync(filePaths[0]) };
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
    const ext = format === 'csv' ? 'csv' : 'json';
    const { filePath, canceled } = await dialog.showSaveDialog(mainWin!, {
      title: 'Export', defaultPath: `Strongroom Export ${new Date().toISOString().slice(0, 10)}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (canceled || !filePath) return null;
    if (format === 'csv') fs.writeFileSync(filePath, exportCsv(vaults, items));
    else if (format === 'json') fs.writeFileSync(filePath, JSON.stringify(buildExport(vaults, items), null, 2));
    else {
      if (!exportPassword || exportPassword.length < 8) throw new Error('Use an export password of at least 8 characters.');
      fs.writeFileSync(filePath, JSON.stringify(await encryptExport(buildExport(vaults, items), exportPassword)));
    }
    return filePath;
  },

  emergencyKit: async password => { await reauth(password); return saveEmergencyKit(); },
  changePassword: async (oldPw, newPw) => {
    const s = requireStore();
    const auth = await s.changePassword(oldPw, newPw, currentSecretKey());
    if (s.syncState) {
      try { await pushNewKeys(s, auth); } catch (e) {
        throw new Error(`Password changed on this device, but the sync server couldn’t be updated (${(e as Error).message}). Other devices still use the old password until it is. Try again from Settings → Sync.`);
      }
    }
  },
  revealSecretKey: async pw => { await reauth(pw); return currentSecretKey(); },

  largeType: text => showLargeType(text),
  getLargeTypeText: () => largeTypeText,
  openUrl: url => {
    const u = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    if (!/^https?:\/\//i.test(u)) throw new Error('Only web addresses can be opened.');
    void shell.openExternal(u);
  },
  scanQrFromScreen: () => scanQrFromScreen(),
  addSearchHistory: q => { requireStore().addSearchHistory(q); },
  clearSearchHistory: () => { requireStore().clearSearchHistory(); changed(); },

  sshGenerate: (type, comment) => generateSshKey(type, comment),
  sshImport: (text, passphrase, comment) => importSshKey(text, passphrase, comment),
  sshExport: async (itemId, which) => {
    const item = requireStore().getItem(itemId);
    const f = (id: string) => item.fields.find(x => x.id === id)?.value ?? '';
    if (item.category !== 'sshKey' || !f('privateKey')) throw new Error('This item has no SSH key.');
    const base = item.title.replace(/[^\w.-]+/g, '_').toLowerCase() || 'id_strongroom';
    const { filePath, canceled } = await dialog.showSaveDialog(mainWin!, {
      title: which === 'private' ? 'Export private key' : 'Save public key',
      defaultPath: which === 'private' ? base : `${base}.pub`,
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, which === 'private' ? f('privateKey') : `${f('publicKey')}\n`, { mode: which === 'private' ? 0o600 : 0o644 });
    return filePath;
  },
  sshAgentStatus: () => sshAgentStatus(settings.sshAgentEnabled),
  browserStatus: () => {
    const st = browserHostStatus();
    return {
      enabled: settings.browserIntegration, running: st.running, error: st.error, registered: st.registered,
      extensionId: st.extensionId, extensionFolder: extensionFolder(),
      pairings: (getBridge()?.pairings.list() ?? []).map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt })),
    };
  },
  browserRevoke: id => { getBridge()?.pairings.revoke(id); },
  syncStatus: () => syncStatus(),
  syncCheckServer: url => checkServer(url),
  syncSetup: async (url, email, password) => {
    await setupSync(requireStore(), url, email, password, currentSecretKey());
    changed();
    return syncStatus();
  },
  syncSignIn: async (url, email, password, secretKeyInput) => {
    if (vaultExists(vaultDir)) throw new Error('This device already has a vault.');
    const sk = normalizeSecretKey(secretKeyInput);
    store = await signInNewDevice(vaultDir, url, email, password, sk);
    store.historyLimit = settings.historyLimit;
    secretKeyInMemory = sk;
    rememberSecretKey(sk);
    lastActivity = Date.now();
    broadcastState();
    startSyncLoop();
  },
  syncNow: async () => { await syncNow(); return syncStatus(); },
  syncReconnect: async password => { await reconnect(requireStore(), password, currentSecretKey()); changed(); return syncStatus(); },
  syncDisconnect: async deleteAccount => { await disconnectSync(requireStore(), deleteAccount); },
  browserShowExtensionFolder: () => { void shell.openPath(extensionFolder()); },

  quickAccessAction: async (itemId, action) => quickAccessAction(itemId, action),
  hideQuickAccess: () => { quickWin?.hide(); },
  showMain: route => showMain(route),
};

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

async function quickAccessAction(itemId: string, action: QuickAccessAction) {
  const s = requireStore();
  const item = s.getItem(itemId);
  const user = fieldByPurpose(item, 'username')?.value ?? '';
  const pass = fieldByPurpose(item, 'password')?.value ?? '';
  const otp = fieldByPurpose(item, 'totp')?.value;
  s.markUsed(itemId);
  changed();
  quickWin?.hide();
  if (action === 'username') copy(user, false);
  else if (action === 'password') copy(pass, true);
  else if (action === 'otp' && otp) copy(currentTotp(otp).code, true);
  else if (action === 'open' && item.urls[0]) {
    handlers.openUrl(item.urls[0].url);
    if (pass) copy(pass, true);
  } else if (action === 'autoType') {
    if (!settings.autoTypeEnabled) throw new Error('Auto-Type is turned off in Settings.');
    const seq = [user && sendKeysEscape(user), pass && sendKeysEscape(pass)].filter(Boolean).join('{TAB}') + (item.autosubmit === false ? '' : '{ENTER}');
    await autoType(seq);
  }
}

ipcMain.handle('api', async (e, method: keyof Api, args: unknown[]) => {
  lastActivity = Date.now();
  const fn = handlers[method] as ((...a: unknown[]) => unknown) | undefined;
  if (!fn) return { __apiError: true, error: `Unknown method ${String(method)}` };
  try {
    sender = e.sender;
    const value = await fn(...args);
    return { value };
  } catch (err) {
    return { __apiError: true, error: (err as Error).message };
  } finally {
    sender = null;
  }
});

// ---------- app lifecycle ----------

function handleArgs(args: string[]) {
  const url = args.find(a => a.startsWith('strongroom://'));
  if (args.includes('--lock')) { lock(); return; }
  if (args.includes('--toggle')) { toggleMain(); return; }
  if (args.includes('--quick-access')) { toggleQuickAccess(); return; }
  if (url) {
    const m = url.match(/^strongroom:\/\/(item|open)\/([0-9a-f]+)/i);
    showMain(m ? `/item/${m[2]}` : undefined);
    return;
  }
  if (!args.includes('--silent')) showMain();
}

app.on('second-instance', (_e, _argv, _cwd, extra) => {
  handleArgs(((extra as { argv?: string[] })?.argv) ?? _argv);
});

app.whenReady().then(async () => {
  await ready();
  if (!app.isDefaultProtocolClient('strongroom')) {
    if (app.isPackaged) app.setAsDefaultProtocolClient('strongroom');
    else app.setAsDefaultProtocolClient('strongroom', process.execPath, [path.resolve(process.argv[1] ?? '.')]);
  }
  buildMenu();
  tray = new Tray(makeIcon(16, true));
  tray.on('click', () => showMain());
  updateTray();
  registerShortcuts();
  const silent = argv.includes('--silent') || settings.startMinimized;
  createMainWindow(!silent);
  createQuickAccess();
  initSync({ store: () => store, tokenFile: path.join(userData, 'sync-session.json'), onPulled: () => { if (store) emit('data', store.snapshot()); } });
  initSshAgent({
    store: () => store,
    requestUnlock: () => showMain(),
    onUsed: id => { if (store) { store.markUsed(id); changed(); } },
  });
  if (settings.sshAgentEnabled) void setSshAgentEnabled(true);
  if (settings.browserIntegration) void setBrowserIntegration(true);
  powerMonitor.on('suspend', () => { if (settings.lockOnSleep) lock(); });
  powerMonitor.on('lock-screen', () => { if (settings.lockOnScreenLock) lock(); });
  const url = argv.find(a => a.startsWith('strongroom://'));
  if (url) handleArgs([url]);
});

// ---------- browser extension ----------

const appRoot = path.resolve(__dirname, '..');
const extensionFolder = () => path.join(appRoot, 'dist-extension');

async function setBrowserIntegration(on: boolean) {
  if (!on) { stopBrowserHost(); return; }
  if (!process.env.STRONGROOM_NO_BROWSER_REGISTER) {
    await registerNativeHost(path.join(userData, 'native-messaging'), path.join(appRoot, 'dist', 'nmhost.js'));
  }
  await startBrowserHost({
    store: () => store,
    pairingsFile: path.join(userData, 'browser-pairings.json'),
    version: app.getVersion(),
    showMain: route => showMain(route),
    onChanged: () => changed(),
    approvePairing: async (code, name) => {
      showMain();
      app.focus({ steal: true });
      const opts = {
        type: 'question' as const,
        title: 'Strongroom: connect browser',
        message: `Connect ${name} to Strongroom?`,
        detail: `The Strongroom extension in ${name} is asking to fill and save logins.

Only connect if the extension shows this code:

    ${code}`,
        buttons: ['Connect', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const { response } = mainWin ? await dialog.showMessageBox(mainWin, opts) : await dialog.showMessageBox(opts);
      return response === 0;
    },
  });
}

app.on('before-quit', () => { quitting = true; lock(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!settings.keepInTray) app.quit(); });
app.on('activate', () => showMain());
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', e => e.preventDefault());
});

export {};
