/**
 * Boltwork as a Windows passkey provider (Windows 11 24H2/25H2 with the November 2025 update or later).
 *
 * A small packaged helper (native/passkey-provider) is what Windows talks to: it registers Boltwork with
 * Windows, and when you pick Boltwork in Windows' passkey dialog, Windows calls it with a CTAP2 request.
 * The helper checks the request was signed by Windows and relays it here over a local pipe; we ask you,
 * answer with the passkeys in your vault, and keep Windows' list of your passkeys (no keys, just names)
 * up to date so they show up in its picker.
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createPrompt, type PasskeyDecision, type PasskeyPrompt } from '../core/browserBridge';
import { authenticatorInfo, getAssertionResponse, makeCredentialResponse, parseGetAssertion, parseMakeCredential } from '../core/ctap';
import { PasskeyError } from '../core/passkeys';
import { SCHEMES } from '../core/schemes';
import type { VaultStore } from '../core/store';

export interface ProviderDeps {
  store: () => VaultStore | null;
  approve: (p: PasskeyPrompt) => Promise<PasskeyDecision>;
  waitForUnlock: () => Promise<boolean>;
  /**
   * Windows' passkey window sits on top of everything while it waits for us, so Boltwork's lock screen and
   * prompts must be raised above it (and given the keyboard) for the length of a request, then let go.
   */
  keepOnTop?: (on: boolean) => void;
  onChanged: () => void;
  /** How the helper can start Boltwork when Windows needs it and it isn't running. */
  launch: { command: string; args: string[]; cwd: string };
  userData: string;
}

export const PROVIDER_PIPE = process.env.BOLTWORK_PASSKEY_SOCK || '\\\\.\\pipe\\boltwork-passkeys';
const ALIAS = 'boltwork-passkeys.exe';

let deps: ProviderDeps | null = null;
let server: net.Server | null = null;
let lastError = '';

/** The helper's app execution alias, if the provider package is installed. */
export function providerExe(): string | null {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  const p = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', ALIAS);
  // An execution alias is a special link: stat() on it fails with EACCES (so existsSync says no), lstat() works.
  try { fs.lstatSync(p); return p; } catch { return null; }
}

export function startPasskeyProvider(d: ProviderDeps): void {
  if (process.platform !== 'win32' || server) return;
  deps = d;
  // Tell the helper how to start us (it reads this when Windows calls it while Boltwork is closed).
  try {
    const dir = path.join(process.env.LOCALAPPDATA ?? d.userData, 'Boltwork');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'passkey-provider.json'), JSON.stringify(d.launch, null, 2));
  } catch { /* the helper just can't start us; it reports that to Windows */ }

  const srv = net.createServer(conn => {
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > 1024 * 1024) { conn.destroy(); return; }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = '';
      let msg: { op?: string; request?: string };
      try { msg = JSON.parse(line); } catch { conn.destroy(); return; }
      handle(msg).then(r => { if (!conn.destroyed) conn.end(`${JSON.stringify(r)}\n`); }, () => { if (!conn.destroyed) conn.end('{"error":"failed"}\n'); });
    });
    conn.on('error', () => conn.destroy());
  });
  srv.on('error', e => { lastError = (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 'Another copy of Boltwork is the Windows passkey provider.' : e.message; server = null; });
  srv.listen(PROVIDER_PIPE, () => { server = srv; lastError = ''; });
}

export function stopPasskeyProvider() { server?.close(); server = null; }

/** One request from the helper. Errors are short codes the helper turns into HRESULTs for Windows. */
export async function handle(msg: { op?: string; request?: string }): Promise<Record<string, unknown>> {
  if (!deps) return { error: 'failed' };
  if (msg.op === 'lock') return { locked: !deps.store() };
  if (msg.op === 'cancel') return { ok: true };
  if (msg.op !== 'make' && msg.op !== 'get') return { error: 'failed' };
  deps.keepOnTop?.(true);
  try { return await operate(deps, msg as { op: 'make' | 'get'; request?: string }); } finally { deps.keepOnTop?.(false); }
}

async function operate(deps: ProviderDeps, msg: { op: 'make' | 'get'; request?: string }): Promise<Record<string, unknown>> {
  try {
    const raw = Buffer.from(String(msg.request ?? ''), 'base64');
    let store = deps.store();
    if (!store) {
      if (!(await deps.waitForUnlock())) return { error: 'cancelled' };
      store = deps.store();
      if (!store) return { error: 'cancelled' };
    }

    if (msg.op === 'make') {
      const req = parseMakeCredential(raw);
      const mine = store.passkeyIds();
      if (req.excludeIds.some(id => mine.has(id))) return { error: 'exists' };
      const site = req.rpName && req.rpName !== req.rpId ? `${req.rpName} (${req.rpId})` : req.rpId;
      const decision = await deps.approve(createPrompt(store, site, req.rpId, req.user.name ?? '', req.user.displayName || req.user.name || 'this account', false));
      if (decision.action !== 'ok') return { error: 'cancelled' };
      const { passkey, response } = makeCredentialResponse(req);
      const live = deps.store();
      if (!live) return { error: 'cancelled' };
      live.addPasskey(passkey, undefined, decision.target);
      deps.onChanged();
      return { response: response.toString('base64') };
    }

    const req = parseGetAssertion(raw);
    const allowed = new Set(req.allowIds);
    const options = store.passkeysFor(req.rpId).filter(o => !allowed.size || allowed.has(o.passkey.credentialId));
    if (!options.length) return { error: 'not-found' };
    const decision = await deps.approve({
      kind: 'get', site: req.rpId, allowFallback: false,
      accounts: options.map(o => o.passkey.userName || o.passkey.userDisplayName || o.title),
    });
    if (decision.action !== 'ok') return { error: 'cancelled' };
    const chosen = options[decision.index];
    const live = deps.store();
    if (!chosen || !live) return { error: 'cancelled' };
    const response = getAssertionResponse(req, chosen.passkey);
    live.markPasskeyUsed(chosen.itemId, chosen.passkey.credentialId);
    deps.onChanged();
    return { response: response.toString('base64') };
  } catch (e) {
    if (e instanceof PasskeyError) return { error: e.domName === 'NotSupportedError' ? 'not-supported' : e.domName === 'InvalidStateError' ? 'exists' : 'cancelled' };
    return { error: 'failed' };
  }
}

// ---------- the helper's commands ----------

function runHelper(cmd: string, input?: unknown): Promise<Record<string, unknown>> {
  const exe = providerExe();
  if (!exe) return Promise.reject(new Error('The Boltwork passkey provider isn’t installed.'));
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [cmd], { windowsHide: true });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => { out += c; });
    child.on('error', reject);
    child.on('close', () => { try { resolve(JSON.parse(out || '{}')); } catch { reject(new Error(out || `${cmd} failed`)); } });
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
    setTimeout(() => child.kill(), 30_000);
  });
}

export interface ProviderStatus { installed: boolean; state?: 'enabled' | 'disabled' | 'not-registered'; serving: boolean; error?: string }

export async function providerStatus(): Promise<ProviderStatus> {
  if (process.platform !== 'win32') return { installed: false, serving: false };
  if (!providerExe()) return { installed: false, serving: !!server, error: lastError || undefined };
  try {
    const r = await runHelper('status');
    return { installed: true, state: r.state as ProviderStatus['state'], serving: !!server, error: lastError || undefined };
  } catch (e) { return { installed: true, serving: !!server, error: (e as Error).message }; }
}

/** Adds (or refreshes) Boltwork in Windows' list of passkey providers, then syncs the passkey list. */
export async function registerProvider(scheme: keyof typeof SCHEMES = 'brass'): Promise<ProviderStatus> {
  const r = await runHelper('register', { info: authenticatorInfo().toString('base64'), logo: Buffer.from(markSvg(scheme)).toString('base64') });
  if (typeof r.hr === 'string' && r.hr.startsWith('0x8')) throw new Error(`Windows refused the registration (${r.hr}).`);
  await syncCredentialsNow();
  return providerStatus();
}

export async function unregisterProvider(): Promise<ProviderStatus> {
  await runHelper('unregister');
  return providerStatus();
}

// ---------- keeping Windows' passkey list current ----------

let syncTimer: NodeJS.Timeout | null = null;

/** Call when passkeys may have changed; tells Windows a moment later. */
export function scheduleCredentialSync() {
  if (!providerExe()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { void syncCredentialsNow().catch(() => undefined); }, 2000);
}

async function syncCredentialsNow() {
  const store = deps?.store();
  if (!store || !providerExe()) return;
  const list = store.snapshot().items
    .filter(i => i.state === 'active')
    .flatMap(i => (i.passkeys ?? []).map(p => ({
      credentialId: p.credentialId, rpId: p.rpId, rpName: p.rpName || p.rpId,
      userId: p.userHandle, userName: p.userName || p.userDisplayName || i.title, userDisplayName: p.userDisplayName || p.userName || i.title,
    })));
  await runHelper('sync', list);
}

/** The vault-door mark as SVG for Windows' passkey dialog. */
export function markSvg(scheme: keyof typeof SCHEMES): string {
  const m = SCHEMES[scheme].mark;
  const bolts = Array.from({ length: 8 }, (_, k) => {
    const a = ((k * 45 + 22.5) * Math.PI) / 180;
    return `<circle cx="${(36 + Math.cos(a) * 23.75).toFixed(2)}" cy="${(36 + Math.sin(a) * 23.75).toFixed(2)}" r="1.7" fill="${m.body}"/>`;
  }).join('');
  const spokes = [-90, 30, 150].map(d => {
    const a = (d * Math.PI) / 180, x = (36 + Math.cos(a) * 13.5).toFixed(2), y = (36 + Math.sin(a) * 13.5).toFixed(2);
    return `<line x1="36" y1="36" x2="${x}" y2="${y}" stroke="${m.metal}" stroke-width="3.8" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="2.9" fill="${m.metal}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 72 72"><rect x="2.75" y="2.75" width="66.5" height="66.5" rx="15.25" fill="${m.body}" stroke="${m.edge}" stroke-width="1.5"/><circle cx="36" cy="36" r="23.75" fill="none" stroke="${m.metal}" stroke-width="6.5"/>${bolts}${spokes}<circle cx="36" cy="36" r="5" fill="${m.metal}"/><circle cx="36" cy="36" r="1.8" fill="${m.body}"/></svg>`;
}

/** Opens Windows' passkey settings, where the user turns Boltwork on. */
export function openWindowsPasskeySettings() {
  execFile('explorer.exe', ['ms-settings:savedpasskeys'], () => undefined);
}
