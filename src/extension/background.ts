/// <reference types="chrome" />
/**
 * Service worker: owns the native messaging connection to Strongroom and decides what each page may get.
 * Content scripts only learn logins that match their own frame's URL (Chrome tells us the sender's URL,
 * so a page cannot lie about it). The popup may fill any login the user picks by hand.
 */
import type { BridgeMatch } from '../core/browserBridge';
import type { ExtMessage, PendingSave, PopupState } from './messages';

const HOST = 'com.strongroom.browser';
let port: chrome.runtime.Port | null = null;
let nextId = 1;
const pending = new Map<number, (body: Record<string, unknown>) => void>();

function getPort(): chrome.runtime.Port {
  if (port) return port;
  const p = chrome.runtime.connectNative(HOST);
  p.onMessage.addListener((m: { id: number; body: Record<string, unknown> }) => {
    const cb = pending.get(m.id);
    if (cb) { pending.delete(m.id); cb(m.body); }
  });
  p.onDisconnect.addListener(() => {
    const detail = chrome.runtime.lastError?.message ?? '';
    port = null;
    for (const cb of pending.values()) cb({ error: 'no-host', detail });
    pending.clear();
  });
  port = p;
  return p;
}

async function call(msg: Record<string, unknown>, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const { token } = await chrome.storage.local.get('token');
  const body = await new Promise<Record<string, unknown>>(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    try { getPort().postMessage({ id, msg: { ...msg, token } }); } catch { pending.delete(id); resolve({ error: 'no-host' }); return; }
    setTimeout(() => { if (pending.delete(id)) resolve({ error: 'timeout' }); }, timeoutMs);
  });
  if (body.error === 'unpaired') await chrome.storage.local.remove('token');
  return body;
}

async function popupState(): Promise<PopupState> {
  const { token } = await chrome.storage.local.get('token');
  if (!token) {
    // Still check the app is reachable so the popup can say which step is missing.
    const r = await call({ type: 'status' });
    if (r.error === 'no-host') return { state: 'no-host', detail: String(r.detail ?? '') };
    if (r.error === 'not-running') return { state: 'not-running' };
    return { state: 'unpaired' };
  }
  const r = await call({ type: 'status' });
  if (r.error === 'no-host') return { state: 'no-host', detail: String(r.detail ?? '') };
  if (r.error === 'not-running') return { state: 'not-running' };
  if (r.error === 'unpaired') return { state: 'unpaired' };
  if (r.error) return { state: 'error', detail: String(r.error) };
  return { state: r.locked ? 'locked' : 'ready' };
}

const hostOf = (url?: string) => { try { return new URL(url ?? '').hostname.replace(/^www\./, ''); } catch { return ''; } };

async function neverSaveList(): Promise<string[]> {
  return ((await chrome.storage.local.get('neverSave')).neverSave as string[] | undefined) ?? [];
}

async function getPendingSave(tabId: number): Promise<PendingSave | null> {
  const key = `save:${tabId}`;
  const p = (await chrome.storage.session.get(key))[key] as PendingSave | undefined;
  if (!p || Date.now() - p.at > 3 * 60_000) return null;
  return p;
}

async function handle(m: ExtMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id;
  const fromPage = !!sender.tab;
  switch (m.type) {
    case 'popupState': return popupState();
    case 'pair': {
      const r = await call({ type: 'pair', code: m.code, name: m.name }, 180_000);
      if (typeof r.token === 'string') { await chrome.storage.local.set({ token: r.token }); return { ok: true }; }
      return { ok: false, error: r.error };
    }
    case 'open': return call({ type: 'open' });
    case 'matches': {
      // Pages ask about their own frame; the popup asks about the active tab.
      const url = fromPage ? sender.url : m.url;
      if (!url) return { items: [] };
      return call({ type: 'matches', url });
    }
    case 'search':
      if (fromPage) return { items: [] };
      return call({ type: 'search', query: m.query });
    case 'fill': {
      if (fromPage) return call({ type: 'fill', id: m.id, url: sender.url });
      // From the popup: the user chose this login for the active tab.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) return { error: 'no-tab' };
      const creds = await call({ type: 'fill', id: m.id, url: tab.url, explicit: m.explicit });
      if (creds.error) return creds;
      await chrome.tabs.sendMessage(tab.id, { type: 'doFill', creds }, { frameId: 0 }).catch(() => null);
      return { ok: true };
    }
    case 'copy': {
      if (fromPage) return { error: 'not-allowed' };
      return call({ type: 'fill', id: m.id, url: '', explicit: true });
    }
    case 'saveCandidate': {
      if (!tabId || !sender.url) return { status: 'skip' };
      const host = hostOf(sender.url);
      if (!host || (await neverSaveList()).includes(host)) return { status: 'skip' };
      let username = m.username;
      if (!username) {
        const last = (await chrome.storage.session.get(`user:${tabId}`))[`user:${tabId}`] as { host: string; username: string; at: number } | undefined;
        if (last && last.host === host && Date.now() - last.at < 10 * 60_000) username = last.username;
      }
      const r = await call({ type: 'checkSave', url: sender.url, username, password: m.password });
      if (r.status !== 'new' && r.status !== 'update') return r;
      const p: PendingSave = {
        key: `${host}|${username}|${m.password.length}|${Date.now()}`, at: Date.now(), url: sender.url, host, username, password: m.password,
        status: r.status, id: r.id as string | undefined, title: String(r.title ?? host),
      };
      await chrome.storage.session.set({ [`save:${tabId}`]: p });
      await chrome.tabs.sendMessage(tabId, { type: 'showSave', pending: publicPending(p) }, { frameId: 0 }).catch(() => null);
      return { status: r.status };
    }
    case 'rememberUsername': {
      if (tabId && sender.url && m.username) await chrome.storage.session.set({ [`user:${tabId}`]: { host: hostOf(sender.url), username: m.username, at: Date.now() } });
      return { ok: true };
    }
    case 'pendingSave': {
      if (!tabId || sender.frameId !== 0) return null;
      const p = await getPendingSave(tabId);
      return p ? publicPending(p) : null;
    }
    case 'saveDecision': {
      if (!tabId) return { error: 'no-tab' };
      const p = await getPendingSave(tabId);
      await chrome.storage.session.remove(`save:${tabId}`);
      if (!p || p.key !== m.key) return { error: 'expired' };
      if (m.action === 'never') {
        await chrome.storage.local.set({ neverSave: [...new Set([...(await neverSaveList()), p.host])] });
        return { ok: true };
      }
      if (m.action === 'dismiss') return { ok: true };
      if (p.status === 'update' && p.id) return call({ type: 'update', id: p.id, username: p.username, password: p.password });
      return call({ type: 'save', url: p.url, username: p.username, password: p.password, title: p.title });
    }
    case 'neverSaveList': return fromPage ? [] : neverSaveList();
    case 'removeNeverSave': {
      if (fromPage) return { error: 'not-allowed' };
      await chrome.storage.local.set({ neverSave: (await neverSaveList()).filter(h => h !== m.host) });
      return { ok: true };
    }
    case 'passkeyCreate':
    case 'passkeyGet':
    case 'passkeyList': {
      // Only top-level pages, and only for the URL Chrome says the frame has. Anything else: the browser's own WebAuthn.
      if (!tabId || sender.frameId !== 0 || !sender.url) return m.type === 'passkeyList' ? { passkeys: [] } : { fallback: true };
      const { token } = await chrome.storage.local.get('token');
      if (!token) return m.type === 'passkeyList' ? { passkeys: [] } : { fallback: true };
      const r = m.type === 'passkeyList'
        ? await call({ type: 'passkeyList', url: sender.url, rpId: m.rpId })
        : await call({ ...m, url: sender.url }, 300_000);
      // Not running, locked out, or any transport problem: let the browser handle it.
      if (typeof r.error === 'string') return m.type === 'passkeyList' ? { passkeys: [] } : { fallback: true };
      return r;
    }
    case 'unpair': {
      if (fromPage) return { error: 'not-allowed' };
      await chrome.storage.local.remove('token');
      return { ok: true };
    }
  }
  return { error: 'unknown' };
}

/** What the page's save bar may see: no password. */
function publicPending(p: PendingSave) {
  return { key: p.key, host: p.host, username: p.username, status: p.status, title: p.title };
}

chrome.runtime.onMessage.addListener((m: ExtMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(m, sender).then(sendResponse, e => sendResponse({ error: String((e as Error).message ?? e) }));
  return true;
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'fill-login') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'fillBest' }).catch(() => null);
});

export type { BridgeMatch };
