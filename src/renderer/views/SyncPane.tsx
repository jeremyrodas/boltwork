import { useEffect, useState } from 'react';
import type { SyncStatus } from '../../core/api';
import { api } from '../api';
import { Server } from 'lucide-react';
import { Ico } from '../components/icons';
import { Button, Modal, PasswordInput } from '../components/ui';
import { useApp } from '../state';

const ago = (t?: number) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 10 ? 'just now' : s < 90 ? `${s} seconds ago` : s < 5400 ? `${Math.round(s / 60)} minutes ago` : new Date(t).toLocaleString();
};

/** Settings → Sync: connect this vault to a self-hosted Boltwork server. */
export function SyncPane() {
  const { run } = useApp();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [setup, setSetup] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [off, setOff] = useState(false);
  useEffect(() => {
    let live = true;
    const tick = () => { void api.syncStatus().then(s => { if (live) setStatus(s); }); };
    tick();
    const t = setInterval(tick, 2000);
    return () => { live = false; clearInterval(t); };
  }, []);
  if (!status) return null;

  return (<>
    <div className="settings-section">
      <h3>Sync</h3>
      {!status.configured ? (<>
        <p className="muted">Keep this vault in step across your computers through a Boltwork server you run yourself (for example in Docker).
          The server only ever stores encrypted data: it never sees your password, your Secret Key or anything in your vault.</p>
        <Button kind="primary" onClick={() => setSetup(true)}>Set up sync…</Button>
      </>) : (<>
        <div className={`agent-status ${status.error ? 'bad' : 'ok'}`}>
          {status.syncing ? '● Syncing…' : status.error ? <>● {status.error}</> : <>● Synced {ago(status.lastSyncAt)}</>}
        </div>
        <div className="list-row"><span className="list-icon"><Ico icon={Server} /></span>
          <span className="grow"><b>{status.serverUrl}</b><span className="muted small">{status.email}</span></span>
        </div>
        {status.serverUrl?.startsWith('http:') && (
          <p className="hint">This server uses plain http. Your vault is still end-to-end encrypted, but others on the network could see your sync sign-in. Use https if the server is reachable from outside your home.</p>
        )}
        <div className="row gap">
          {status.signedOut
            ? <Button kind="primary" onClick={() => setReauth(true)}>Sign in again…</Button>
            : <Button disabled={status.syncing} onClick={async () => { const s = await run(api.syncNow()); if (s) setStatus(s); }}>Sync now</Button>}
          <Button onClick={() => setOff(true)}>Turn off sync…</Button>
        </div>
      </>)}
    </div>
    <div className="settings-section">
      <h3>Add another computer</h3>
      <p className="muted">Install Boltwork there and choose <b>Sign in to your server</b> on the welcome screen. You’ll need the server address, your email, your account password and your Secret Key (it’s in your Emergency Kit).</p>
    </div>
    <div className="settings-section">
      <h3>Run your own server</h3>
      <p className="muted">The server is in the <code>server/</code> folder of the Boltwork source. With Docker, run <code>docker compose up -d</code> there, then put it behind HTTPS (Caddy, Traefik or nginx). Only the first account can sign up unless you set <code>SIGNUPS=open</code>.</p>
    </div>
    <p className="hint">File attachments sync too, still encrypted. Each file can be up to 100 MB.</p>
    {setup && <SetupModal onClose={() => setSetup(false)} onDone={s => { setStatus(s); setSetup(false); }} />}
    {reauth && <ReauthModal onClose={() => setReauth(false)} onDone={s => { setStatus(s); setReauth(false); }} />}
    {off && <OffModal onClose={() => setOff(false)} onDone={() => { setOff(false); void api.syncStatus().then(setStatus); }} />}
  </>);
}

function SetupModal({ onClose, onDone }: { onClose: () => void; onDone: (s: SyncStatus) => void }) {
  const { run } = useApp();
  const [server, setServer] = useState('');
  const [checked, setChecked] = useState<{ serverUrl: string; signups: string } | null>(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Set up sync" onClose={onClose}>
      {!checked ? (<>
        <label className="lbl">Server address</label>
        <input value={server} onChange={e => setServer(e.target.value)} placeholder="https://vault.example.com" autoFocus spellCheck={false} />
        <p className="hint">Use https. Plain http works only for a server on this computer or your home network (like 192.168.1.20:8787).</p>
        <div className="row gap end"><Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!server.trim() || busy} onClick={async () => { setBusy(true); const r = await run(api.syncCheckServer(server)); setBusy(false); if (r) setChecked(r); }}>{busy ? 'Checking…' : 'Next'}</Button></div>
      </>) : (<>
        <p className="muted">Connected to <b>{checked.serverUrl}</b>. {checked.signups === 'closed' ? 'Sign-ups are closed there, so this only works if this vault already has an account on it.' : 'This creates your account there and uploads your vault, encrypted.'}</p>
        <label className="lbl">Email (your sign-in name on the server)</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus spellCheck={false} />
        <label className="lbl">Account password (to confirm it’s you)</label>
        <PasswordInput value={pw} onChange={setPw} />
        <div className="row gap end"><Button onClick={() => setChecked(null)}>Back</Button>
          <Button kind="primary" disabled={!email || !pw || busy} onClick={async () => {
            setBusy(true);
            const s = await run(api.syncSetup(checked.serverUrl, email, pw), 'Sync is on');
            setBusy(false);
            if (s) onDone(s);
          }}>{busy ? 'Uploading…' : 'Turn on sync'}</Button></div>
      </>)}
    </Modal>
  );
}

function ReauthModal({ onClose, onDone }: { onClose: () => void; onDone: (s: SyncStatus) => void }) {
  const { run } = useApp();
  const [pw, setPw] = useState('');
  return (
    <Modal title="Sign in to sync again" onClose={onClose}>
      <p className="muted">If you changed your password on another computer, enter the new one.</p>
      <label className="lbl">Account password</label>
      <PasswordInput value={pw} onChange={setPw} autoFocus />
      <div className="row gap end"><Button onClick={onClose}>Cancel</Button>
        <Button kind="primary" disabled={!pw} onClick={async () => { const s = await run(api.syncReconnect(pw), 'Signed in'); if (s) onDone(s); }}>Sign in</Button></div>
    </Modal>
  );
}

function OffModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { run } = useApp();
  const [del, setDel] = useState(false);
  return (
    <Modal title="Turn off sync" onClose={onClose}>
      <p className="muted">This computer keeps its copy of the vault and stops syncing.</p>
      <label className="check"><input type="checkbox" checked={del} onChange={e => setDel(e.target.checked)} /> Also delete the account and all its data from the server (other computers will stop syncing)</label>
      <div className="row gap end"><Button onClick={onClose}>Cancel</Button>
        <Button kind={del ? 'danger' : 'primary'} onClick={async () => { const ok = await run(api.syncDisconnect(del).then(() => true), del ? 'Server account deleted' : 'Sync turned off'); if (ok) onDone(); }}>{del ? 'Delete and turn off' : 'Turn off sync'}</Button></div>
    </Modal>
  );
}
