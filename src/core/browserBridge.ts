/**
 * The browser extension's view of the vault. Requests arrive from the native messaging host as JSON;
 * every request except pairing must carry a token the user approved in Strongroom.
 *
 * The extension never receives a password unless it asks to fill a specific item on a page whose
 * domain matches that item (or the user picked the item by hand in the extension's popup).
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { assertPasskey, checkOrigin, checkRpId, createPasskey, PasskeyError, usablePasskeys, type CreateRequest, type GetRequest } from './passkeys';
import { baseDomain, domainOf } from './search';
import type { PasskeyTarget, VaultStore } from './store';
import { blankContent, fieldByPurpose } from './templates';
import { currentTotp } from './totp';
import type { Item } from './types';

export interface Pairing { id: string; name: string; origin: string; tokenHash: string; createdAt: number; lastUsedAt: number }

export interface BridgeMatch { id: string; title: string; username: string; url: string; hasTotp: boolean; exactHost: boolean }

export type BridgeRequest =
  | { type: 'pair'; code: string; name: string }
  | { type: 'status' }
  | { type: 'matches'; url: string }
  | { type: 'search'; query: string }
  | { type: 'fill'; id: string; url: string; explicit?: boolean }
  | { type: 'checkSave'; url: string; username: string; password: string }
  | { type: 'save'; url: string; username: string; password: string; title?: string }
  | { type: 'update'; id: string; username: string; password: string }
  | { type: 'open'; route?: string }
  // Passkeys. `url` is the top-level page URL Chrome reported to the extension, never one the page supplied.
  | { type: 'passkeyCreate'; url: string; request: CreateRequest }
  | { type: 'passkeyGet'; url: string; request: GetRequest; conditional?: boolean; credentialId?: string }
  | { type: 'passkeyList'; url: string; rpId?: string };

/** What the user decided in Strongroom's passkey prompt. */
export type PasskeyDecision = { action: 'ok'; index: number; target?: string } | { action: 'fallback' } | { action: 'cancel' };

export interface PasskeyPrompt {
  kind: 'create' | 'get';
  site: string;
  /** create: the account name; get: one entry per passkey to choose from. */
  accounts: string[];
  /** Offer "Use another device" (the browser's own WebAuthn). Not when Windows already chose Strongroom. */
  allowFallback?: boolean;
  /** create: logins on this site the passkey could go on, and which one is picked to start with ('new': a new login). */
  targets?: PasskeyTarget[];
  suggested?: string;
}

/** Fills in where a new passkey could go, so the prompt can say whether it joins a login or makes a new one. */
export function createPrompt(store: VaultStore, site: string, rpId: string, userName: string, account: string, allowFallback?: boolean): PasskeyPrompt {
  const { targets, suggested } = store.passkeyTargets(rpId, userName);
  return { kind: 'create', site, accounts: [account], targets, suggested, ...(allowFallback === false ? { allowFallback } : {}) };
}

export interface BridgeDeps {
  store: () => VaultStore | null;
  pairingsFile: string;
  /** Asks the user to approve a new browser. Resolves true if they allow it. */
  approvePairing: (code: string, name: string, origin: string) => Promise<boolean>;
  showMain: (route?: string) => void;
  /** Asks the user to approve creating or using a passkey. */
  approvePasskey: (p: PasskeyPrompt) => Promise<PasskeyDecision>;
  /** Brings up the lock screen and waits for an unlock; false if it didn't happen in time. */
  waitForUnlock: () => Promise<boolean>;
  onChanged: () => void;
  version: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class PairingStore {
  constructor(private file: string) {}
  list(): Pairing[] {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) as Pairing[]; } catch { return []; }
  }
  private write(p: Pairing[]) { fs.writeFileSync(this.file, JSON.stringify(p, null, 2)); }
  add(name: string, origin: string): string {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.write([...this.list(), { id: randomBytes(8).toString('hex'), name, origin, tokenHash: sha256(token), createdAt: now, lastUsedAt: now }]);
    return token;
  }
  check(token: unknown): Pairing | null {
    if (typeof token !== 'string' || !token) return null;
    const all = this.list();
    const p = all.find(x => x.tokenHash === sha256(token));
    if (!p) return null;
    if (Date.now() - p.lastUsedAt > 60_000) { p.lastUsedAt = Date.now(); this.write(all); }
    return p;
  }
  revoke(id: string) { this.write(this.list().filter(p => p.id !== id)); }
}

function hostOf(url: string): string {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; }
}

const username = (i: Item) => fieldByPurpose(i, 'username')?.value ?? '';
const password = (i: Item) => fieldByPurpose(i, 'password')?.value ?? '';

/** Logins whose websites share the page's registrable domain; exact host matches first. */
export function matchLogins(items: Item[], pageUrl: string): BridgeMatch[] {
  const host = hostOf(pageUrl);
  if (!host) return [];
  const base = baseDomain(host);
  const out: BridgeMatch[] = [];
  for (const i of items) {
    if (i.category !== 'login' || i.state !== 'active') continue;
    let best: { url: string; exact: boolean } | null = null;
    for (const u of i.urls) {
      const h = domainOf(u.url);
      if (!h) continue;
      if (h === host) { best = { url: u.url, exact: true }; break; }
      if (baseDomain(h) === base && !best) best = { url: u.url, exact: false };
    }
    if (best) out.push(toMatch(i, best.url, best.exact));
  }
  return out.sort((a, b) => Number(b.exactHost) - Number(a.exactHost) || a.title.localeCompare(b.title));
}

function toMatch(i: Item, url: string, exactHost: boolean): BridgeMatch {
  return { id: i.id, title: i.title, username: username(i), url, hasTotp: !!fieldByPurpose(i, 'totp')?.value, exactHost };
}

/** Replies the extension understands: a WebAuthn response, "let the browser handle it", or a DOMException to raise. */
type PasskeyReply = { response: unknown } | { fallback: true } | { error: { name: string; message: string } } | { passkeys: { credentialId: string; userName: string; title: string }[] };

const cancelled = { error: { name: 'NotAllowedError', message: 'The request was cancelled.' } };

export class BrowserBridge {
  readonly pairings: PairingStore;
  constructor(private deps: BridgeDeps) { this.pairings = new PairingStore(deps.pairingsFile); }

  /** Handles one request. `origin` is the extension origin Chrome reported to the native host. */
  async handle(msg: { token?: string } & BridgeRequest, origin: string): Promise<unknown> {
    if (msg.type === 'pair') {
      const code = String(msg.code ?? '').slice(0, 12);
      const name = String(msg.name ?? 'Browser').slice(0, 60);
      if (!(await this.deps.approvePairing(code, name, origin))) return { error: 'denied' };
      return { token: this.pairings.add(name, origin) };
    }
    if (!this.pairings.check(msg.token)) return { error: 'unpaired' };
    if (msg.type === 'passkeyCreate' || msg.type === 'passkeyGet' || msg.type === 'passkeyList') {
      try { return await this.passkey(msg); } catch (e) {
        if (e instanceof PasskeyError) return { error: { name: e.domName, message: e.message } };
        throw e;
      }
    }
    const store = this.deps.store();
    if (msg.type === 'status') return { locked: !store, version: this.deps.version };
    if (msg.type === 'open') { this.deps.showMain(msg.route); return { ok: true }; }
    if (!store) return { locked: true };
    const items = store.snapshot().items;

    switch (msg.type) {
      case 'matches':
        return { items: matchLogins(items, String(msg.url)) };
      case 'search': {
        const q = String(msg.query ?? '').toLowerCase().trim();
        const hits = items.filter(i => i.category === 'login' && i.state === 'active' &&
          (!q || i.title.toLowerCase().includes(q) || username(i).toLowerCase().includes(q) || i.urls.some(u => u.url.toLowerCase().includes(q))));
        return { items: hits.slice(0, 50).map(i => toMatch(i, i.urls[0]?.url ?? '', false)) };
      }
      case 'fill': {
        const item = items.find(i => i.id === msg.id && i.state === 'active');
        if (!item) return { error: 'not-found' };
        if (!msg.explicit && !matchLogins([item], String(msg.url)).length) return { error: 'domain-mismatch' };
        store.markUsed(item.id);
        this.deps.onChanged();
        const totp = fieldByPurpose(item, 'totp')?.value;
        let code = '';
        if (totp) { try { code = currentTotp(totp).code; } catch { /* bad secret */ } }
        return { username: username(item), password: password(item), totp: code };
      }
      case 'checkSave': {
        if (!msg.password) return { status: 'same' };
        const matches = matchLogins(items, String(msg.url)).map(m => items.find(i => i.id === m.id)!);
        const sameUser = matches.filter(i => username(i).toLowerCase() === String(msg.username).toLowerCase());
        if (sameUser.some(i => password(i) === msg.password)) return { status: 'same' };
        if (sameUser.length) return { status: 'update', id: sameUser[0].id, title: sameUser[0].title };
        if (!msg.username && matches.length === 1 && password(matches[0]) !== msg.password) return { status: 'update', id: matches[0].id, title: matches[0].title };
        if (matches.some(i => password(i) === msg.password)) return { status: 'same' };
        return { status: 'new', title: hostOf(String(msg.url)) };
      }
      case 'save': {
        const host = hostOf(String(msg.url));
        if (!host) return { error: 'bad-url' };
        const c = blankContent('login');
        c.title = String(msg.title || host).slice(0, 200);
        c.urls = [{ label: 'website', url: new URL(String(msg.url)).origin, primary: true }];
        c.fields.find(f => f.purpose === 'username')!.value = String(msg.username ?? '');
        c.fields.find(f => f.purpose === 'password')!.value = String(msg.password);
        const vaultId = store.snapshot().vaults[0].id;
        const item = store.saveItem({ ...c, vaultId });
        this.deps.onChanged();
        return { id: item.id, title: item.title };
      }
      case 'update': {
        const item = items.find(i => i.id === msg.id && i.state === 'active');
        if (!item) return { error: 'not-found' };
        const fields = structuredClone(item.fields);
        const pw = fields.find(f => f.purpose === 'password');
        if (pw) pw.value = String(msg.password);
        const un = fields.find(f => f.purpose === 'username');
        if (un && !un.value && msg.username) un.value = String(msg.username);
        store.saveItem({ ...item, fields, id: item.id, vaultId: item.vaultId });
        this.deps.onChanged();
        return { id: item.id, title: item.title };
      }
      default:
        return { error: 'unknown-request' };
    }
  }

  private async passkey(msg: Extract<BridgeRequest, { type: 'passkeyCreate' | 'passkeyGet' | 'passkeyList' }>): Promise<PasskeyReply> {
    const origin = checkOrigin(String(msg.url));

    if (msg.type === 'passkeyList') {
      // For the extension's own sign-in menu: which accounts have passkeys here. No keys leave the app.
      const store = this.deps.store();
      if (!store) return { passkeys: [] };
      const rpId = checkRpId(origin, msg.rpId);
      return { passkeys: store.passkeysFor(rpId).map(x => ({ credentialId: x.passkey.credentialId, userName: x.passkey.userName, title: x.title })) };
    }

    let store = this.deps.store();
    if (!store) {
      // Silent autofill requests never pop up the lock screen; the browser's own UI still works.
      if (msg.type === 'passkeyGet' && msg.conditional && !msg.credentialId) return { fallback: true };
      if (!(await this.deps.waitForUnlock())) return { fallback: true };
      store = this.deps.store();
      if (!store) return { fallback: true };
    }

    if (msg.type === 'passkeyCreate') {
      const req = msg.request;
      const rpId = checkRpId(origin, req.rp?.id);
      const site = req.rp?.name ? `${req.rp.name} (${rpId})` : rpId;
      const mine = store.passkeyIds();
      if (req.excludeCredentials?.some(c => mine.has(c.id))) {
        throw new PasskeyError('InvalidStateError', 'Strongroom already has a passkey for this account.');
      }
      const decision = await this.deps.approvePasskey(createPrompt(store, site, rpId, req.user?.name ?? '', req.user?.displayName || req.user?.name || 'this account'));
      if (decision.action === 'fallback') return { fallback: true };
      if (decision.action === 'cancel') return cancelled;
      const { passkey, response } = createPasskey(req, origin);
      const live = this.deps.store();
      if (!live) return cancelled; // locked while the prompt was open
      live.addPasskey(passkey, undefined, decision.target);
      this.deps.onChanged();
      return { response };
    }

    const req = msg.request;
    const rpId = checkRpId(origin, req.rpId);
    const options = usablePasskeys(store.passkeysFor(rpId), req, origin);
    if (!options.length) return { fallback: true };
    let chosen: (typeof options)[number] | undefined;
    if (msg.credentialId) {
      // Picked in the extension's in-page menu with a real click.
      chosen = options.find(o => o.passkey.credentialId === msg.credentialId);
      if (!chosen) return cancelled;
    } else {
      const decision = await this.deps.approvePasskey({
        kind: 'get', site: rpId,
        accounts: options.map(o => o.passkey.userName || o.passkey.userDisplayName || o.title),
      });
      if (decision.action === 'fallback') return { fallback: true };
      if (decision.action === 'cancel') return cancelled;
      chosen = options[decision.index];
    }
    const live = this.deps.store();
    if (!chosen || !live) return cancelled;
    const response = assertPasskey(chosen.passkey, req, origin);
    live.markPasskeyUsed(chosen.itemId, chosen.passkey.credentialId);
    this.deps.onChanged();
    return { response };
  }
}
