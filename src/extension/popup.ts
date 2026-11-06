/// <reference types="chrome" />
/** The toolbar popup: connection status, pairing, and search / fill / copy. */
import type { BridgeMatch } from '../core/browserBridge';
import type { Creds, ExtMessage, PopupState } from './messages';

const app = document.getElementById('app')!;

function send<T = Record<string, unknown>>(m: ExtMessage): Promise<T> {
  return chrome.runtime.sendMessage(m) as Promise<T>;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'className') e.className = String(v);
    else e.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== false) e.append(k);
  return e;
}

function screen(title: string, text: string, ...actions: HTMLElement[]) {
  app.replaceChildren(h('div', { className: 'screen' }, h('div', { className: 'logo big' }), h('h1', {}, title), h('p', { className: 'muted' }, text), ...actions));
}

async function render() {
  app.replaceChildren(h('p', { className: 'muted center' }, 'Connecting…'));
  const s = await send<PopupState>({ type: 'popupState' });
  if (s.state === 'no-host') {
    screen('Boltwork isn’t set up for this browser',
      'Open Boltwork once (Settings → Browser Extension) so it can register with your browser, then restart the browser.',
      h('button', { className: 'btn', onclick: render }, 'Try again'));
    return;
  }
  if (s.state === 'not-running') {
    screen('Boltwork isn’t running', 'Start the Boltwork app, then try again.', h('button', { className: 'btn primary', onclick: render }, 'Try again'));
    return;
  }
  if (s.state === 'unpaired') { renderPair(); return; }
  if (s.state === 'locked') {
    screen('Boltwork is locked', 'Unlock it to fill and save logins.',
      h('button', { className: 'btn primary', onclick: async () => { await send({ type: 'open' }); window.close(); } }, 'Unlock Boltwork'));
    return;
  }
  if (s.state === 'error') { screen('Something went wrong', s.detail ?? '', h('button', { className: 'btn', onclick: render }, 'Try again')); return; }
  await renderMain();
}

function renderPair() {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const btn = h('button', { className: 'btn primary' }, 'Connect to Boltwork');
  const status = h('p', { className: 'muted' });
  btn.addEventListener('click', async () => {
    btn.setAttribute('disabled', '');
    status.replaceChildren('Boltwork is asking you to confirm. Check that it shows ', h('b', { className: 'code' }, `${code.slice(0, 3)}-${code.slice(3)}`), '.');
    const brand = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands
      .map(b => b.brand).find(b => !/Not.A.Brand|Chromium/i.test(b)) ?? 'Browser';
    const r = await send<{ ok: boolean; error?: string }>({ type: 'pair', code: `${code.slice(0, 3)}-${code.slice(3)}`, name: brand });
    if (r.ok) await render();
    else { btn.removeAttribute('disabled'); status.textContent = r.error === 'denied' ? 'Connection was declined in Boltwork.' : `Couldn’t connect (${r.error ?? 'no answer'}).`; }
  });
  screen('Connect this browser', 'Boltwork will ask you to approve this browser once. After that it can fill and save your logins.', btn, status);
}

async function renderMain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageHost = (() => { try { const u = new URL(tab?.url ?? ''); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : ''; } catch { return ''; } })();
  const search = h('input', { type: 'search', placeholder: 'Search logins', className: 'search', autofocus: '' }) as HTMLInputElement;
  const list = h('div', { className: 'list' });
  const toast = h('div', { className: 'toast' });
  const header = h('div', { className: 'top' }, h('div', { className: 'logo' }), search,
    h('button', { className: 'icon', title: 'Open Boltwork', onclick: async () => { await send({ type: 'open' }); window.close(); } }, '↗'));
  app.replaceChildren(header, list, toast);

  const flash = (t: string) => { toast.textContent = t; toast.classList.add('on'); setTimeout(() => toast.classList.remove('on'), 1500); };
  const copy = async (id: string, what: keyof Creds, label: string) => {
    const c = await send<Creds & { error?: string }>({ type: 'copy', id });
    if (c.error || !c[what]) { flash(`No ${label}`); return; }
    await navigator.clipboard.writeText(c[what]);
    flash(`Copied ${label}`);
  };

  const row = (it: BridgeMatch, matched: boolean) => h('div', { className: 'row' },
    h('div', { className: 'info' }, h('div', { className: 't' }, it.title), h('div', { className: 's' }, it.username || it.url)),
    h('div', { className: 'actions' },
      pageHost ? h('button', { className: 'btn small primary', title: matched ? 'Fill on this page' : `Fill on ${pageHost} (this login is for another site)`, onclick: async () => {
        if (!matched && !confirm(`“${it.title}” is saved for a different website. Fill it on ${pageHost} anyway?`)) return;
        const r = await send<{ error?: string }>({ type: 'fill', id: it.id, explicit: !matched });
        if (r.error) flash(r.error === 'domain-mismatch' ? 'This login is for a different site' : 'Couldn’t fill'); else window.close();
      } }, 'Fill') : null,
      h('button', { className: 'icon', title: 'Copy username', onclick: () => copy(it.id, 'username', 'username') }, '👤'),
      h('button', { className: 'icon', title: 'Copy password', onclick: () => copy(it.id, 'password', 'password') }, '🔑'),
      it.hasTotp ? h('button', { className: 'icon', title: 'Copy one-time code', onclick: () => copy(it.id, 'totp', 'code') }, '⏱') : null,
    ));

  let matches: BridgeMatch[] = [];
  if (tab?.url && pageHost) {
    const r = await send<{ items?: BridgeMatch[] }>({ type: 'matches', url: tab.url });
    matches = r.items ?? [];
  }
  const showMatches = () => {
    list.replaceChildren(
      h('div', { className: 'label' }, pageHost ? `Logins for ${pageHost}` : 'Search your logins'),
      ...(matches.length ? matches.map(m => row(m, true)) : [h('p', { className: 'muted pad' }, pageHost ? 'No saved logins for this site. Search above to find one.' : 'Type to search.')]),
    );
  };
  showMatches();

  let seq = 0;
  search.addEventListener('input', async () => {
    const q = search.value.trim();
    if (!q) { showMatches(); return; }
    const mine = ++seq;
    const r = await send<{ items?: BridgeMatch[] }>({ type: 'search', query: q });
    if (mine !== seq) return;
    const ids = new Set(matches.map(m => m.id));
    const items = r.items ?? [];
    list.replaceChildren(h('div', { className: 'label' }, `${items.length} result${items.length === 1 ? '' : 's'}`),
      ...items.map(it => row(it, ids.has(it.id))));
  });
  search.focus();
}

void render();
