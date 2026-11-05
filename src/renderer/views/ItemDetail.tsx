import { useEffect, useState } from 'react';
import { TEMPLATE_BY_CATEGORY } from '../../core/templates';
import type { Field, Item, Strength, WatchtowerCheck } from '../../core/types';
import { api } from '../api';
import { Button, ColoredPassword, Empty, IconButton, ItemIcon, Menu, Modal, StrengthMeter, timeAgo } from '../components/ui';
import { useApp } from '../state';

export function useTotp(value: string | undefined) {
  const [state, setState] = useState<{ code: string; remaining: number; period: number } | { error: string } | null>(null);
  useEffect(() => {
    if (!value) { setState(null); return; }
    let live = true;
    const tick = () => { void api.totp(value).then(r => { if (live) setState(r); }); };
    tick();
    const t = setInterval(tick, 1000);
    return () => { live = false; clearInterval(t); };
  }, [value]);
  return state;
}

function TotpValue({ value, onCopy }: { value: string; onCopy: (code: string) => void }) {
  const t = useTotp(value);
  if (!t) return null;
  if ('error' in t) return <span className="error-text">{t.error}</span>;
  const pct = (t.remaining / t.period) * 100;
  return (
    <span className="totp" onClick={() => onCopy(t.code)} title="Click to copy">
      <span className="mono totp-code">{t.code.slice(0, Math.ceil(t.code.length / 2))} {t.code.slice(Math.ceil(t.code.length / 2))}</span>
      <span className="totp-ring" style={{ background: `conic-gradient(var(--accent) ${pct}%, var(--line) 0)` }}><span>{t.remaining}</span></span>
    </span>
  );
}

function FieldRow({ itemId, field }: { itemId: string; field: Field }) {
  const { settings, run, reveal, toggleReveal } = useApp();
  const [strength, setStrength] = useState<Strength | null>(null);
  const key = `${itemId}:${field.id}`;
  // With "conceal by default" off, the reveal toggle works in reverse (click to hide).
  const shown = (settings?.concealPasswords === false ? !reveal(key) : reveal(key)) && !settings?.privacyMode;
  useEffect(() => {
    if (field.purpose === 'password' && field.value) void api.rateStrength(field.value).then(setStrength);
  }, [field.purpose, field.value]);
  if (!field.value) return null;
  const copy = (text = field.value, label = field.label) => run(api.copy(text, field.type === 'concealed' || field.type === 'totp').then(() => api.markUsed(itemId)), `Copied ${label}`);
  const concealed = field.type === 'concealed';
  let body: React.ReactNode;
  if (field.type === 'totp') body = <TotpValue value={field.value} onCopy={code => copy(code, 'one-time password')} />;
  else if (concealed && field.id === 'privateKey' && field.value.includes('PRIVATE KEY')) body = shown ? <pre className="mono small key-pre">{field.value}</pre> : <span className="mono dots">••••••••••</span>;
  else if (concealed) body = shown ? <ColoredPassword value={field.value} /> : <span className="mono dots">••••••••••</span>;
  else if (settings?.privacyMode) body = <span className="muted">••••••</span>;
  else if (field.type === 'url') body = <a href="#" onClick={e => { e.preventDefault(); void run(api.openUrl(field.value)); }}>{field.value}</a>;
  else body = <span className={field.type === 'multiline' ? 'pre' : ''}>{field.value}</span>;
  return (
    <div className="field-row">
      <div className="field-main" onClick={() => field.type !== 'totp' && copy()}>
        <div className="field-label">{field.label}</div>
        <div className="field-value">{body}</div>
        {field.purpose === 'password' && <StrengthMeter strength={strength} />}
      </div>
      <div className="field-actions">
        {concealed && <IconButton title={shown ? 'Conceal' : 'Reveal'} onClick={() => toggleReveal(key)}>{shown ? '🙈' : '👁'}</IconButton>}
        {field.type !== 'totp' && <IconButton title="Copy" onClick={() => copy()}>⧉</IconButton>}
        <Menu trigger={<IconButton title="More" onClick={() => undefined}>⋯</IconButton>} items={[
          { label: 'Show in Large Type', onClick: () => api.largeType(field.value) },
          { label: 'Copy', onClick: () => copy() },
        ]} />
      </div>
    </div>
  );
}

const IGNORABLE: { check: WatchtowerCheck; label: string }[] = [
  { check: 'weak', label: 'Weak password' }, { check: 'reused', label: 'Reused password' }, { check: 'inactive2fa', label: 'Two-factor authentication' },
  { check: 'unsecured', label: 'Unsecured website' }, { check: 'duplicate', label: 'Duplicate item' }, { check: 'expiring', label: 'Expiring' },
];

function HistoryModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { run } = useApp();
  return (
    <Modal title="Item history" onClose={onClose} wide>
      {item.history.length === 0 && <p className="muted">No previous versions yet. Each time you save changes, the old version is kept here.</p>}
      {item.history.map((v, i) => (
        <div key={i} className="history-row">
          <div>
            <div><b>{v.content.title}</b> <span className="muted">· saved {timeAgo(v.savedAt)}</span></div>
            <div className="muted small">{v.content.fields.filter(f => f.value).map(f => f.label).join(', ')}</div>
          </div>
          <Button small onClick={async () => { await run(api.restoreVersion(item.id, i), 'Version restored'); onClose(); }}>Restore</Button>
        </div>
      ))}
    </Modal>
  );
}

function MoveModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { data, run } = useApp();
  return (
    <Modal title={`Move “${item.title}”`} onClose={onClose}>
      {data!.vaults.map(v => (
        <button key={v.id} className="vault-choice" disabled={v.id === item.vaultId} onClick={async () => { await run(api.move(item.id, v.id), `Moved to ${v.name}`); onClose(); }}>
          <span>{v.icon}</span> {v.name} {v.id === item.vaultId && <span className="muted">(current)</span>}
        </button>
      ))}
    </Modal>
  );
}

export function ItemDetail({ id }: { id: string }) {
  const { data, navigate, run, settings } = useApp();
  const [modal, setModal] = useState<'history' | 'move' | null>(null);
  const item = data?.items.find(i => i.id === id);
  if (!item) return <div className="detail-pane"><Empty icon="🗝️" title="Item not found" /></div>;
  const vault = data!.vaults.find(v => v.id === item.vaultId);
  const t = TEMPLATE_BY_CATEGORY[item.category];
  const deleted = item.state === 'deleted';

  return (
    <section className="detail-pane">
      <div className="detail-toolbar">
        {item.state === 'active' && <Button small kind="primary" onClick={() => navigate(`/edit/${item.id}`)}>Edit</Button>}
        {item.state !== 'active' && <Button small onClick={() => run(api.restore(item.id), 'Item restored')}>Restore</Button>}
        {deleted && <Button small kind="danger" onClick={async () => { if (confirm('Delete this item permanently? This cannot be undone.')) { await run(api.purge(item.id), 'Deleted permanently'); navigate('/'); } }}>Delete permanently</Button>}
        <span className="spacer" />
        {item.state === 'active' && <IconButton title={item.favorite ? 'Remove from favorites' : 'Add to favorites'} active={item.favorite} onClick={() => run(api.setFavorite(item.id, !item.favorite))}>{item.favorite ? '★' : '☆'}</IconButton>}
        <Menu trigger={<IconButton title="More actions" onClick={() => undefined}>⋯</IconButton>} items={[
          { label: 'Duplicate', onClick: async () => { const d = await run(api.duplicateItem(item.id), 'Item duplicated'); if (d) navigate(`/edit/${d.id}`); } },
          { label: 'Move to vault…', onClick: () => setModal('move') },
          { label: 'Item history…', onClick: () => setModal('history') },
          ...(item.category === 'sshKey' ? [
            { label: 'Save public key (.pub)…', onClick: () => run(api.sshExport(item.id, 'public')) },
            { label: 'Export private key…', onClick: () => { if (confirm('The exported file is not encrypted. Anyone who gets it can use this key. Continue?')) void run(api.sshExport(item.id, 'private')); } },
          ] : []),
          { label: 'Copy item link', onClick: () => run(api.copy(`strongroom://item/${item.id}`, false), 'Link copied (opens this item in Strongroom)') },
          { separator: true },
          ...IGNORABLE.map(x => ({
            label: `${item.watchtowerIgnore.includes(x.check) ? '✓ ' : ''}Ignore Watchtower: ${x.label}`,
            onClick: () => run(api.setWatchtowerIgnore(item.id, item.watchtowerIgnore.includes(x.check) ? item.watchtowerIgnore.filter(c => c !== x.check) : [...item.watchtowerIgnore, x.check])),
          })),
          { separator: true },
          ...(item.state === 'active' ? [{ label: 'Archive', onClick: () => run(api.archive(item.id), 'Moved to Archive') }] : []),
          ...(!deleted ? [{ label: 'Delete', danger: true, onClick: () => run(api.trash(item.id), 'Moved to Recently Deleted') }] : []),
        ]} />
      </div>
      <div className="detail-scroll">
        <div className="detail-head">
          <ItemIcon item={item} size={56} />
          <div>
            <h1>{item.title}</h1>
            <div className="muted">{t.name} · {vault?.icon} {vault?.name}{item.state === 'archived' ? ' · Archived' : ''}{deleted ? ' · Deleted' : ''}</div>
          </div>
        </div>

        <div className="card">
          {item.fields.map(f => <FieldRow key={f.id} itemId={item.id} field={f} />)}
          {item.urls.map((u, i) => (
            <div key={i} className="field-row">
              <div className="field-main" onClick={() => run(api.openUrl(u.url).then(() => api.markUsed(item.id)))}>
                <div className="field-label">{u.label || 'website'}</div>
                <div className="field-value"><a href="#" onClick={e => e.preventDefault()}>{settings?.privacyMode ? '••••••' : u.url}</a></div>
              </div>
              <div className="field-actions">
                <IconButton title="Copy" onClick={() => run(api.copy(u.url, false), 'Copied website')}>⧉</IconButton>
                <IconButton title="Open and copy password" onClick={() => {
                  const pw = item.fields.find(f => f.purpose === 'password')?.value;
                  void run(api.openUrl(u.url).then(() => (pw ? api.copy(pw, true) : undefined)).then(() => api.markUsed(item.id)), pw ? 'Opened; password copied' : undefined);
                }}>↗</IconButton>
              </div>
            </div>
          ))}
        </div>

        {item.sections.filter(s => s.fields.some(f => f.value)).map(s => (
          <div key={s.id} className="card">
            {s.title && <div className="card-title">{s.title}</div>}
            {s.fields.map(f => <FieldRow key={f.id} itemId={item.id} field={f} />)}
          </div>
        ))}

        {item.notes && (
          <div className="card"><div className="card-title">Notes</div><div className="notes">{settings?.privacyMode ? '••••••' : item.notes}</div></div>
        )}

        {item.attachments.length > 0 && (
          <div className="card">
            <div className="card-title">Attachments</div>
            {item.attachments.map(a => (
              <div key={a.id} className="field-row">
                <div className="field-main" onClick={() => run(api.saveAttachment(item.id, a.id))}>
                  <div className="field-value">📎 {a.name}</div>
                  <div className="field-label">{(a.size / 1024).toFixed(1)} KB · added {timeAgo(a.addedAt)}</div>
                </div>
                <div className="field-actions"><IconButton title="Save a copy" onClick={() => run(api.saveAttachment(item.id, a.id))}>⬇</IconButton></div>
              </div>
            ))}
          </div>
        )}

        {item.tags.length > 0 && <div className="tags">{item.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}</div>}

        <div className="meta">
          <div>Modified {timeAgo(item.updatedAt)} · Created {new Date(item.createdAt).toLocaleDateString()}</div>
          {item.lastUsedAt && <div>Last used {timeAgo(item.lastUsedAt)} · used {item.useCount} times</div>}
          {item.passwordChangedAt && <div>Password changed {timeAgo(item.passwordChangedAt)}</div>}
          {item.history.length > 0 && <button className="link" onClick={() => setModal('history')}>View {item.history.length} previous version{item.history.length > 1 ? 's' : ''}</button>}
        </div>
      </div>
      {modal === 'history' && <HistoryModal item={item} onClose={() => setModal(null)} />}
      {modal === 'move' && <MoveModal item={item} onClose={() => setModal(null)} />}
    </section>
  );
}
