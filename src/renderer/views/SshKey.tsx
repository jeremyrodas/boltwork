import { useEffect, useState } from 'react';
import type { SshAgentStatus } from '../../core/api';
import type { SshKeyInfo, SshKeyType } from '../../core/ssh';
import type { Field } from '../../core/types';
import { api } from '../api';
import { Terminal } from 'lucide-react';
import { Ico } from '../components/icons';
import { askConfirm, Button, PasswordInput, Toggle } from '../components/ui';
import { useApp } from '../state';

/** Editor body for SSH Key items: generate or import a key; the fields themselves are not hand-edited. */
export function SshKeyEditor({ fields, title, onKey }: { fields: Field[]; title: string; onKey: (info: SshKeyInfo) => void }) {
  const { run, toast } = useApp();
  const f = (id: string) => fields.find(x => x.id === id)?.value ?? '';
  const [mode, setMode] = useState<'choose' | 'import'>('choose');
  const [type, setType] = useState<SshKeyType>('ed25519');
  const [text, setText] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const has = !!f('privateKey');

  const generate = async () => {
    if (has && !(await askConfirm('Replace this key?', 'Servers and services that trust the old public key will stop accepting it until you add the new one.', 'Replace key', true))) return;
    setBusy(true);
    const info = await run(api.sshGenerate(type, title.trim()));
    setBusy(false);
    if (info) { onKey(info); toast('New SSH key generated'); }
  };
  const doImport = async () => {
    const info = await run(api.sshImport(text, passphrase || undefined, title.trim() || undefined));
    if (info) { onKey(info); setText(''); setPassphrase(''); setMode('choose'); toast('SSH key imported'); }
  };

  return (
    <div>
      {has && (
        <div className="ssh-summary">
          <div className="edit-field"><label className="lbl">public key</label><div className="mono small wrap-all">{f('publicKey')}</div></div>
          <div className="edit-field"><label className="lbl">fingerprint</label><div className="mono small">{f('fingerprint')}</div></div>
          <div className="edit-field"><label className="lbl">key type</label><div>{f('keyType')}</div></div>
        </div>
      )}
      {mode === 'choose' && (
        <div className="row gap wrap">
          <select value={type} onChange={e => setType(e.target.value as SshKeyType)} title="Key type">
            <option value="ed25519">Ed25519 (recommended)</option>
            <option value="rsa2048">RSA 2048-bit</option>
            <option value="rsa3072">RSA 3072-bit</option>
            <option value="rsa4096">RSA 4096-bit</option>
          </select>
          <Button kind={has ? 'default' : 'primary'} disabled={busy} onClick={generate}>{busy ? 'Generating…' : has ? 'Replace with new key' : 'Generate new key'}</Button>
          <Button onClick={() => setMode('import')}>Import existing key…</Button>
        </div>
      )}
      {mode === 'import' && (
        <div className="edit-field">
          <label className="lbl">private key</label>
          <textarea className="mono small" rows={7} value={text} onChange={e => setText(e.target.value)} spellCheck={false}
            placeholder={'Paste a private key (OpenSSH or PEM), or choose a file such as ~/.ssh/id_ed25519'} />
          <label className="lbl">passphrase (PEM keys only, if it has one)</label>
          <PasswordInput value={passphrase} onChange={setPassphrase} />
          <div className="row gap" style={{ marginTop: 8 }}>
            <Button onClick={async () => {
              const input = document.createElement('input');
              input.type = 'file';
              input.onchange = async () => { const file = input.files?.[0]; if (file) setText(await file.text()); };
              input.click();
            }}>Choose file…</Button>
            <span className="spacer" />
            <Button onClick={() => setMode('choose')}>Cancel</Button>
            <Button kind="primary" disabled={!text.trim()} onClick={doImport}>Import</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const WIN_DISABLE = 'Stop-Service ssh-agent; Set-Service ssh-agent -StartupType Disabled';

export function SshAgentPane() {
  const { settings, updateSettings, app, run, navigate, setFilter } = useApp();
  const [status, setStatus] = useState<SshAgentStatus | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () => { void api.sshAgentStatus().then(s => { if (live) setStatus(s); }); };
    tick();
    const t = setInterval(tick, 1500);
    return () => { live = false; clearInterval(t); };
  }, [settings?.sshAgentEnabled]);
  if (!settings) return null;
  const win = app?.platform === 'win32';

  return (<>
    <div className="settings-section">
      <h3>SSH agent</h3>
      <Toggle label="Use the Strongroom SSH agent" hint="Lets ssh, git and other tools sign in with SSH keys stored in Strongroom. Private keys never leave the app, and you approve each use."
        checked={settings.sshAgentEnabled} onChange={v => updateSettings({ sshAgentEnabled: v })} />
      {status && settings.sshAgentEnabled && (
        <div className={`agent-status ${status.running ? 'ok' : 'bad'}`}>
          {status.running ? <>● Running on <code>{status.socket}</code></> : <>● Not running: {status.error} <button className="link" onClick={async () => { await updateSettings({ sshAgentEnabled: false }); await updateSettings({ sshAgentEnabled: true }); }}>Try again</button></>}
        </div>
      )}
      {status?.inUse && win && (
        <div className="banner">
          The Windows <b>OpenSSH Authentication Agent</b> service is using the SSH agent pipe. Turn it off, then turn the setting above off and on again.
          In PowerShell <b>as administrator</b>:
          <div className="code-row"><code>{WIN_DISABLE}</code><Button small onClick={() => run(api.copy(WIN_DISABLE, false), 'Command copied')}>Copy</Button></div>
        </div>
      )}
    </div>
    <div className="settings-section">
      <h3>Keys the agent offers ({status?.keys.length ?? 0})</h3>
      {status && status.keys.length === 0 && <p className="muted">No SSH keys yet. <button className="link" onClick={() => navigate('/new/sshKey')}>Create one</button></p>}
      {status?.keys.map(k => (
        <div key={k.fingerprint} className="list-row"><span className="list-icon"><Ico icon={Terminal} /></span>
          <span className="grow"><b>{k.title}</b><span className="muted small mono">{k.keyType} · {k.fingerprint}</span></span>
        </div>
      ))}
      {status && status.keys.length > 5 && <p className="hint">SSH servers usually allow about 6 attempts. With many keys, point each host at its key in ~/.ssh/config with IdentityFile set to the saved public key.</p>}
      {status && status.keys.length > 0 && <button className="link" onClick={() => setFilter({ kind: 'category', category: 'sshKey' })}>Show SSH keys</button>}
    </div>
    <div className="settings-section">
      <h3>Set up your tools</h3>
      {win ? (<>
        <p className="muted">Windows’ built-in OpenSSH (<code>ssh</code> in PowerShell or Command Prompt) uses the agent automatically.</p>
        <p className="muted">For Git, tell it to use Windows OpenSSH (Git Bash’s own ssh can’t reach the agent):</p>
        <div className="code-row"><code>git config --global core.sshCommand C:/Windows/System32/OpenSSH/ssh.exe</code>
          <Button small onClick={() => run(api.copy('git config --global core.sshCommand C:/Windows/System32/OpenSSH/ssh.exe', false), 'Command copied')}>Copy</Button></div>
      </>) : (<>
        <p className="muted">Add this to <code>~/.ssh/config</code>:</p>
        <div className="code-row"><code>{`Host *\n  IdentityAgent "${status?.socket ?? '~/.strongroom/agent.sock'}"`}</code>
          <Button small onClick={() => run(api.copy(`Host *\n  IdentityAgent "${status?.socket}"\n`, false), 'Copied')}>Copy</Button></div>
      </>)}
      <p className="muted">Add a server’s key: open the SSH Key item, copy its public key, and add it to <code>~/.ssh/authorized_keys</code> on the server (or paste it into GitHub → Settings → SSH keys).</p>
      <p className="muted">Test it with <code>ssh -T git@github.com</code>. Strongroom will ask you to approve.</p>
    </div>
  </>);
}
