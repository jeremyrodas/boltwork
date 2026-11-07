import { useEffect, useState } from 'react';
import type { BrowserStatus } from '../../core/api';
import { api } from '../api';
import { Puzzle } from 'lucide-react';
import { Ico } from '../components/icons';
import { Button, Toggle } from '../components/ui';
import { useApp } from '../state';

/** Settings → Browser Extension: connection status, setup steps and connected browsers. */
export function BrowserPane() {
  const { settings, updateSettings, run } = useApp();
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () => { void api.browserStatus().then(s => { if (live) setStatus(s); }); };
    tick();
    const t = setInterval(tick, 2000);
    return () => { live = false; clearInterval(t); };
  }, [settings?.browserIntegration]);
  if (!settings) return null;

  return (<>
    <div className="settings-section">
      <h3>Browser extension</h3>
      <Toggle label="Connect to the Boltwork browser extension" hint="Lets the extension fill logins on matching websites and offer to save new ones. It only gets a password when you pick a login."
        checked={settings.browserIntegration} onChange={v => updateSettings({ browserIntegration: v })} />
      {status && settings.browserIntegration && (
        <div className={`agent-status ${status.running ? 'ok' : 'bad'}`}>
          {status.running
            ? <>● Ready{status.registered.length ? <> · registered with {status.registered.join(', ')}</> : null}</>
            : <>● Not running: {status.error}</>}
        </div>
      )}
    </div>
    <div className="settings-section">
      <h3>Install the extension</h3>
      <ol className="steps">
        <li>In Chrome, open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>, Brave: <code>brave://extensions</code>).</li>
        <li>Turn on <b>Developer mode</b> (top right).</li>
        <li>Click <b>Load unpacked</b> and choose the extension folder: <Button small onClick={() => run(api.browserShowExtensionFolder())}>Show folder</Button>
          {status && <div className="code-row"><code>{status.extensionFolder}</code><Button small onClick={() => run(api.copy(status.extensionFolder, false), 'Path copied')}>Copy</Button></div>}</li>
        <li>If the browser was already open before Boltwork first ran, restart it so it finds Boltwork.</li>
        <li>Click the Boltwork icon in the toolbar and choose <b>Connect to Boltwork</b>, then approve here.</li>
      </ol>
      <p className="hint">The extension ID should be <code>{status?.extensionId}</code>. Boltwork only talks to that ID.</p>
    </div>
    <div className="settings-section">
      <h3>Connected browsers ({status?.pairings.length ?? 0})</h3>
      {status?.pairings.length === 0 && <p className="muted">None yet.</p>}
      {status?.pairings.map(p => (
        <div key={p.id} className="list-row"><span className="list-icon"><Ico icon={Puzzle} /></span>
          <span className="grow"><b>{p.name}</b><span className="muted small">Connected {new Date(p.createdAt).toLocaleDateString()} · last used {new Date(p.lastUsedAt).toLocaleString()}</span></span>
          <Button small onClick={() => run(api.browserRevoke(p.id), 'Disconnected')}>Disconnect</Button>
        </div>
      ))}
    </div>
    <div className="settings-section">
      <h3>Using it</h3>
      <p className="muted">Click a username or password field and pick a login from the menu, or press <b>Ctrl+Shift+L</b> to fill the best match.
        After you sign in with a new password, the extension offers to save or update it. Use the toolbar icon to search all your logins.
        Sites that use passkeys get Boltwork’s passkeys too.</p>
    </div>
    <WindowsPasskeys />
  </>);
}

type ProviderStatus = Awaited<ReturnType<typeof api.passkeyProviderStatus>>;

/** Boltwork in Windows' own passkey dialog, for apps and browsers without the extension. */
function WindowsPasskeys() {
  const { run, app } = useApp();
  const [st, setSt] = useState<ProviderStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    let live = true;
    const tick = () => { void api.passkeyProviderStatus().then(s => { if (live) setSt(s); }); };
    tick();
    const t = setInterval(tick, 4000);
    return () => { live = false; clearInterval(t); };
  }, []);
  if (app?.platform !== 'win32' || !st) return null;
  const install = async () => {
    setInstalling(true);
    try { const s = await run(api.passkeyProviderInstall(), 'Boltwork added to Windows. Turn it on in the settings page that opened.'); if (s) setSt(s); }
    finally { setInstalling(false); }
  };
  const register = async () => { const s = await run(api.passkeyProviderRegister(), 'Boltwork added to Windows'); if (s) setSt(s); };
  return (
    <div className="settings-section">
      <h3>Windows passkeys</h3>
      <p className="muted">Lets Windows’ own passkey dialog offer Boltwork, in any browser or app, not just Chrome with the extension. Needs Windows 11 with the November 2025 update or later.</p>
      {!st.installed && st.bundled ? (<>
        <p className="muted">Setting up installs Boltwork’s small passkey helper. Windows asks for administrator permission to trust Boltwork’s signing certificate, then opens the page where you turn Boltwork on.</p>
        <Button kind="primary" disabled={installing} onClick={install}>{installing ? 'Setting up…' : 'Set up Windows passkeys'}</Button>
      </>) : !st.installed ? (
        <p className="hint">The Boltwork passkey helper isn’t installed on this computer, and this copy of Boltwork doesn’t include it. Install Boltwork with its setup program to get it, or see <code>native/passkey-provider</code> in the Boltwork source.</p>
      ) : st.state === 'enabled' ? (<>
        <div className="agent-status ok">● Boltwork is a passkey provider in Windows</div>
        <div className="row gap">
          <Button onClick={() => run(api.openWindowsPasskeySettings())}>Open Windows passkey settings</Button>
          <Button onClick={async () => { const s = await run(api.passkeyProviderUnregister(), 'Removed from Windows'); if (s) setSt(s); }}>Remove from Windows</Button>
        </div>
      </>) : st.state === 'disabled' ? (<>
        <div className="agent-status bad">● Added, but turned off in Windows</div>
        <p className="muted">In Windows Settings, open <b>Accounts → Passkeys → Advanced options</b> and turn on <b>Boltwork</b>.</p>
        <Button kind="primary" onClick={() => run(api.openWindowsPasskeySettings())}>Open Windows passkey settings</Button>
      </>) : (<>
        <p className="muted">The provider is installed. Add Boltwork to Windows, then turn it on in Windows Settings.</p>
        <Button kind="primary" onClick={register}>Add Boltwork to Windows</Button>
      </>)}
      {st.error && <p className="hint">{st.error}</p>}
    </div>
  );
}
