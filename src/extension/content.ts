/// <reference types="chrome" />
/**
 * Runs in every page and frame. Shows a small menu under login fields, fills the login you pick,
 * and offers to save logins you submit. Our UI lives in closed shadow roots so pages can't read or
 * restyle it, and we only act on real (isTrusted) clicks.
 */
import type { BridgeMatch } from '../core/browserBridge';
import { captureLogin, captureUsernameStep, kindOf, loginFields, setValue, type FieldKind } from './forms';
import type { Creds, ExtMessage, PublicPendingSave, TabMessage } from './messages';

declare global { interface Window { __strongroomLoaded?: boolean } }

if (!window.__strongroomLoaded) {
  window.__strongroomLoaded = true;
  init();
}

function send<T = Record<string, unknown>>(m: ExtMessage): Promise<T | null> {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(m, r => { void chrome.runtime.lastError; resolve((r ?? null) as T | null); });
    } catch { resolve(null); } // extension reloaded; this page's script is orphaned
  });
}

const FONT = 'font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;';
const CSS = `
  :host { all: initial; }
  .box { ${FONT} color: #e7e7ee; background: #1d1d26; border: 1px solid #3a3a4a; border-radius: 10px;
         box-shadow: 0 8px 28px rgba(0,0,0,.35); overflow: hidden; }
  .head { display: flex; align-items: center; gap: 6px; padding: 7px 10px; font-size: 11px; color: #a3a3b8; border-bottom: 1px solid #2c2c3a; }
  .logo { width: 14px; height: 14px; display: inline-block; background: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 72'><rect x='2.75' y='2.75' width='66.5' height='66.5' rx='15.25' fill='%231f2430' stroke='%23485062' stroke-width='1.5'/><circle cx='36' cy='36' r='23.25' fill='none' stroke='%23c9a45c' stroke-width='9.5'/><g stroke='%23c9a45c' stroke-width='7' stroke-linecap='round'><line x1='36' y1='36' x2='36' y2='24'/><line x1='36' y1='36' x2='46.4' y2='42'/><line x1='36' y1='36' x2='25.6' y2='42'/></g><circle cx='36' cy='36' r='6.5' fill='%23c9a45c'/></svg>") center / contain no-repeat; }
  button.row { all: unset; box-sizing: border-box; display: flex; flex-direction: column; width: 100%; padding: 8px 12px; cursor: pointer; }
  button.row:hover, button.row:focus-visible { background: #2a2a38; }
  .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s { color: #a3a3b8; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { padding: 10px 14px 12px; }
  .bar p { margin: 0 0 4px; }
  .btns { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .btn { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 7px; background: #2c2c3a; font-weight: 600; font-size: 12px; }
  .btn.primary { background: #c9a45c; color: #1c1709; }
  .btn:hover { filter: brightness(1.15); }
`;

function shadowHost(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('strongroom-ui');
  host.style.cssText = 'position: absolute; z-index: 2147483647; top: 0; left: 0;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  root.append(style);
  return { host, root };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fill(creds: Creds, anchor?: Element | null, kind?: FieldKind | null) {
  const f = loginFields(anchor);
  if (kind === 'otp') { if (creds.totp && f.otp) setValue(f.otp, creds.totp); return; }
  if (creds.username && f.username) setValue(f.username, creds.username);
  for (const pw of f.passwords) setValue(pw, creds.password);
  if (creds.totp && f.otp && !f.passwords.length && !f.username) setValue(f.otp, creds.totp);
  // Leave focus on the password so Enter submits, as if the user typed it.
  f.passwords[0]?.focus();
}

// ---------- inline menu ----------

let menu: { host: HTMLElement; root: ShadowRoot; field: HTMLInputElement } | null = null;
let matchCache: { at: number; result: { items?: BridgeMatch[]; locked?: boolean; error?: string } | null } | null = null;
let suppressUntil = 0;

async function getMatches() {
  if (matchCache && Date.now() - matchCache.at < 5000) return matchCache.result;
  const result = await send<{ items?: BridgeMatch[]; locked?: boolean; error?: string }>({ type: 'matches' });
  matchCache = { at: Date.now(), result };
  return result;
}

function closeMenu() { menu?.host.remove(); menu = null; }

function placeMenu() {
  if (!menu) return;
  const r = menu.field.getBoundingClientRect();
  menu.host.style.top = `${r.bottom + window.scrollY + 4}px`;
  menu.host.style.left = `${r.left + window.scrollX}px`;
  menu.host.style.width = `${Math.max(240, Math.min(360, r.width))}px`;
}

async function openMenu(field: HTMLInputElement, kind: FieldKind) {
  if (Date.now() < suppressUntil) return;
  const res = await getMatches();
  // A site waiting for an autofill passkey sign-in (see webauthn-relay.ts) also gets Strongroom's passkeys here.
  const relay = window === window.top && kind !== 'otp' && kind !== 'password' ? window.__strongroomPasskeys : undefined;
  const passkeys = relay?.pending() ? await relay.list() : [];
  if (document.activeElement !== field || !res || res.error) return;
  let items = res.items ?? [];
  if (kind === 'otp') items = items.filter(i => i.hasTotp);
  // A login that's offered as a passkey above doesn't need a second row to fill its username.
  if (passkeys.length) items = items.filter(i => !passkeys.some(p => p.title === i.title && p.userName === i.username));
  if (!res.locked && !items.length && !passkeys.length) return;
  closeMenu();
  const { host, root } = shadowHost();
  const box = el('div', 'box');
  const head = el('div', 'head');
  head.append(el('span', 'logo'), el('span', '', 'Strongroom'));
  box.append(head);
  const pick = (handler: () => void) => (e: Event) => { if (!e.isTrusted) return; e.preventDefault(); handler(); };
  if (res.locked) {
    const b = el('button', 'row');
    b.append(el('span', 't', '🔒 Unlock Strongroom'), el('span', 's', 'Then click this field again'));
    b.addEventListener('mousedown', pick(() => { closeMenu(); void send({ type: 'open' }); }));
    box.append(b);
  }
  for (const pk of passkeys.slice(0, 4)) {
    const b = el('button', 'row');
    b.append(el('span', 't', `Sign in with passkey`), el('span', 's', pk.userName || pk.title));
    b.addEventListener('mousedown', pick(() => { closeMenu(); suppressUntil = Date.now() + 3000; void relay!.pick(pk.credentialId); }));
    box.append(b);
  }
  for (const it of items.slice(0, 6)) {
    const b = el('button', 'row');
    b.append(el('span', 't', it.title), el('span', 's', kind === 'otp' ? 'Fill one-time code' : it.username || it.url));
    b.addEventListener('mousedown', pick(async () => {
      closeMenu();
      suppressUntil = Date.now() + 3000; // filling moves focus between fields; don't reopen the menu
      const creds = await send<Creds & { error?: string }>({ type: 'fill', id: it.id });
      if (creds && !creds.error) fill(creds, field, kind);
      suppressUntil = Date.now() + 1500;
    }));
    box.append(b);
  }
  root.append(box);
  document.documentElement.append(host);
  menu = { host, root, field };
  placeMenu();
}

function init() {
  document.addEventListener('focusin', e => {
    const t = e.composedPath()[0];
    const kind = kindOf(t);
    if (kind && t instanceof HTMLInputElement) void openMenu(t, kind);
    else if (!(t instanceof HTMLElement && t.tagName === 'STRONGROOM-UI')) closeMenu();
  }, true);
  document.addEventListener('focusout', e => {
    if (menu && e.target === menu.field) setTimeout(() => { if (menu && document.activeElement !== menu.field) closeMenu(); }, 150);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
    if (e.key === 'Enter' && e.isTrusted && e.target instanceof HTMLInputElement) captureSoon(e.target.form ?? document);
  }, true);
  document.addEventListener('input', e => { if (menu && e.target === menu.field && e.isTrusted) closeMenu(); }, true);
  window.addEventListener('resize', placeMenu);
  window.addEventListener('scroll', placeMenu, true);

  // Save prompts: catch the moment a login is submitted.
  document.addEventListener('submit', e => { if (e.target instanceof HTMLFormElement) captureSoon(e.target); }, true);
  document.addEventListener('click', e => {
    if (!e.isTrusted) return;
    const b = (e.target as Element | null)?.closest?.('button, input[type=submit], input[type=button], [role=button]');
    if (b) captureSoon((b as HTMLElement).closest('form') ?? document);
  }, true);

  chrome.runtime.onMessage.addListener((m: TabMessage) => {
    if (m.type === 'doFill') fill(m.creds, document.activeElement);
    if (m.type === 'fillBest') void fillBest();
    if (m.type === 'showSave' && window === window.top) showSaveBar(m.pending);
  });

  if (window === window.top) {
    void send<PublicPendingSave | null>({ type: 'pendingSave' }).then(p => { if (p) showSaveBar(p); });
  }
}

async function fillBest() {
  const f = loginFields(document.activeElement);
  if (!f.passwords.length && !f.username && !f.otp) return;
  const res = await getMatches();
  const best = res?.items?.[0];
  if (!best) return;
  const creds = await send<Creds & { error?: string }>({ type: 'fill', id: best.id });
  if (creds && !creds.error) fill(creds, document.activeElement, !f.passwords.length && !f.username ? 'otp' : null);
}

// ---------- save prompt ----------

let lastCapture = '';

function captureSoon(scope: ParentNode) {
  // Read values now: many sites clear the form as they submit it.
  const login = captureLogin(scope);
  if (login) {
    const sig = `${login.username}\n${login.password}`;
    if (sig === lastCapture) return;
    lastCapture = sig;
    void send({ type: 'saveCandidate', username: login.username, password: login.password });
    return;
  }
  const user = captureUsernameStep(scope);
  if (user) void send({ type: 'rememberUsername', username: user });
}

let bar: HTMLElement | null = null;
let shownKey = '';

function showSaveBar(p: PublicPendingSave) {
  if (p.key === shownKey) return;
  shownKey = p.key;
  bar?.remove();
  const { host, root } = shadowHost();
  host.style.cssText = 'position: fixed; z-index: 2147483647; top: 16px; right: 16px;';
  const box = el('div', 'box');
  box.style.width = '320px';
  const head = el('div', 'head');
  head.append(el('span', 'logo'), el('span', '', 'Strongroom'));
  const body = el('div', 'bar');
  body.append(
    el('p', 't', p.status === 'update' ? `Update the password for “${p.title}”?` : `Save this login for ${p.host}?`),
    el('p', 's', p.username || 'No username'),
  );
  const btns = el('div', 'btns');
  const decide = (action: 'save' | 'dismiss' | 'never') => async (e: Event) => {
    if (!e.isTrusted) return;
    const r = await send<{ error?: string; locked?: boolean }>({ type: 'saveDecision', key: p.key, action });
    if (action === 'save' && r && !r.error && !r.locked) {
      body.replaceChildren(el('p', 't', p.status === 'update' ? '✓ Password updated' : '✓ Saved to Strongroom'));
      setTimeout(() => host.remove(), 1800);
    } else if (action === 'save') {
      body.replaceChildren(el('p', 't', r?.locked ? 'Unlock Strongroom, then try again.' : 'Couldn’t save. Is Strongroom running?'));
      setTimeout(() => host.remove(), 3000);
    } else host.remove();
  };
  const primary = el('button', 'btn primary', p.status === 'update' ? 'Update' : 'Save');
  primary.addEventListener('click', decide('save'));
  const later = el('button', 'btn', 'Not now');
  later.addEventListener('click', decide('dismiss'));
  btns.append(primary, later);
  if (p.status === 'new') {
    const never = el('button', 'btn', 'Never for this site');
    never.addEventListener('click', decide('never'));
    btns.append(never);
  }
  body.append(btns);
  box.append(head, body);
  root.append(box);
  document.documentElement.append(host);
  bar = host;
}
