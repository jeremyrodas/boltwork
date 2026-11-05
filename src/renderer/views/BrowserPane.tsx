import { useEffect, useState } from 'react';
import type { BrowserStatus } from '../../core/api';
import { api } from '../api';
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
      <Toggle label="Connect to the Strongroom browser extension" hint="Lets the extension fill logins on matching websites and offer to save new ones. It only gets a password when you pick a login."
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
        <li>If the browser was already open before Strongroom first ran, restart it so it finds Strongroom.</li>
        <li>Click the Strongroom icon in the toolbar and choose <b>Connect to Strongroom</b>, then approve here.</li>
      </ol>
      <p className="hint">The extension ID should be <code>{status?.extensionId}</code>. Strongroom only talks to that ID.</p>
    </div>
    <div className="settings-section">
      <h3>Connected browsers ({status?.pairings.length ?? 0})</h3>
      {status?.pairings.length === 0 && <p className="muted">None yet.</p>}
      {status?.pairings.map(p => (
        <div key={p.id} className="list-row"><span className="emoji">🧩</span>
          <span className="grow"><b>{p.name}</b><span className="muted small">Connected {new Date(p.createdAt).toLocaleDateString()} · last used {new Date(p.lastUsedAt).toLocaleString()}</span></span>
          <Button small onClick={() => run(api.browserRevoke(p.id), 'Disconnected')}>Disconnect</Button>
        </div>
      ))}
    </div>
    <div className="settings-section">
      <h3>Using it</h3>
      <p className="muted">Click a username or password field and pick a login from the menu, or press <b>Ctrl+Shift+L</b> to fill the best match.
        After you sign in with a new password, the extension offers to save or update it. Use the toolbar icon to search all your logins.</p>
    </div>
  </>);
}
