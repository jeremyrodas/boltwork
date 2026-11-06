import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Fingerprint, KeyRound, Plus, X } from 'lucide-react';
import type { AppPrompt } from '../../core/browserBridge';
import { api } from '../api';
import { BrandMark } from '../components/BrandMark';
import { Ico } from '../components/icons';
import { Button, IconButton } from '../components/ui';

/**
 * Boltwork's own passkey prompt (its own small window), shown when a site in the browser, or Windows' passkey
 * window, asks to save or use a passkey. For a new passkey it says exactly where it will go: onto one of the
 * site's existing logins, or a new login, and lets the user change that.
 */
export function PasskeyPromptView() {
  const [p, setP] = useState<AppPrompt | null | undefined>(undefined);
  const [target, setTarget] = useState('new');
  const [account, setAccount] = useState(0);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.getPasskeyPrompt().then(x => {
      setP(x);
      if (x?.kind === 'create' && x.suggested) setTarget(x.suggested);
    });
  }, []);

  // The window fits its content, and is shown once it has.
  useLayoutEffect(() => {
    if (p === undefined || !root.current) return;
    const fit = () => void api.fitPasskeyPrompt(root.current!.getBoundingClientRect().height);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root.current);
    return () => ro.disconnect();
  }, [p]);

  const answer = (d: Parameters<typeof api.answerPasskeyPrompt>[0]) => { setBusy(true); void api.answerPasskeyPrompt(d); };
  const cancel = () => answer({ action: 'cancel' });
  const confirm = () => answer({ action: 'ok', index: p?.kind === 'get' ? account : 0, ...(p?.kind === 'create' ? { target } : {}) });

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      // Connecting a browser takes a click on Connect, never a stray Enter.
      else if (e.key === 'Enter' && p?.kind !== 'pair' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); if (!busy) confirm(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (p === undefined) return <div ref={root} className="pk-prompt" />;
  if (p === null) {
    return (
      <div ref={root} className="pk-prompt">
        <Head title="Passkey request" onClose={() => window.close()} />
        <p className="muted pk-pad">This request is no longer waiting.</p>
      </div>
    );
  }

  if (p.kind === 'pair') {
    return (
      <div ref={root} className="pk-prompt" role="dialog" aria-labelledby="pk-title" aria-describedby="pk-site">
        <Head title="Connect browser" onClose={cancel} />
        <div className="pk-body">
          <h1 id="pk-title">Connect {p.browser} to Boltwork?</h1>
          <p id="pk-site" className="pk-site">The Boltwork extension in {p.browser} is asking to fill and save logins.</p>
          <div className="pk-code-box">
            <span className="pk-code-label">Only connect if the extension shows this code</span>
            <span className="pk-code" aria-label={`Code ${p.code.split('').join(' ')}`}>{p.code}</span>
          </div>
          <p className="pk-outcome">If you didn’t just ask to connect from the extension, or the codes differ, cancel.</p>
        </div>
        <div className="pk-foot">
          <span className="pk-spacer" />
          <Button autoFocus disabled={busy} onClick={cancel}>Cancel</Button>
          <Button kind="primary" disabled={busy} onClick={() => answer({ action: 'ok', index: 0 })}>Connect</Button>
        </div>
      </div>
    );
  }

  if (p.kind === 'ssh') {
    return (
      <div ref={root} className="pk-prompt" role="dialog" aria-labelledby="pk-title" aria-describedby="pk-site">
        <Head title="SSH key request" onClose={cancel} />
        <div className="pk-body">
          <h1 id="pk-title">Allow an SSH client to use this key?</h1>
          <p id="pk-site" className="pk-site">A program on this computer, such as ssh or git, is asking to sign in with it.</p>
          <div className="pk-account pk-key">
            <Ico icon={KeyRound} size={16} />
            <span className="pk-choice-text">
              <b>{p.title || 'Untitled key'}</b>
              <span className="muted mono">{[p.keyType, p.fingerprint].filter(Boolean).join(' · ') || 'No fingerprint'}</span>
            </span>
          </div>
          <p className="pk-outcome">Only allow it if you just ran that command. Boltwork signs for it; the private key never leaves the vault.</p>
        </div>
        <div className="pk-foot">
          <Button kind="ghost" disabled={busy} onClick={() => answer({ action: 'ok', index: 1 })}>Allow until Boltwork locks</Button>
          <span className="pk-spacer" />
          <Button disabled={busy} onClick={cancel}>Deny</Button>
          <Button kind="primary" autoFocus disabled={busy} onClick={() => answer({ action: 'ok', index: 0 })}>Allow</Button>
        </div>
      </div>
    );
  }

  const create = p.kind === 'create';
  const targets = p.targets ?? [];
  const chosen = targets.find(t => t.itemId === target);
  const accountName = p.accounts[0];

  return (
    <div ref={root} className="pk-prompt" role="dialog" aria-labelledby="pk-title" aria-describedby="pk-site">
      <Head title={create ? 'Save passkey' : 'Sign in with passkey'} onClose={cancel} />

      <div className="pk-body">
        <h1 id="pk-title">{create ? 'Save a passkey for this site?' : 'Sign in with a passkey?'}</h1>
        <p id="pk-site" className="pk-site">{p.site}</p>

        {create && (
          <>
            <div className="pk-account"><Ico icon={Fingerprint} size={16} /><span><span className="muted">Account</span> {accountName}</span></div>

            <fieldset className="pk-choices">
              <legend>Save it on</legend>
              {targets.map(t => (
                <label key={t.itemId} className="pk-choice">
                  <input type="radio" name="target" value={t.itemId} checked={target === t.itemId} onChange={() => setTarget(t.itemId)} />
                  <Ico icon={KeyRound} size={16} className="pk-choice-icon" />
                  <span className="pk-choice-text">
                    <b>{t.title || 'Untitled login'}</b>
                    <span className="muted">{t.userName || 'No username'}</span>
                  </span>
                  {t.sameAccount && <span className="pk-tag">Same account</span>}
                </label>
              ))}
              <label className="pk-choice">
                <input type="radio" name="target" value="new" checked={target === 'new'} onChange={() => setTarget('new')} />
                <Ico icon={Plus} size={16} className="pk-choice-icon" />
                <span className="pk-choice-text">
                  <b>New login</b>
                  <span className="muted">{accountName}</span>
                </span>
              </label>
            </fieldset>

            <p className="pk-outcome" aria-live="polite">
              {chosen
                ? <>Adds the passkey to your existing login <b>{chosen.title || 'Untitled login'}</b>. Its password and other details stay as they are.
                  {chosen.passkeys > 0 && <> It already has {chosen.passkeys === 1 ? 'a passkey' : `${chosen.passkeys} passkeys`} for this site; this one is kept alongside.</>}
                  {!chosen.sameAccount && chosen.userName && <> Note: that login is for <b>{chosen.userName}</b>, not {accountName}.</>}</>
                : <>Creates a new login for <b>{accountName}</b> holding the passkey.{targets.length > 0 && ' Your existing logins for this site aren’t changed.'}</>}
            </p>
          </>
        )}

        {!create && (
          p.accounts.length > 1 ? (
            <fieldset className="pk-choices">
              <legend>Sign in as</legend>
              {p.accounts.map((a, i) => (
                <label key={i} className="pk-choice">
                  <input type="radio" name="account" checked={account === i} onChange={() => setAccount(i)} />
                  <Ico icon={Fingerprint} size={16} className="pk-choice-icon" />
                  <span className="pk-choice-text"><b>{a}</b></span>
                </label>
              ))}
            </fieldset>
          ) : (
            <div className="pk-account"><Ico icon={Fingerprint} size={16} /><span><span className="muted">Account</span> {accountName}</span></div>
          )
        )}
      </div>

      <div className="pk-foot">
        {p.allowFallback !== false && <Button kind="ghost" disabled={busy} onClick={() => answer({ action: 'fallback' })}>Use another device</Button>}
        <span className="pk-spacer" />
        <Button disabled={busy} onClick={cancel}>Cancel</Button>
        <Button kind="primary" autoFocus disabled={busy} onClick={confirm}>{create ? 'Save passkey' : 'Sign in'}</Button>
      </div>
    </div>
  );
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="pk-head">
      <BrandMark size={20} />
      <span>Boltwork · {title}</span>
      <span className="pk-spacer" />
      <IconButton title="Cancel" onClick={onClose}><Ico icon={X} /></IconButton>
    </div>
  );
}
