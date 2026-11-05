import { useState } from 'react';
import { api } from '../api';
import { Button, PasswordInput, StrengthMeter, useStrength } from '../components/ui';
import { useApp } from '../state';

function Brand() {
  return <div className="brand"><span className="brand-mark" />Strongroom</div>;
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
          <h1>Your passwords, locked in a strongroom.</h1>
          <p className="muted">Everything is encrypted on this device with your account password and a Secret Key that only you have. Nothing is sent anywhere unless you turn on optional online checks.</p>
          <Button kind="primary" onClick={() => setStep('password')}>Create my vault</Button>
          <p className="muted small">Already use Strongroom with a sync server? <button className="link" onClick={() => setStep('signin')}>Sign in to your server</button></p>
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
            <Button onClick={async () => { const p = await run(api.emergencyKit()); if (p) setSaved(true); }}>Download Emergency Kit (PDF)</Button>
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
  const [pw, setPw] = useState('');
  const [sk, setSk] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.unlock(pw, app?.needsSecretKey ? sk : undefined);
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
        {!compact && <Brand />}
        <div className="lock-glyph">🔒</div>
        <h1>{compact ? 'Unlock Strongroom' : 'Welcome back'}</h1>
        {app?.needsSecretKey && (<>
          <label className="lbl">Secret Key</label>
          <input className="mono" value={sk} onChange={e => setSk(e.target.value)} placeholder="SR1-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX" spellCheck={false} />
          <p className="hint">This device doesn’t have your Secret Key yet. Find it in your Emergency Kit.</p>
        </>)}
        <label className="lbl">Account password</label>
        <PasswordInput value={pw} onChange={setPw} autoFocus onEnter={submit} placeholder="Enter your account password" />
        {error && <p className="error-text">{error}</p>}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try {
      await api.syncSignIn(server, email, pw, sk);
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ready = server && email && pw && sk.replace(/[^A-Za-z0-9]/g, '').length >= 20;
  return (<>
    <h1>Sign in to your sync server</h1>
    <p className="muted">Use the address of your Strongroom server, your email, your account password and the Secret Key from your Emergency Kit. Your vault downloads encrypted and is unlocked only on this device.</p>
    <label className="lbl">Server address</label>
    <input value={server} onChange={e => setServer(e.target.value)} placeholder="https://vault.example.com" autoFocus spellCheck={false} />
    <label className="lbl">Email</label>
    <input type="email" value={email} onChange={e => setEmail(e.target.value)} spellCheck={false} />
    <label className="lbl">Account password</label>
    <PasswordInput value={pw} onChange={setPw} />
    <label className="lbl">Secret Key</label>
    <input className="mono" value={sk} onChange={e => setSk(e.target.value)} placeholder="SR1-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX" spellCheck={false}
      onKeyDown={e => { if (e.key === 'Enter' && ready && !busy) void go(); }} />
    {error && <p className="warn-text">{error}</p>}
    <div className="row gap">
      <Button onClick={onBack}>Back</Button>
      <Button kind="primary" disabled={!ready || busy} onClick={go}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </div>
  </>);
}
