import { useState } from 'react';
import type { ImportPreview } from '../../core/api';
import { IMPORT_SOURCES } from '../../core/importSources';
import { SECURITY_PRESETS, type PresetName } from '../../core/settings';
import type { Collection, Vault } from '../../core/types';
import { api } from '../api';
import { Button, Modal, PasswordInput, StrengthMeter, Toggle, useStrength } from '../components/ui';
import { useApp } from '../state';
import { SshAgentPane } from './SshKey';
import { BrowserPane } from './BrowserPane';
import { SyncPane } from './SyncPane';
import { QuickUnlockSection } from './QuickUnlockSection';

const PANES = [
  ['general', '⚙️', 'General'], ['appearance', '🎨', 'Appearance'], ['security', '🔐', 'Security'], ['sync', '🛰️', 'Sync'], ['privacy', '🕶️', 'Privacy'],
  ['quickaccess', '⚡', 'Quick Access & Auto-Type'], ['browser', '🧩', 'Browser Extension'], ['ssh', '🗝️', 'SSH Agent'], ['vaults', '🗂️', 'Vaults & Collections'], ['import', '📥', 'Import'],
  ['export', '📤', 'Export'], ['shortcuts', '⌨️', 'Keyboard Shortcuts'], ['about', 'ℹ️', 'About'],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="settings-section"><h3>{title}</h3>{children}</div>;
}

function NumberSelect({ label, value, options, onChange, hint }: { label: string; value: number; options: [number, string][]; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="toggle-row">
      <span><span className="toggle-label">{label}</span>{hint && <span className="hint">{hint}</span>}</span>
      <select value={value} onChange={e => onChange(+e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>
  );
}

function ReauthModal({ title, action, onClose, extra }: { title: string; action: (pw: string, extra: string) => Promise<unknown>; onClose: () => void; extra?: string }) {
  const [pw, setPw] = useState('');
  const [ex, setEx] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    setErr('');
    try { await action(pw, ex); onClose(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <label className="lbl">Account password</label>
      <PasswordInput value={pw} onChange={setPw} autoFocus onEnter={go} />
      {extra && (<><label className="lbl">{extra}</label><PasswordInput value={ex} onChange={setEx} onEnter={go} /></>)}
      {err && <p className="error-text">{err}</p>}
      <div className="row gap end"><Button onClick={onClose}>Cancel</Button><Button kind="primary" onClick={go} disabled={!pw}>Continue</Button></div>
    </Modal>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const { run } = useApp();
  const [oldPw, setOld] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const strength = useStrength(pw);
  return (
    <Modal title="Change account password" onClose={onClose}>
      <label className="lbl">Current password</label><PasswordInput value={oldPw} onChange={setOld} autoFocus />
      <label className="lbl">New password</label><PasswordInput value={pw} onChange={setPw} />
      <StrengthMeter strength={pw ? strength : null} />
      <label className="lbl">Confirm new password</label><PasswordInput value={confirm} onChange={setConfirm} />
      {confirm && pw !== confirm && <p className="warn-text">The passwords don’t match.</p>}
      <div className="row gap end">
        <Button onClick={onClose}>Cancel</Button>
        <Button kind="primary" disabled={!oldPw || pw.length < 8 || pw !== confirm || (strength?.level ?? 0) < 3}
          onClick={async () => { const ok = await run(api.changePassword(oldPw, pw).then(() => true), 'Account password changed'); if (ok) onClose(); }}>Change password</Button>
      </div>
    </Modal>
  );
}

function SecurityPane() {
  const { settings, updateSettings, run } = useApp();
  const [modal, setModal] = useState<'password' | 'reveal' | null>(null);
  const [secretKey, setSecretKey] = useState('');
  if (!settings) return null;
  return (<>
    <Section title="Security preset">
      <div className="presets">
        {(Object.keys(SECURITY_PRESETS) as PresetName[]).map(p => (
          <button key={p} className={`preset${settings.securityPreset === p ? ' on' : ''}`} onClick={() => run(api.applyPreset(p), `${SECURITY_PRESETS[p].name} applied`)}>
            <b>{SECURITY_PRESETS[p].name}</b><span className="muted small">{SECURITY_PRESETS[p].description}</span>
          </button>
        ))}
      </div>
      {settings.securityPreset === 'custom' && <p className="hint">You’re using custom settings.</p>}
    </Section>
    <QuickUnlockSection />
    <Section title="Auto-lock">
      <NumberSelect label="Lock after the computer is idle for" value={settings.autolockMinutes} onChange={v => updateSettings({ autolockMinutes: v })}
        options={[[1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours'], [480, '8 hours'], [0, 'Never']]} />
      <Toggle label="Lock when the computer sleeps" checked={settings.lockOnSleep} onChange={v => updateSettings({ lockOnSleep: v })} />
      <Toggle label="Lock when the screen locks" checked={settings.lockOnScreenLock} onChange={v => updateSettings({ lockOnScreenLock: v })} />
      <Toggle label="Lock when the window is closed" checked={settings.lockOnTrayClose} onChange={v => updateSettings({ lockOnTrayClose: v })} />
    </Section>
    <Section title="Clipboard">
      <NumberSelect label="Clear copied passwords after" value={settings.clipboardClearSeconds} onChange={v => updateSettings({ clipboardClearSeconds: v })}
        options={[[30, '30 seconds'], [90, '90 seconds'], [180, '3 minutes'], [300, '5 minutes'], [0, 'Never']]} />
      <Toggle label="Notify when the clipboard is cleared" checked={settings.notifyClipboardCleared} onChange={v => updateSettings({ notifyClipboardCleared: v })} />
    </Section>
    <Section title="Screen">
      <Toggle label="Hide Strongroom from screenshots and screen sharing" checked={settings.screenCaptureProtection} onChange={v => updateSettings({ screenCaptureProtection: v })} />
      <Toggle label="Blur the window when it is not in focus" hint="Keeps passwords from being read over your shoulder." checked={settings.blurWhenUnfocused} onChange={v => updateSettings({ blurWhenUnfocused: v })} />
    </Section>
    <Section title="Account">
      <div className="row gap wrap">
        <Button onClick={() => setModal('password')}>Change account password…</Button>
        <Button onClick={() => setModal('reveal')}>Show Secret Key…</Button>
        <Button onClick={() => run(api.emergencyKit(), 'Emergency Kit saved')}>Save Emergency Kit…</Button>
      </div>
      {secretKey && <div className="secret-key small-key" onClick={() => setSecretKey('')} title="Click to hide">{secretKey}</div>}
    </Section>
    <Section title="Item history">
      <NumberSelect label="Keep previous versions per item" value={settings.historyLimit} onChange={v => updateSettings({ historyLimit: v })}
        options={[[5, '5'], [10, '10'], [30, '30'], [100, '100']]} />
      <NumberSelect label="Delete items in Recently Deleted after" value={settings.emptyTrashDays} onChange={v => updateSettings({ emptyTrashDays: v })}
        options={[[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'Never']]} />
    </Section>
    {modal === 'password' && <ChangePassword onClose={() => setModal(null)} />}
    {modal === 'reveal' && <ReauthModal title="Show Secret Key" onClose={() => setModal(null)} action={async pw => setSecretKey(await api.revealSecretKey(pw))} />}
  </>);
}

function VaultsPane() {
  const { data, run } = useApp();
  const [editing, setEditing] = useState<Partial<Vault> | null>(null);
  const [col, setCol] = useState<Partial<Collection> | null>(null);
  const [tagFrom, setTagFrom] = useState('');
  const [tagTo, setTagTo] = useState('');
  if (!data) return null;
  const tags = [...new Set(data.items.flatMap(i => i.tags))].sort();
  return (<>
    <Section title="Vaults">
      {data.vaults.map(v => (
        <div key={v.id} className="list-row">
          <span className="emoji">{v.icon}</span>
          <span className="grow"><b>{v.name}</b><span className="muted small">{v.description} · {data.items.filter(i => i.vaultId === v.id && i.state !== 'deleted').length} items</span></span>
          <Button small onClick={() => setEditing(v)}>Edit</Button>
          <Button small kind="danger" disabled={data.vaults.length <= 1} onClick={async () => {
            const count = data.items.filter(i => i.vaultId === v.id).length;
            const other = data.vaults.find(x => x.id !== v.id)!;
            if (count && confirm(`Move ${count} item(s) to “${other.name}” before deleting? Choose Cancel to delete them too.`)) await run(api.deleteVault(v.id, other.id), 'Vault deleted');
            else if (confirm(`Delete “${v.name}”${count ? ` and its ${count} item(s)` : ''} permanently?`)) await run(api.deleteVault(v.id), 'Vault deleted');
          }}>Delete</Button>
        </div>
      ))}
      <Button onClick={() => setEditing({ name: '', description: '', icon: '🗂️' })}>＋ New vault</Button>
    </Section>
    <Section title="Collections">
      <p className="hint">Collections group vaults so you can focus on, say, Work or Family. Pick one at the top of the sidebar.</p>
      {data.collections.map(c => (
        <div key={c.id} className="list-row">
          <span className="grow"><b>{c.name}</b><span className="muted small">{c.vaultIds.map(id => data.vaults.find(v => v.id === id)?.name).filter(Boolean).join(', ') || 'No vaults'}</span></span>
          <Button small onClick={() => setCol(c)}>Edit</Button>
          <Button small kind="danger" onClick={() => run(api.deleteCollection(c.id), 'Collection deleted')}>Delete</Button>
        </div>
      ))}
      <Button onClick={() => setCol({ name: '', vaultIds: [] })}>＋ New collection</Button>
    </Section>
    {tags.length > 0 && (
      <Section title="Rename a tag">
        <div className="row gap">
          <select value={tagFrom} onChange={e => { setTagFrom(e.target.value); setTagTo(e.target.value); }}><option value="">Choose tag</option>{tags.map(t => <option key={t}>{t}</option>)}</select>
          <input value={tagTo} onChange={e => setTagTo(e.target.value)} placeholder="New name (empty removes it)" />
          <Button disabled={!tagFrom} onClick={() => run(api.renameTag(tagFrom, tagTo.trim()), 'Tag updated').then(() => { setTagFrom(''); setTagTo(''); })}>Apply</Button>
        </div>
      </Section>
    )}
    {editing && (
      <Modal title={editing.id ? 'Edit vault' : 'New vault'} onClose={() => setEditing(null)}>
        <label className="lbl">Name</label><input autoFocus value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
        <label className="lbl">Description</label><input value={editing.description ?? ''} onChange={e => setEditing({ ...editing, description: e.target.value })} />
        <label className="lbl">Icon</label>
        <div className="emoji-pick">{['🏠', '💼', '👪', '💰', '✈️', '🎮', '🧪', '🗂️', '🔒', '🌐', '🏥', '🎓'].map(e => (
          <button key={e} className={editing.icon === e ? 'on' : ''} onClick={() => setEditing({ ...editing, icon: e })}>{e}</button>
        ))}</div>
        <div className="row gap end"><Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button kind="primary" disabled={!editing.name?.trim()} onClick={async () => { await run(api.saveVault({ ...editing, name: editing.name!.trim() }), 'Vault saved'); setEditing(null); }}>Save</Button></div>
      </Modal>
    )}
    {col && (
      <Modal title={col.id ? 'Edit collection' : 'New collection'} onClose={() => setCol(null)}>
        <label className="lbl">Name</label><input autoFocus value={col.name ?? ''} onChange={e => setCol({ ...col, name: e.target.value })} />
        <label className="lbl">Vaults</label>
        {data.vaults.map(v => (
          <label key={v.id} className="check"><input type="checkbox" checked={col.vaultIds?.includes(v.id) ?? false}
            onChange={e => setCol({ ...col, vaultIds: e.target.checked ? [...(col.vaultIds ?? []), v.id] : (col.vaultIds ?? []).filter(x => x !== v.id) })} /> {v.icon} {v.name}</label>
        ))}
        <div className="row gap end"><Button onClick={() => setCol(null)}>Cancel</Button>
          <Button kind="primary" disabled={!col.name?.trim()} onClick={async () => { await run(api.saveCollection({ ...col, name: col.name!.trim(), vaultIds: col.vaultIds ?? [] }), 'Collection saved'); setCol(null); }}>Save</Button></div>
      </Modal>
    )}
  </>);
}

function ImportPane() {
  const { data, run, navigate, setFilter } = useApp();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [password, setPassword] = useState('');
  const [target, setTarget] = useState('');
  if (!data) return null;
  const choose = async () => { const p = await run(api.importChoose()); if (p) { setPreview(p); setTarget(p.vaultNames?.length ? 'byName' : data.vaults[0].id); } };
  return (<>
    <Section title="Import passwords">
      <p className="muted">Strongroom figures out the format from the file. Delete the exported file after importing; it isn’t encrypted.</p>
      <div className="import-sources">{IMPORT_SOURCES.map(s => <div key={s.id} className="import-source"><b>{s.name}</b><span className="muted small">{s.hint}</span></div>)}</div>
      <Button kind="primary" onClick={choose}>Choose file…</Button>
    </Section>
    {preview && (
      <Section title={preview.fileName}>
        {preview.needsPassword ? (<>
          <label className="lbl">This backup is encrypted. Export password:</label>
          <PasswordInput value={password} onChange={setPassword} autoFocus onEnter={async () => { const p = await run(api.importPreview(password)); if (p) setPreview(p); }} />
          <Button onClick={async () => { const p = await run(api.importPreview(password)); if (p) setPreview(p); }}>Unlock backup</Button>
        </>) : (<>
          <p>Found <b>{preview.count}</b> item{preview.count === 1 ? '' : 's'} from <b>{preview.source}</b>{preview.skipped ? `, skipped ${preview.skipped} it couldn’t read` : ''}.</p>
          {preview.newCount !== undefined && preview.newCount < (preview.count ?? 0) && (
            <p><b>{preview.newCount}</b> {preview.newCount === 1 ? 'is' : 'are'} new. The other {(preview.count ?? 0) - preview.newCount} {(preview.count ?? 0) - preview.newCount === 1 ? 'is' : 'are'} already in Strongroom and will be skipped, so nothing is duplicated.</p>)}
          <label className="toggle-row"><span className="toggle-label">Import into</span>
            <select value={target} onChange={e => setTarget(e.target.value)}>
              {preview.vaultNames?.length ? <option value="byName">Matching vaults ({preview.vaultNames.join(', ')})</option> : null}
              {data.vaults.map(v => <option key={v.id} value={v.id}>{v.icon} {v.name}</option>)}
            </select>
          </label>
          <div className="row gap"><Button onClick={() => setPreview(null)}>Cancel</Button>
            <Button kind="primary" disabled={!(preview.newCount ?? preview.count)} onClick={async () => {
              const n = await run(api.importCommit(target));
              if (n !== undefined) { setPreview(null); navigate('/'); setFilter({ kind: 'all' }); void run(Promise.resolve(), n === 0 ? 'Nothing new to import: everything in this file is already in Strongroom' : `Imported ${n} new item${n === 1 ? '' : 's'}${n < (preview.count ?? 0) ? ` (${(preview.count ?? 0) - n} already in Strongroom)` : ''}`); }
            }}>{preview.newCount === 0 ? 'Nothing new to import' : `Import ${preview.newCount ?? preview.count} item${(preview.newCount ?? preview.count) === 1 ? '' : 's'}`}</Button></div>
        </>)}
      </Section>
    )}
  </>);
}

function ExportPane() {
  const { run } = useApp();
  const [format, setFormat] = useState<'encrypted' | 'json' | 'csv' | null>(null);
  return (<>
    <Section title="Export your data">
      <div className="presets">
        <button className="preset" onClick={() => setFormat('encrypted')}><b>Encrypted backup (.json)</b><span className="muted small">Everything, protected with a password you choose. Re-import it into Strongroom any time.</span></button>
        <button className="preset" onClick={() => setFormat('json')}><b>Strongroom JSON</b><span className="muted small">All items and fields, not encrypted.</span></button>
        <button className="preset" onClick={() => setFormat('csv')}><b>CSV</b><span className="muted small">Title, website, username, password, one-time password, notes. Works with most other apps. Not encrypted.</span></button>
      </div>
      <p className="hint">Attachments are not included in exports. Back up the vault folder to keep them.</p>
    </Section>
    {format && (
      <ReauthModal title={`Export ${format === 'csv' ? 'CSV' : format === 'json' ? 'JSON' : 'encrypted backup'}`} onClose={() => setFormat(null)}
        extra={format === 'encrypted' ? 'Password for the backup file (8+ characters)' : undefined}
        action={async (pw, ex) => { const p = await api.exportData(format, pw, ex || undefined); if (p) void run(Promise.resolve(), `Exported to ${p}`); }} />
    )}
  </>);
}

function ShortcutInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <label className="toggle-row">
      <span className="toggle-label">{label}</span>
      <input className="mono shortcut" readOnly value={recording ? 'Press keys…' : value.replace('CommandOrControl', 'Ctrl')} onFocus={() => setRecording(true)} onBlur={() => setRecording(false)}
        onKeyDown={e => {
          e.preventDefault();
          if (e.key === 'Escape') { (e.target as HTMLInputElement).blur(); return; }
          if (e.key === 'Backspace') { onChange(''); (e.target as HTMLInputElement).blur(); return; }
          if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
          const mods = [e.ctrlKey || e.metaKey ? 'CommandOrControl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean);
          if (!mods.length) return;
          const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
          onChange([...mods, key].join('+'));
          (e.target as HTMLInputElement).blur();
        }} />
    </label>
  );
}

export function SettingsView({ pane = 'general' }: { pane?: string }) {
  const { settings, updateSettings, navigate, app } = useApp();
  if (!settings) return null;
  return (
    <section className="settings">
      <nav className="settings-nav">
        {PANES.map(([id, icon, label]) => (
          <button key={id} className={`side-item${pane === id ? ' active' : ''}`} onClick={() => navigate(`/settings/${id}`)}><span className="side-icon">{icon}</span>{label}</button>
        ))}
      </nav>
      <div className="settings-body">
        {pane === 'general' && (<>
          <Section title="Startup">
            <Toggle label="Start Strongroom when you sign in" checked={settings.startAtLogin} onChange={v => updateSettings({ startAtLogin: v })} hint="Only works in the installed app." />
            <Toggle label="Start minimized to the system tray" checked={settings.startMinimized} onChange={v => updateSettings({ startMinimized: v })} />
            <Toggle label="Keep Strongroom in the system tray when the window is closed" checked={settings.keepInTray} onChange={v => updateSettings({ keepInTray: v })} />
          </Section>
          <Section title="Items">
            <Toggle label="Suggest usernames when creating logins" checked={settings.suggestUsername} onChange={v => updateSettings({ suggestUsername: v })} />
            <label className="toggle-row"><span className="toggle-label">Default username or email</span>
              <input value={settings.defaultUsername} onChange={e => updateSettings({ defaultUsername: e.target.value })} placeholder="you@example.com" /></label>
            <Toggle label="Conceal passwords by default" checked={settings.concealPasswords} onChange={v => updateSettings({ concealPasswords: v })} />
          </Section>
        </>)}
        {pane === 'appearance' && (<>
          <Section title="Theme">
            <div className="seg">{(['system', 'light', 'dark'] as const).map(t => <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => updateSettings({ theme: t })}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
          </Section>
          <Section title="Layout">
            <div className="seg">{(['default', 'comfortable'] as const).map(t => <button key={t} className={settings.density === t ? 'on' : ''} onClick={() => updateSettings({ density: t })}>{t === 'default' ? 'Compact' : 'Comfortable'}</button>)}</div>
            <NumberSelect label="Zoom" value={settings.zoom} onChange={v => updateSettings({ zoom: v })} options={[[0.8, '80%'], [0.9, '90%'], [1, '100%'], [1.1, '110%'], [1.25, '125%'], [1.5, '150%']]} />
            <Toggle label="Show categories in the sidebar" checked={settings.sidebarShowCategories} onChange={v => updateSettings({ sidebarShowCategories: v })} />
            <Toggle label="Show tags in the sidebar" checked={settings.sidebarShowTags} onChange={v => updateSettings({ sidebarShowTags: v })} />
          </Section>
        </>)}
        {pane === 'security' && <SecurityPane />}
        {pane === 'privacy' && (<>
          <Section title="Watchtower online checks">
            <Toggle label="Check for vulnerable passwords" hint="Uses Have I Been Pwned. Only the first 5 characters of each password’s SHA-1 hash are sent." checked={settings.checkVulnerable} onChange={v => updateSettings({ checkVulnerable: v })} />
            <Toggle label="Check for compromised websites" hint="Downloads the public list of breached sites and compares it on this device." checked={settings.checkCompromisedSites} onChange={v => updateSettings({ checkCompromisedSites: v })} />
            <Toggle label="Check for sites that support two-factor authentication" hint="Downloads the public 2fa.directory list. A built-in list is always used offline." checked={settings.check2faSites} onChange={v => updateSettings({ check2faSites: v })} />
          </Section>
          <Section title="Display">
            <Toggle label="Download website icons" hint="Asks DuckDuckGo’s icon service for each website’s icon, which reveals the sites you have saved to that service." checked={settings.downloadIcons} onChange={v => updateSettings({ downloadIcons: v })} />
            <Toggle label="Privacy Mode" hint="Hides usernames, websites, notes and revealed passwords on screen." checked={settings.privacyMode} onChange={v => updateSettings({ privacyMode: v })} />
          </Section>
          <Section title="Search">
            <Button onClick={() => api.clearSearchHistory()}>Clear search history</Button>
          </Section>
        </>)}
        {pane === 'quickaccess' && (<>
          <Section title="Quick Access">
            <p className="muted">Quick Access is a search box that opens over any app. Find an item, then press Enter to type your username and password into the app you were using.</p>
            <ShortcutInput label="Open Quick Access" value={settings.quickAccessShortcut} onChange={v => updateSettings({ quickAccessShortcut: v })} />
            <ShortcutInput label="Show or hide Strongroom" value={settings.showShortcut} onChange={v => updateSettings({ showShortcut: v })} />
            <ShortcutInput label="Lock Strongroom" value={settings.lockShortcut} onChange={v => updateSettings({ lockShortcut: v })} />
          </Section>
          <Section title="Auto-Type">
            <Toggle label="Allow Auto-Type" hint={app?.platform === 'win32' ? 'Types the username, Tab, the password and Enter into the window you were using.' : 'Available on Windows. On this system, Enter copies the password instead.'}
              checked={settings.autoTypeEnabled} onChange={v => updateSettings({ autoTypeEnabled: v })} />
          </Section>
        </>)}
        {pane === 'ssh' && <SshAgentPane />}
        {pane === 'browser' && <BrowserPane />}
        {pane === 'sync' && <SyncPane />}
        {pane === 'vaults' && <VaultsPane />}
        {pane === 'import' && <ImportPane />}
        {pane === 'export' && <ExportPane />}
        {pane === 'shortcuts' && (
          <Section title="Keyboard shortcuts">
            <table className="shortcuts"><tbody>
              {[
                [settings.quickAccessShortcut, 'Open Quick Access (from anywhere)'], [settings.showShortcut, 'Show or hide Strongroom (from anywhere)'], [settings.lockShortcut, 'Lock (from anywhere)'],
                ['Ctrl+F', 'Search'], ['Ctrl+N', 'New item'], ['Ctrl+G', 'Password generator'], ['Ctrl+S', 'Save item while editing'], ['Esc', 'Cancel editing / close'],
                ['↑ ↓', 'Move through items'], ['Ctrl+Shift+C', 'Copy password of selected item'], ['Ctrl+Alt+C', 'Copy username of selected item'], ['Ctrl+E', 'Edit selected item'],
                ['Quick Access: Enter', 'Auto-Type (Windows) or copy password'], ['Quick Access: Ctrl+C', 'Copy password'], ['Quick Access: Ctrl+Shift+C', 'Copy username'],
                ['Quick Access: Ctrl+Alt+C', 'Copy one-time password'], ['Quick Access: Ctrl+O', 'Open website and copy password'],
              ].map(([k, d]) => <tr key={k + d}><td className="mono">{k.replace('CommandOrControl', 'Ctrl')}</td><td>{d}</td></tr>)}
            </tbody></table>
          </Section>
        )}
        {pane === 'about' && (
          <Section title="Strongroom">
            <p>Version {app?.version}</p>
            <p className="muted">A local-first password manager. Your vault is encrypted with XChaCha20-Poly1305 using a key derived from your account password (Argon2id) and your 128-bit Secret Key. Your data never leaves this device unless you turn on optional online checks or export it.</p>
            <p className="muted small">Word list for memorable passwords: EFF Large Wordlist (CC BY 3.0). Password strength: zxcvbn-ts. Breach data: Have I Been Pwned. 2FA data: 2fa.directory.</p>
          </Section>
        )}
      </div>
    </section>
  );
}
