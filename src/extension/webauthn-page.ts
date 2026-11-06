/**
 * Runs in the page's own JavaScript world (manifest "world": "MAIN") before the page's scripts, and
 * wraps navigator.credentials.create/get so sites can make and use passkeys kept in Boltwork.
 *
 * It holds no secrets and makes no decisions: requests go through the extension (which takes the page
 * origin from Chrome, not from here) to the Boltwork app, which asks the user. If Boltwork can't or
 * shouldn't handle a request (not running, no passkey for this site, the user picks "Use another device",
 * or the site wants a hardware security key), the browser's own WebAuthn handles it, unchanged.
 */
(() => {
  const creds = navigator.credentials as CredentialsContainer | undefined;
  const PKC = (window as unknown as { PublicKeyCredential?: typeof PublicKeyCredential }).PublicKeyCredential;
  if (!creds || !PKC || (window as unknown as { __boltworkWebAuthn?: boolean }).__boltworkWebAuthn) return;
  (window as unknown as { __boltworkWebAuthn?: boolean }).__boltworkWebAuthn = true;

  const nativeCreate = creds.create.bind(creds);
  const nativeGet = creds.get.bind(creds);
  const post = window.postMessage.bind(window);

  // ---- base64url <-> ArrayBuffer ----
  const bytes = (b: BufferSource) => b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  const toB64u = (b: BufferSource) => { let s = ''; for (const x of bytes(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64u = (s: string) => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  };

  // ---- talking to the extension (the isolated-world relay in the same frame) ----
  type Reply = { response?: Rec; fallback?: true; error?: { name: string; message: string }; aborted?: true };
  type Rec = Record<string, unknown> & { id: string; rawId: string; response: Record<string, unknown>; clientExtensionResults: Record<string, unknown> };
  let seq = 0;
  const waiting = new Map<string, (r: Reply) => void>();
  const acked = new Set<string>();
  window.addEventListener('message', e => {
    const d = e.data as { __boltworkPk?: string; id?: string; result?: Reply } | null;
    if (e.source !== window || !d || !d.id) return;
    if (d.__boltworkPk === 'ack') { acked.add(d.id); return; }
    if (d.__boltworkPk !== 'res') return;
    const w = waiting.get(d.id);
    if (w) { waiting.delete(d.id); acked.delete(d.id); w(d.result ?? { fallback: true }); }
  });
  function ask(kind: 'create' | 'get' | 'get-conditional', payload: unknown, signal?: AbortSignal | null): Promise<Reply> {
    return new Promise(resolve => {
      const id = `${Date.now().toString(36)}.${(++seq).toString(36)}.${Math.random().toString(36).slice(2)}`;
      // No relay (extension reloaded): let the browser handle it.
      const t = kind === 'get-conditional' ? null : setTimeout(() => { if (waiting.delete(id)) resolve({ fallback: true }); }, 300_000);
      // The relay acknowledges at once; if it doesn't (extension reloaded or missing), use the browser's own.
      const noRelay = setTimeout(() => { if (!acked.has(id) && waiting.delete(id)) { if (t) clearTimeout(t); resolve({ fallback: true }); } }, 1500);
      waiting.set(id, r => { if (t) clearTimeout(t); clearTimeout(noRelay); resolve(r); });
      signal?.addEventListener('abort', () => {
        if (!waiting.delete(id)) return;
        post({ __boltworkPk: 'cancel', id }, '*');
        resolve({ aborted: true });
      }, { once: true });
      post({ __boltworkPk: 'req', id, kind, payload }, '*');
    });
  }

  // ---- building objects that behave like the browser's own ----
  function credential(r: Rec, kind: 'create' | 'get'): PublicKeyCredential {
    const rr = r.response as Record<string, string | string[] | number>;
    const json = () => ({
      id: r.id, rawId: r.rawId, type: 'public-key', authenticatorAttachment: 'platform',
      response: kind === 'create'
        ? { clientDataJSON: rr.clientDataJSON, attestationObject: rr.attestationObject, authenticatorData: rr.authenticatorData,
          publicKey: rr.publicKey, publicKeyAlgorithm: rr.publicKeyAlgorithm, transports: rr.transports }
        : { clientDataJSON: rr.clientDataJSON, authenticatorData: rr.authenticatorData, signature: rr.signature, userHandle: rr.userHandle },
      clientExtensionResults: structuredClone(r.clientExtensionResults),
    });
    const response = kind === 'create'
      ? {
        clientDataJSON: fromB64u(rr.clientDataJSON as string), attestationObject: fromB64u(rr.attestationObject as string),
        getTransports: () => [...(rr.transports as string[])], getAuthenticatorData: () => fromB64u(rr.authenticatorData as string),
        getPublicKey: () => fromB64u(rr.publicKey as string), getPublicKeyAlgorithm: () => rr.publicKeyAlgorithm as number,
      }
      : {
        clientDataJSON: fromB64u(rr.clientDataJSON as string), authenticatorData: fromB64u(rr.authenticatorData as string),
        signature: fromB64u(rr.signature as string), userHandle: fromB64u(rr.userHandle as string),
      };
    const R = kind === 'create' ? window.AuthenticatorAttestationResponse : window.AuthenticatorAssertionResponse;
    if (R) Object.setPrototypeOf(response, R.prototype);
    const c = {
      id: r.id, rawId: fromB64u(r.rawId), type: 'public-key', authenticatorAttachment: 'platform', response,
      getClientExtensionResults: () => structuredClone(r.clientExtensionResults), toJSON: json,
    };
    Object.setPrototypeOf(c, PKC!.prototype);
    return c as unknown as PublicKeyCredential;
  }

  const fail = (e: { name: string; message: string }) => new DOMException(e.message, e.name);

  // Chrome allows one WebAuthn request at a time. The browser-side half of an autofill request we started on
  // the page's behalf is cancelled before handing any other request to the browser (Boltwork's half stays).
  let liveConditional: AbortController | null = null;
  async function toBrowser<T>(run: () => Promise<T>): Promise<T> {
    if (liveConditional) { liveConditional.abort(); liveConditional = null; await new Promise(r => setTimeout(r, 0)); }
    return run();
  }

  // ---- create ----
  creds.create = async function create(options?: CredentialCreationOptions): Promise<Credential | null> {
    const pk = options?.publicKey;
    // Hardware-key-only requests and anything malformed go straight to the browser.
    if (!pk || pk.authenticatorSelection?.authenticatorAttachment === 'cross-platform') return toBrowser(() => nativeCreate(options));
    let payload;
    try {
      payload = {
        rp: { id: pk.rp?.id, name: pk.rp?.name }, challenge: toB64u(pk.challenge),
        user: { id: toB64u(pk.user.id), name: pk.user.name, displayName: pk.user.displayName },
        pubKeyCredParams: (pk.pubKeyCredParams ?? []).map(p => ({ type: p.type, alg: p.alg })),
        excludeCredentials: (pk.excludeCredentials ?? []).map(c => ({ id: toB64u(c.id) })),
        extensions: { credProps: !!(pk.extensions as { credProps?: boolean } | undefined)?.credProps },
      };
    } catch { return toBrowser(() => nativeCreate(options)); }
    const r = await ask('create', payload, options?.signal);
    if (r.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (r.response) return credential(r.response, 'create');
    if (r.error) throw fail(r.error);
    return toBrowser(() => nativeCreate(options));
  };

  // ---- get ----
  creds.get = async function get(options?: CredentialRequestOptions): Promise<Credential | null> {
    const pk = options?.publicKey;
    if (!pk) return toBrowser(() => nativeGet(options));
    let payload;
    try {
      payload = { rpId: pk.rpId, challenge: toB64u(pk.challenge), allowCredentials: (pk.allowCredentials ?? []).map(c => ({ id: toB64u(c.id) })) };
    } catch { return toBrowser(() => nativeGet(options)); }

    if ((options as { mediation?: string }).mediation === 'conditional') {
      // Autofill sign-in: offer Boltwork's passkeys in its field menu, alongside the browser's own list.
      // Whichever the user picks first wins; the other is cancelled.
      liveConditional?.abort();
      const stopNative = new AbortController();
      liveConditional = stopNative;
      const signal = options!.signal ? AbortSignal.any([options!.signal, stopNative.signal]) : stopNative.signal;
      const ours = new AbortController();
      const ourSignal = options!.signal ? AbortSignal.any([options!.signal, ours.signal]) : ours.signal;
      const native = nativeGet({ ...options, signal }).then(c => ({ c }), (e: unknown) => ({ e }));
      const mine = ask('get-conditional', payload, ourSignal);
      for (;;) {
        const first = await Promise.race([native.then(n => ({ n })), mine.then(m => ({ m }))]);
        if ('n' in first) {
          if ('c' in first.n) { ours.abort(); return first.n.c; }
          if (options!.signal?.aborted) { ours.abort(); throw first.n.e; }
          // The browser's side gave up (e.g. no other passkeys); keep waiting for Boltwork's.
          const m = await mine;
          if (m.response) return credential(m.response, 'get');
          if (m.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
          if (m.error) throw fail(m.error);
          throw first.n.e;
        }
        const m = first.m;
        if (m.response) { stopNative.abort(); return credential(m.response, 'get'); }
        if (m.error) { stopNative.abort(); throw fail(m.error); }
        // Fallback or aborted: the browser's own request decides.
        const n = await native;
        if ('c' in n) return n.c;
        throw n.e;
      }
    }

    const r = await ask('get', payload, options!.signal);
    if (r.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (r.response) return credential(r.response, 'get');
    if (r.error) throw fail(r.error);
    return toBrowser(() => nativeGet(options));
  };

  // Sites hide their passkey buttons unless a platform authenticator is available; Boltwork is one.
  const statics = PKC as unknown as Record<string, unknown>;
  const yes = async () => true;
  statics.isUserVerifyingPlatformAuthenticatorAvailable = yes;
  statics.isConditionalMediationAvailable = yes;
  const caps = statics.getClientCapabilities as undefined | (() => Promise<Record<string, boolean>>);
  if (caps) {
    statics.getClientCapabilities = async () => ({
      ...(await caps.call(PKC).catch(() => ({}))), conditionalGet: true, passkeyPlatformAuthenticator: true, userVerifyingPlatformAuthenticator: true,
    });
  }
})();
