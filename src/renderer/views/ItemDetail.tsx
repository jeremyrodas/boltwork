import { useEffect, useState } from 'react';
import { Copy, Download, Ellipsis, ExternalLink, Eye, EyeOff, FileQuestion, Fingerprint, Paperclip, Pencil, Star, Trash2 } from 'lucide-react';
import { previousPasswords } from '../../core/passwordHistory';
import { fieldByPurpose, TEMPLATE_BY_CATEGORY } from '../../core/templates';
import type { Field, Item, Strength, WatchtowerCheck } from '../../core/types';
import { api } from '../api';
import { Ico, VaultIcon } from '../components/icons';
import { askConfirm, Button, ColoredPassword, copiedMessage, Empty, IconButton, ItemIcon, Menu, Modal, StrengthMeter, timeAgo } from '../components/ui';
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

function TotpValue({ t }: { t: ReturnType<typeof useTotp> }) {
  if (!t) return null;
  if ('error' in t) return <span className="error-text">{t.error}</span>;
  const pct = (t.remaining / t.period) * 100;
  // The ring turns amber for the last five seconds, so you don't type a code that's about to expire.
  const ring = t.remaining <= 5 ? 'var(--warn)' : 'var(--accent)';
  return (
    <span className="totp">
      <span className="mono totp-code">{t.code.slice(0, Math.ceil(t.code.length / 2))} {t.code.slice(Math.ceil(t.code.length / 2))}</span>
      <span className="totp-ring" style={{ background: `conic-gradient(${ring} ${pct}%, var(--line) 0)` }} aria-label={`${t.remaining} seconds left`}><span>{t.remaining}</span></span>
    </span>
  );
}

const SHORTCUT: Partial<Record<string, string>> = { password: 'Ctrl+Shift+C', username: 'Ctrl+Alt+C', totp: 'Ctrl+Alt+O' };

function FieldRow({ itemId, field }: { itemId: string; field: Field }) {
  const { settings, run, reveal, toggleReveal, app } = useApp();
  const [strength, setStrength] = useState<Strength | null>(null);
  const key = `${itemId}:${field.id}`;
  // With "conceal by default" off, the reveal toggle works in reverse (click to hide).
  const shown = (settings?.concealPasswords === false ? !reveal(key) : reveal(key)) && !settings?.privacyMode;
  useEffect(() => {
    if (field.purpose === 'password' && field.value) void api.rateStrength(field.value).then(setStrength);
  }, [field.purpose, field.value]);
  const totp = useTotp(field.type === 'totp' ? field.value : undefined);
  if (!field.value) return null;
  const secret = field.type === 'concealed' || field.type === 'totp';
  const copy = (text = field.value, label = field.label) => run(api.copy(text, secret).then(() => api.markUsed(itemId)), copiedMessage(label, secret, settings));
  const copyThis = () => {
    if (field.type !== 'totp') { void copy(); return; }
    if (totp && 'code' in totp) void copy(totp.code, 'one-time code');
  };
  const shortcut = field.purpose ? SHORTCUT[field.purpose] : undefined;
  const copyTitle = `Copy ${field.type === 'totp' ? 'one-time code' : field.label}${shortcut ? ` (${shortcut})` : ''}`;
  const concealed = field.type === 'concealed';
  let body: React.ReactNode;
  if (field.type === 'totp') body = <TotpValue t={totp} />;
  else if (concealed && field.id === 'privateKey' && field.value.includes('PRIVATE KEY')) body = shown ? <pre className="mono small key-pre">{field.value}</pre> : <span className="mono dots">••••••••••</span>;
  else if (concealed) body = shown ? <ColoredPassword value={field.value} /> : <span className="mono dots">••••••••••</span>;
  else if (settings?.privacyMode) body = <span className="muted">••••••</span>;
  else if (field.type === 'url') body = <a href="#" onClick={e => { e.preventDefault(); void run(api.openUrl(field.value)); }}>{field.value}</a>;
  else body = <span className={field.type === 'multiline' ? 'pre' : ''}>{field.value}</span>;
  return (
    <div className="field-row">
      <div className="field-main" role="button" tabIndex={0} aria-label={copyTitle} title={copyTitle} onClick={copyThis}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyThis(); } }}>
        <div className="field-label">{field.label}</div>
        <div className="field-value">{body}</div>
        {field.purpose === 'password' && <StrengthMeter strength={strength} />}
      </div>
      <div className="field-actions">
        {concealed && <IconButton title={shown ? 'Conceal' : 'Reveal'} onClick={() => toggleReveal(key)}><Ico icon={shown ? EyeOff : Eye} /></IconButton>}
        <IconButton title={copyTitle} onClick={copyThis}><Ico icon={Copy} /></IconButton>
        {field.type !== 'totp' && app?.platform !== 'web' && (
          <Menu trigger={<IconButton title={`More for ${field.label}`} onClick={() => undefined}><Ico icon={Ellipsis} /></IconButton>} items={[
            { label: 'Show in Large Type', onClick: () => api.largeType(field.value) },
          ]} />
        )}
      </div>
    </div>
  );
}

const IGNORABLE: { check: WatchtowerCheck; label: string; applies: (i: Item) => boolean }[] = [
  { check: 'weak', label: 'weak password', applies: i => !!fieldByPurpose(i, 'password') },
  { check: 'reused', label: 'reused password', applies: i => !!fieldByPurpose(i, 'password') },
  { check: 'inactive2fa', label: 'two-factor authentication', applies: i => i.category === 'login' && i.urls.length > 0 && !fieldByPurpose(i, 'totp') },
  { check: 'unsecured', label: 'unsecured website', applies: i => i.urls.some(u => u.url.startsWith('http:')) },
  { check: 'duplicate', label: 'duplicate item', applies: i => i.category === 'login' },
  { check: 'expiring', label: 'expiry date', applies: i => ['creditCard', 'passport', 'driverLicense', 'membership', 'outdoorLicense', 'identity'].includes(i.category) },
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
            <div className="muted small">{v.content.fields.filter(f => f.value).map(f => f.label).join(', ')}{(fieldByPurpose(v.content, 'password')?.value ?? '') !== (fieldByPurpose(i === 0 ? item : item.history[i - 1].content, 'password')?.value ?? '') ? ' · different password' : ''}</div>
          </div>
          <Button small onClick={async () => { await run(api.restoreVersion(item.id, i), 'Version restored'); onClose(); }}>Restore</Button>
        </div>
      ))}
    </Modal>
  );
}

/** Earlier passwords of the item, from its saved versions: concealed until revealed, each copyable. */
function PasswordHistoryModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { run, settings } = useApp();
  const [shown, setShown] = useState<Set<number>>(new Set());
  const list = previousPasswords(item);
  const toggle = (i: number) => setShown(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <Modal title="Previous passwords" onClose={onClose} wide>
      {list.length === 0
        ? <p className="muted">No earlier passwords. When you change this item’s password, the old one is kept here.</p>
        : <p className="muted small">Kept from the item’s last {settings?.historyLimit ?? 30} saved versions. Restore a whole version from Item history.</p>}
      {list.map((p, i) => (
        <div key={i} className="history-row">
          <div className="grow">
            <div className="mono">{shown.has(i) && !settings?.privacyMode ? <ColoredPassword value={p.value} /> : <span className="dots">••••••••••</span>}</div>
            <div className="muted small">Replaced {timeAgo(p.replacedAt)} · {new Date(p.replacedAt).toLocaleDateString()}</div>
          </div>
          <div className="field-actions">
            <IconButton title={shown.has(i) ? 'Conceal' : 'Reveal'} onClick={() => toggle(i)}><Ico icon={shown.has(i) ? EyeOff : Eye} /></IconButton>
            <IconButton title="Copy this old password" onClick={() => run(api.copy(p.value, true), copiedMessage('old password', true, settings))}><Ico icon={Copy} /></IconButton>
          </div>
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
          <VaultIcon icon={v.icon} /> {v.name} {v.id === item.vaultId && <span className="muted">(current)</span>}
        </button>
      ))}
    </Modal>
  );
}

export function ItemDetail({ id }: { id: string }) {
  const { data, navigate, run, settings } = useApp();
  const [modal, setModal] = useState<'history' | 'passwords' | 'move' | null>(null);
  const item = data?.items.find(i => i.id === id);
  if (!item) return <div className="detail-pane"><Empty icon={FileQuestion} title="Item not found" /></div>;
  const vault = data!.vaults.find(v => v.id === item.vaultId);
  const t = TEMPLATE_BY_CATEGORY[item.category];
  const deleted = item.state === 'deleted';
  const password = fieldByPurpose(item, 'password')?.value;
  const oldPasswords = previousPasswords(item).length;
  const ignorable = IGNORABLE.filter(x => x.applies(item) || item.watchtowerIgnore.includes(x.check));

  return (
    <section className="detail-pane">
      <div className="detail-toolbar">
        {item.state === 'active' && password && (
          <Button small kind="primary" title="Copy password (Ctrl+Shift+C)"
            onClick={() => run(api.copy(password, true).then(() => api.markUsed(item.id)), copiedMessage('password', true, settings))}><Ico icon={Copy} size={15} />Copy password</Button>
        )}
        {item.state === 'active' && <Button small kind={password ? 'default' : 'primary'} title="Edit (Ctrl+E)" onClick={() => navigate(`/edit/${item.id}`)}><Ico icon={Pencil} size={15} />Edit</Button>}
        {item.state !== 'active' && <Button small kind="primary" onClick={() => run(api.restore(item.id), 'Item restored')}>Restore</Button>}
        {deleted && <Button small kind="danger" onClick={async () => {
          if (await askConfirm('Delete for good?', `“${item.title}” will be deleted permanently. This can’t be undone.`, 'Delete for good', true)) { await run(api.purge(item.id), 'Deleted permanently'); navigate('/'); }
        }}>Delete permanently</Button>}
        <span className="spacer" />
        {item.state === 'active' && <IconButton title={item.favorite ? 'Remove from favorites' : 'Add to favorites'} active={item.favorite} onClick={() => run(api.setFavorite(item.id, !item.favorite))}><Ico icon={Star} /></IconButton>}
        <Menu trigger={<IconButton title="More actions" onClick={() => undefined}><Ico icon={Ellipsis} /></IconButton>} items={[
          { label: 'Duplicate', onClick: async () => { const d = await run(api.duplicateItem(item.id), 'Item duplicated'); if (d) navigate(`/edit/${d.id}`); } },
          { label: 'Move to vault…', onClick: () => setModal('move') },
          { label: 'Item history…', onClick: () => setModal('history') },
          ...(oldPasswords ? [{ label: 'Previous passwords…', onClick: () => setModal('passwords') }] : []),
          ...(item.category === 'sshKey' ? [
            { label: 'Save public key (.pub)…', onClick: () => run(api.sshExport(item.id, 'public')) },
            { label: 'Export private key…', onClick: async () => {
              if (await askConfirm('Export the private key?', 'The exported file isn’t encrypted. Anyone who gets a copy can sign in with this key.', 'Export key')) void run(api.sshExport(item.id, 'private'));
            } },
          ] : []),
          { label: 'Copy item link', onClick: () => run(api.copy(`boltwork://item/${item.id}`, false), 'Link copied (opens this item in Boltwork)') },
          { separator: true },
          ...ignorable.map(x => {
            const ignored = item.watchtowerIgnore.includes(x.check);
            return {
              label: ignored ? `Watchtower: check ${x.label} again` : `Watchtower: ignore ${x.label}`,
              onClick: () => run(api.setWatchtowerIgnore(item.id, ignored ? item.watchtowerIgnore.filter(c => c !== x.check) : [...item.watchtowerIgnore, x.check])),
            };
          }),
          ...(ignorable.length ? [{ separator: true as const }] : []),
          ...(item.state === 'active' ? [{ label: 'Archive', onClick: () => run(api.archive(item.id), 'Moved to Archive') }] : []),
          ...(!deleted ? [{ label: 'Delete', danger: true, onClick: () => run(api.trash(item.id), 'Moved to Recently Deleted') }] : []),
        ]} />
      </div>
      <div className="detail-scroll">
        <div className="detail-head">
          <ItemIcon item={item} size={56} />
          <div>
            <h1>{item.title}</h1>
            <div className="muted with-icon">{t.name} · <VaultIcon icon={vault?.icon} size={14} />{vault?.name}{item.state === 'archived' ? ' · Archived' : ''}{deleted ? ' · Deleted' : ''}</div>
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
                <IconButton title="Copy website" onClick={() => run(api.copy(u.url, false), 'Copied website')}><Ico icon={Copy} /></IconButton>
                <IconButton title="Open and copy password" onClick={() => {
                  const pw = item.fields.find(f => f.purpose === 'password')?.value;
                  void run(api.openUrl(u.url).then(() => (pw ? api.copy(pw, true) : undefined)).then(() => api.markUsed(item.id)), pw ? 'Opened; password copied' : undefined);
                }}><Ico icon={ExternalLink} /></IconButton>
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

        {(item.passkeys?.length ?? 0) > 0 && (
          <div className="card">
            <div className="card-title">Passkey{item.passkeys!.length > 1 ? 's' : ''}</div>
            {item.passkeys!.map(p => (
              <div key={p.credentialId} className="field-row">
                <div className="field-main static">
                  <div className="field-value with-icon"><Ico icon={Fingerprint} size={14} />{p.userName || p.userDisplayName || 'Passkey'}</div>
                  <div className="field-label as-typed">
                    {p.rpId} · created {new Date(p.createdAt).toLocaleDateString()}{p.lastUsedAt ? ` · last used ${timeAgo(p.lastUsedAt)}` : ' · not used yet'}
                  </div>
                </div>
                {item.state === 'active' && (
                  <div className="field-actions">
                    <IconButton title="Remove passkey" onClick={async () => {
                      if (await askConfirm('Remove this passkey?', `You won’t be able to sign in to ${p.rpId} with it any more. Make sure you can still sign in another way, or remove the passkey from your account on the site too.`, 'Remove passkey', true)) {
                        void run(api.removePasskey(item.id, p.credentialId), 'Passkey removed');
                      }
                    }}><Ico icon={Trash2} /></IconButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {item.attachments.length > 0 && (
          <div className="card">
            <div className="card-title">Attachments</div>
            {item.attachments.map(a => (
              <div key={a.id} className="field-row">
                <div className="field-main" onClick={() => run(api.saveAttachment(item.id, a.id))}>
                  <div className="field-value with-icon"><Ico icon={Paperclip} size={14} />{a.name}</div>
                  <div className="field-label">{(a.size / 1024).toFixed(1)} KB · added {timeAgo(a.addedAt)}</div>
                </div>
                <div className="field-actions"><IconButton title="Save a copy" onClick={() => run(api.saveAttachment(item.id, a.id))}><Ico icon={Download} /></IconButton></div>
              </div>
            ))}
          </div>
        )}

        {item.tags.length > 0 && <div className="tags">{item.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}</div>}

        <div className="meta">
          <div>Modified {timeAgo(item.updatedAt)} · Created {new Date(item.createdAt).toLocaleDateString()}</div>
          {item.lastUsedAt && <div>Last used {timeAgo(item.lastUsedAt)} · used {item.useCount} times</div>}
          {item.passwordChangedAt && <div>Password changed {timeAgo(item.passwordChangedAt)}{oldPasswords > 0 && <> · <button className="link" onClick={() => setModal('passwords')}>{oldPasswords} previous password{oldPasswords > 1 ? 's' : ''}</button></>}</div>}
          {item.history.length > 0 && <button className="link" onClick={() => setModal('history')}>View {item.history.length} previous version{item.history.length > 1 ? 's' : ''}</button>}
        </div>
      </div>
      {modal === 'history' && <HistoryModal item={item} onClose={() => setModal(null)} />}
      {modal === 'passwords' && <PasswordHistoryModal item={item} onClose={() => setModal(null)} />}
      {modal === 'move' && <MoveModal item={item} onClose={() => setModal(null)} />}
    </section>
  );
}
