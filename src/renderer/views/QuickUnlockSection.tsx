import { useEffect, useState } from 'react';
import type { QuickUnlockStatus } from '../../core/api';
import { api } from '../api';
import { Button, Modal, PasswordInput } from '../components/ui';
import { useApp } from '../state';

/** Settings → Security → Quick unlock: Windows Hello when available, otherwise a Strongroom PIN. */
export function QuickUnlockSection() {
  const { run } = useApp();
  const [status, setStatus] = useState<QuickUnlockStatus | null>(null);
  const [setup, setSetup] = useState<'pin' | 'hello' | null>(null);
  useEffect(() => { void api.quickUnlockStatus().then(setStatus); }, []);

  return (
    <div className="settings-section">
      <h3>Quick unlock</h3>
      <p className="muted">Unlock with Windows Hello or a short PIN instead of your full account password. Your password is still needed every 14 days,
        after 5 wrong PINs, and on any other computer.</p>
      {!status ? <p className="muted small">Checking Windows Hello…</p> : (<>
        {status.method && (
          <div className="agent-status ok">● {status.method === 'hello' ? 'Windows Hello is on' : 'PIN unlock is on'}{status.needsPassword ? ' (your password is needed next time)' : ''}</div>
        )}
        <div className="row gap">
          {status.helloAvailable
            ? status.method !== 'hello' && <Button kind="primary" onClick={() => setSetup('hello')}>Use Windows Hello…</Button>
            : null}
          {status.method !== 'pin' && <Button kind={status.helloAvailable ? 'default' : 'primary'} onClick={() => setSetup('pin')}>{status.method === 'hello' ? 'Use a PIN instead…' : 'Set up a PIN…'}</Button>}
          {status.method === 'pin' && <Button onClick={() => setSetup('pin')}>Change PIN…</Button>}
          {status.method && <Button onClick={async () => { const s = await run(api.quickUnlockDisable(), 'Quick unlock turned off'); if (s) setStatus(s); }}>Turn off</Button>}
        </div>
        {!status.helloAvailable && (
          <p className="hint">Windows Hello (face, fingerprint or Windows PIN) isn’t set up on this computer. Set it up in Windows Settings → Accounts → Sign-in options to use it here; until then you can use a Strongroom PIN.</p>
        )}
        {status.method === 'pin' && (
          <p className="hint">A PIN protects against people who don’t have your Windows account. Anyone who can sign in to Windows as you could try PINs offline, so use 6 or more characters.</p>
        )}
      </>)}
      {setup && <EnableModal method={setup} onClose={() => setSetup(null)} onDone={s => { setStatus(s); setSetup(null); }} />}
    </div>
  );
}

function EnableModal({ method, onClose, onDone }: { method: 'pin' | 'hello'; onClose: () => void; onDone: (s: QuickUnlockStatus) => void }) {
  const { run } = useApp();
  const [pw, setPw] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const pinOk = method === 'hello' || (/^\S{4,32}$/.test(pin) && pin === pin2);
  const go = async () => {
    if (!pw || !pinOk || busy) return;
    setBusy(true);
    const s = await run(api.quickUnlockEnable(method, pw, method === 'pin' ? pin : undefined), method === 'hello' ? 'Windows Hello is on' : 'PIN unlock is on');
    setBusy(false);
    if (s) onDone(s);
  };
  return (
    <Modal title={method === 'hello' ? 'Unlock with Windows Hello' : 'Unlock with a PIN'} onClose={onClose}>
      {method === 'pin' && (<>
        <label className="lbl">New PIN (4 or more characters; digits are fine)</label>
        <PasswordInput value={pin} onChange={setPin} autoFocus />
        <label className="lbl">Repeat PIN</label>
        <PasswordInput value={pin2} onChange={setPin2} />
        {pin2 && pin !== pin2 && <p className="warn-text">The PINs don’t match.</p>}
      </>)}
      {method === 'hello' && <p className="muted">Windows will ask for your face, fingerprint or Windows PIN, twice: once to create Strongroom’s Hello key and once to check it.</p>}
      <label className="lbl">Account password (to confirm it’s you)</label>
      <PasswordInput value={pw} onChange={setPw} autoFocus={method === 'hello'} onEnter={go} />
      <div className="row gap end"><Button onClick={onClose}>Cancel</Button>
        <Button kind="primary" disabled={!pw || !pinOk || busy} onClick={go}>{busy ? (method === 'hello' ? 'Waiting for Windows Hello…' : 'Saving…') : 'Turn on'}</Button></div>
    </Modal>
  );
}
