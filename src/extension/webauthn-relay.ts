/// <reference types="chrome" />
/**
 * Isolated-world side of the passkey bridge, loaded at document_start in top-level pages.
 * Relays the page script's create/get requests to the service worker (which adds the page URL Chrome
 * reports and asks Boltwork). Autofill ("conditional") requests are parked here until the user picks
 * a passkey in Boltwork's field menu (content.ts): that pick is the only way to skip Boltwork's
 * prompt, and it can't come from the page, which can only send requests, never picks.
 */
import type { ExtMessage } from './messages';

interface Pending { id: string; request: { rpId?: string; challenge: string; allowCredentials?: { id: string }[] } }

export interface PasskeyRelay {
  /** The page's waiting autofill request, if any. */
  pending(): Pending | null;
  list(): Promise<{ credentialId: string; userName: string; title: string }[]>;
  pick(credentialId: string): Promise<void>;
}

declare global { interface Window { __boltworkPasskeys?: PasskeyRelay } }

if (window === window.top && !window.__boltworkPasskeys) {
  const send = <T>(m: ExtMessage) => new Promise<T | null>(resolve => {
    try { chrome.runtime.sendMessage(m, r => { void chrome.runtime.lastError; resolve((r ?? null) as T | null); }); } catch { resolve(null); }
  });
  const reply = (id: string, result: unknown) => window.postMessage({ __boltworkPk: 'res', id, result }, '*');
  const conditional = new Map<string, Pending>();

  window.addEventListener('message', e => {
    const d = e.data as { __boltworkPk?: string; id?: string; kind?: string; payload?: unknown } | null;
    if (e.source !== window || !d || typeof d.id !== 'string') return;
    if (d.__boltworkPk === 'cancel') { conditional.delete(d.id); return; }
    if (d.__boltworkPk !== 'req') return;
    const id = d.id;
    window.postMessage({ __boltworkPk: 'ack', id }, '*');
    if (d.kind === 'get-conditional') { conditional.set(id, { id, request: d.payload as Pending['request'] }); return; }
    const m: ExtMessage = d.kind === 'create'
      ? { type: 'passkeyCreate', request: d.payload as never }
      : { type: 'passkeyGet', request: d.payload as never };
    void send<Record<string, unknown>>(m).then(r => reply(id, r && (r.response || r.error || r.fallback) ? r : { fallback: true }));
  });

  window.__boltworkPasskeys = {
    pending: () => [...conditional.values()].at(-1) ?? null,
    list: async () => {
      const p = [...conditional.values()].at(-1);
      if (!p) return [];
      const r = await send<{ passkeys?: { credentialId: string; userName: string; title: string }[] }>({ type: 'passkeyList', rpId: p.request.rpId });
      return r?.passkeys ?? [];
    },
    pick: async credentialId => {
      const p = [...conditional.values()].at(-1);
      if (!p) return;
      conditional.delete(p.id);
      const r = await send<Record<string, unknown>>({ type: 'passkeyGet', request: p.request as never, conditional: true, credentialId });
      reply(p.id, r && (r.response || r.error) ? r : { fallback: true });
    },
  };
}
