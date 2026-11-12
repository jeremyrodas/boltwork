import { useState } from 'react';
import { api } from '../api';
import { CircleCheck } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { Ico } from '../components/icons';
import { SecretKeyInput } from '../components/SecretKeyInput';
import type { SetupCode } from '../../core/setupCode';
import { Button, PasswordInput, StrengthMeter, useStrength } from '../components/ui';
import { useApp } from '../state';

/** Moves focus to a field once the screen has re-rendered (after a setup code is scanned). */
function focusById(id: string) {
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}

function Brand() {
  return <div className="brand"><BrandMark size={28} />Boltwork</div>;
}

export function Setup({ onDone }: { onDone: () => void }) {
  const { run } = useApp();
  const [step, setStep] = useState<'intro' | 'password' | 'kit' | 'signin'>('intro');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const strength = useStrength(pw);

  const create = async () => {
    setBusy(true);
    const r = await run(api.createVault(pw));
    setBusy(false);
    if (r) { setSecretKey(r.secretKey); setStep('kit'); }
  };

  const tooWeak = !strength || strength.level < 3;
  return (
    <div className="welcome">
      <div className="welcome-card">
        <Brand />
        {step === 'intro' && (<>
          <h1>Your passwords, behind the bolts.</h1>
          <p className="muted">Everything is encrypted on this device with your account password and a Secret Key that only you have. Nothing is sent anywhere unless you turn on optional online checks.</p>
          <Button kind="primary" onClick={() => setStep('password')}>Create my vault</Button>
          <p className="muted small">Already use Boltwork with a sync server? <button className="link" onClick={() => setStep('signin')}>Sign in to your server</button></p>
        </>)}
        {step === 'signin' && <SyncSignIn onBack={() => setStep('intro')} onDone={onDone} />}
        {step === 'password' && (<>
          <h1>Choose an account password</h1>
          <p className="muted">This is the one password you need to remember. Use a long phrase; it can never be recovered if you forget it.</p>
          <label className="lbl">Account password</label>
          <PasswordInput value={pw} onChange={setPw} autoFocus />
          <StrengthMeter strength={pw ? strength : null} />
          {strength?.warning && pw && <p className="warn-text">{strength.warning}</p>}
          <label className="lbl">Confirm password</label>
          <PasswordInput value={confirm} onChange={setConfirm} onEnter={() => { if (!tooWeak && pw === confirm) void create(); }} />
          {confirm && confirm !== pw && <p className="warn-text">The passwords don’t match.</p>}
          <div className="row gap">
            <Button onClick={() => setStep('intro')}>Back</Button>
            <Button kind="primary" disabled={busy || pw.length < 8 || pw !== confirm || tooWeak} onClick={create}>
              {busy ? 'Creating…' : 'Create vault'}
            </Button>
          </div>
          {pw && tooWeak && <p className="hint">Pick something at least “Fair” in strength.</p>}
        </>)}
        {step === 'kit' && (<>
          <h1>Save your Emergency Kit</h1>
          <p className="muted">Your Secret Key protects your vault together with your password. You’ll need it to unlock on a new computer or after reinstalling. This device remembers it, protected by Windows.</p>
          <div className="secret-key">{secretKey}</div>
          <div className="row gap">
            <Button onClick={async () => { const p = await run(api.emergencyKit(pw)); if (p) setSaved(true); }}>Download Emergency Kit (PDF)</Button>
            <Button onClick={() => run(api.copy(secretKey, true), 'Secret Key copied')}>Copy Secret Key</Button>
          </div>
          <label className="check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> I saved my Secret Key somewhere safe</label>
          <Button kind="primary" disabled={!saved} onClick={onDone}>Open my vault</Button>
        </>)}
      </div>
    </div>
  );
}

export function Unlock({ compact }: { compact?: boolean }) {
  const { app } = useApp();
  if (app?.platform === 'web') return <WebSignIn />;
  const quick = app?.quickUnlock;
  const [usePassword, setUsePassword] = useState(false);
  if (quick?.method && !quick.needsPassword && !usePassword && !app?.needsSecretKey) {
    return <QuickUnlockForm compact={compact} method={quick.method} onUsePassword={() => setUsePassword(true)} />;
  }
  return <PasswordUnlock compact={compact} notice={quick?.needsPassword} />;
}

/** The vault dial is the lock screen's mark; it turns while the vault opens. */
function LockHeading({ compact, busy }: { compact?: boolean; busy: boolean }) {
  return (<>
    <BrandMark size={64} turning={busy} className="dial" />
    <h1>{compact ? 'Unlock Boltwork' : 'Boltwork is locked'}</h1>
    <p className="muted lock-sub">Your vault is encrypted on this device. It opens only with your password.</p>
  </>);
}

function QuickUnlockForm({ compact, method, onUsePassword }: { compact?: boolean; method: 'pin' | 'hello'; onUsePassword: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (busy || (method === 'pin' && !pin)) return;
    setBusy(true); setError('');
    try { await api.unlockQuick(method === 'pin' ? pin : undefined); } catch (e) { setError((e as Error).message); setPin(''); } finally { setBusy(false); }
  };
  return (
    <div className={compact ? 'unlock-compact' : 'welcome'}>
      <div className="welcome-card">
        <LockHeading compact={compact} busy={busy} />
        {method === 'pin' ? (<>
          <label className="lbl" htmlFor="unlock-pin">PIN</label>
          <PasswordInput id="unlock-pin" value={pin} onChange={setPin} autoFocus onEnter={go} placeholder="Enter your Boltwork PIN" invalid={!!error} />
          {error && <p className="error-text" role="alert">{error}</p>}
          <Button kind="primary" disabled={!pin || busy} onClick={go}>{busy ? 'Unlocking…' : 'Unlock'}</Button>
        </>) : (<>
          <p className="muted">Use your face, fingerprint or Windows PIN.</p>
          {error && <p className="error-text" role="alert">{error}</p>}
          <Button kind="primary" autoFocus disabled={busy} onClick={go}>{busy ? 'Waiting for Windows Hello…' : 'Unlock with Windows Hello'}</Button>
        </>)}
        <p className="muted small"><button className="link" onClick={onUsePassword}>Use account password instead</button></p>
      </div>
    </div>
  );
}

function PasswordUnlock({ compact, notice }: { compact?: boolean; notice?: string }) {
  const { app } = useApp();
  const [pw, setPw] = useState('');
  const [sk, setSk] = useState('');
  const [code, setCode] = useState<SetupCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.unlock(pw, app?.needsSecretKey ? (code?.secretKey ?? sk) : undefined);
    } catch (e) {
      setError((e as Error).message);
      setPw('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={compact ? 'unlock-compact' : 'welcome'}>
      <div className="welcome-card">
        <LockHeading compact={compact} busy={busy} />
        {app?.needsSecretKey && (<>
          <label className="lbl" htmlFor="unlock-sk">Secret Key</label>
          <SecretKeyInput id="unlock-sk" value={sk} onChange={setSk} scanned={!!code} onUnscan={() => setCode(null)}
            onScanned={c => { setCode(c); setError(''); focusById('unlock-pw'); }} />
          {!code && <p className="hint">This device doesn’t have your Secret Key yet. Type it from your Emergency Kit, or choose <b>Scan code</b> and scan the kit’s setup code.</p>}
        </>)}
        {notice && <p className="hint">{notice}</p>}
        <label className="lbl" htmlFor="unlock-pw">Account password</label>
        <PasswordInput id="unlock-pw" value={pw} onChange={setPw} autoFocus onEnter={submit} placeholder="Enter your account password" invalid={!!error} />
        {error && <p className="error-text" role="alert">{error}</p>}
        <Button kind="primary" disabled={!pw || busy} onClick={submit}>{busy ? 'Unlocking…' : 'Unlock'}</Button>
      </div>
    </div>
  );
}

function SyncSignIn({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [server, setServer] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [sk, setSk] = useState('');
  const [code, setCode] = useState<SetupCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A scanned setup code supplies the Secret Key, and the server and email when it has them; none of it is shown.
  const fromCode = !!(code?.server && code.email);
  const account = { server: fromCode ? code!.server! : server, email: fromCode ? code!.email! : email, secretKey: code ? code.secretKey : sk };
  const go = async () => {
    setBusy(true); setError('');
    try {
      await api.syncSignIn(account.server, account.email, pw, account.secretKey);
      if (fromCode && code!.backup) await api.syncSetBackup(code!.backup).catch(() => undefined);
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ready = account.server && account.email && pw && account.secretKey.replace(/[^A-Za-z0-9]/g, '').length >= 20;
  const scanned = (c: SetupCode) => { setCode(c); setError(''); focusById(c.server && c.email ? 'signin-pw' : 'signin-server'); };
  return (<>
    <h1>Sign in to your sync server</h1>
    {fromCode ? (<>
      <p className="muted">Your setup code has your server, email and Secret Key. Enter your account password to finish. Your vault downloads encrypted and is unlocked only on this device.</p>
      <div className="sk-scanned" role="status">
        <Ico icon={CircleCheck} />
        <span className="grow">Using your setup code</span>
        <Button small kind="ghost" onClick={() => setCode(null)}>Enter details instead</Button>
      </div>
    </>) : (<>
      <p className="muted">Use the address of your Boltwork server, your email, your account password and the Secret Key from your Emergency Kit. Your vault downloads encrypted and is unlocked only on this device.</p>
      {!code && <p className="hint">Have a setup code? Choose <b>Scan code</b> next to the Secret Key. A code from a signed-in device fills in everything except your password.</p>}
      <label className="lbl" htmlFor="signin-server">Server address</label>
      <input id="signin-server" value={server} onChange={e => setServer(e.target.value)} placeholder="https://vault.example.com" autoFocus spellCheck={false} />
      <label className="lbl" htmlFor="signin-email">Email</label>
      <input id="signin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} spellCheck={false} />
    </>)}
    <label className="lbl" htmlFor="signin-pw">Account password</label>
    <PasswordInput id="signin-pw" value={pw} onChange={setPw} autoFocus={fromCode} onEnter={() => { if (ready && !busy) void go(); }} />
    {!fromCode && (<>
      <label className="lbl" htmlFor="signin-sk">Secret Key</label>
      <SecretKeyInput id="signin-sk" value={sk} onChange={setSk} scanned={!!code} onScanned={scanned} onUnscan={() => setCode(null)}
        onEnter={() => { if (ready && !busy) void go(); }} />
    </>)}
    {error && <p className="warn-text">{error}</p>}
    <div className="row gap">
      <Button onClick={onBack}>Back</Button>
      <Button kind="primary" disabled={!ready || busy} onClick={go}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </div>
  </>);
}

/** What the web vault may remember in this browser: the email always, the Secret Key only if asked to. */
const WEB_ACCOUNT_KEY = 'boltwork.web.account';
function savedAccount(): { email?: string; secretKey?: string } {
  try { return JSON.parse(localStorage.getItem(WEB_ACCOUNT_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function saveAccount(a: { email?: string; secretKey?: string }) {
  try { localStorage.setItem(WEB_ACCOUNT_KEY, JSON.stringify(a)); } catch { /* private window */ }
}

/** The web vault's lock screen: there's nothing in the browser to unlock, so each visit signs in to this server. */
function WebSignIn() {
  const saved = savedAccount();
  const [email, setEmail] = useState(saved.email ?? '');
  const [pw, setPw] = useState('');
  const [sk, setSk] = useState('');
  const [code, setCode] = useState<SetupCode | null>(null);
  const [keptKey, setKeptKey] = useState(saved.secretKey ?? '');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A scanned setup code supplies the Secret Key, and the email when it has one; neither is shown. Its server is
  // ignored: the web vault always signs in to the server it's served from, which may be another address of the same one.
  const fromCode = !!code?.email;
  const account = { email: (fromCode ? code!.email! : email).trim(), secretKey: code ? code.secretKey : keptKey || sk };
  const ready = !!account.email && !!pw && account.secretKey.replace(/[^A-Za-z0-9]/g, '').length >= 20;
  const scanned = (c: SetupCode) => { setCode(c); setError(''); focusById(c.email || email.trim() ? 'web-pw' : 'web-email'); };
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.syncSignIn(location.origin, account.email, pw, account.secretKey);
      saveAccount({ email: account.email, ...(keptKey || remember ? { secretKey: account.secretKey } : {}) });
    } catch (e) {
      setError((e as Error).message);
      setPw('');
    } finally {
      setBusy(false);
    }
  };
  const forgetKey = () => { setKeptKey(''); saveAccount({ email: email.trim() || undefined }); };
  return (
    <div className="welcome">
      <div className="welcome-card">
        <BrandMark size={64} turning={busy} className="dial" />
        <h1>Boltwork web vault</h1>
        <p className="muted lock-sub">Your vault downloads encrypted and opens only in this tab. Locking or closing the tab removes it.</p>
        {fromCode ? (
          <div className="sk-scanned" role="status">
            <Ico icon={CircleCheck} />
            <span className="grow">Using your setup code</span>
            <Button small kind="ghost" onClick={() => setCode(null)}>Enter details instead</Button>
          </div>
        ) : (<>
          <label className="lbl" htmlFor="web-email">Email</label>
          <input id="web-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" spellCheck={false} autoFocus={!email} />
          {keptKey ? (
            <p className="hint">Your Secret Key is saved in this browser. <button className="link" onClick={forgetKey}>Forget it</button></p>
          ) : (<>
            <label className="lbl" htmlFor="web-sk">Secret Key</label>
            <SecretKeyInput id="web-sk" value={sk} onChange={setSk} scanned={!!code} onScanned={scanned} onUnscan={() => setCode(null)} onEnter={submit} />
            {!code && <p className="hint">It’s in your Emergency Kit, or in Settings → Security in a Boltwork app. Have a setup code? Choose <b>Scan code</b> and you’ll only need your password.</p>}
          </>)}
        </>)}
        <label className="lbl" htmlFor="web-pw">Account password</label>
        <PasswordInput id="web-pw" value={pw} onChange={setPw} autoFocus={!!email || fromCode} onEnter={submit} placeholder="Enter your account password" invalid={!!error} />
        {!keptKey && <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember my Secret Key in this browser</label>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <Button kind="primary" disabled={!ready || busy} onClick={submit}>{busy ? 'Unlocking…' : 'Unlock'}</Button>
        <p className="muted small">No account yet? Create your vault in a Boltwork app, then turn on sync to this server.</p>
      </div>
    </div>
  );
}
