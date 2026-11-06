import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Fingerprint, KeyRound, Plus, X } from 'lucide-react';
import type { PasskeyPrompt } from '../../core/browserBridge';
import { api } from '../api';
import { BrandMark } from '../components/BrandMark';
import { Ico } from '../components/icons';
import { Button, IconButton } from '../components/ui';

/**
 * Strongroom's own passkey prompt (its own small window), shown when a site in the browser, or Windows' passkey
 * window, asks to save or use a passkey. For a new passkey it says exactly where it will go: onto one of the
 * site's existing logins, or a new login, and lets the user change that.
 */
export function PasskeyPromptView() {
  const [p, setP] = useState<PasskeyPrompt | null | undefined>(undefined);
  const [target, setTarget] = useState('new');
  const [account, setAccount] = useState(0);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.getPasskeyPrompt().then(x => {
      setP(x);
      if (x?.suggested) setTarget(x.suggested);
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
      else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); if (!busy) confirm(); }
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
      <span>Strongroom · {title}</span>
      <span className="pk-spacer" />
      <IconButton title="Cancel" onClick={onClose}><Ico icon={X} /></IconButton>
    </div>
  );
}
