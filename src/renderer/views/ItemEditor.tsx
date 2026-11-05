import { useEffect, useMemo, useState } from 'react';
import jsQR from 'jsqr';
import { blankContent, TEMPLATE_BY_CATEGORY } from '../../core/templates';
import type { Category, Field, FieldType, ItemContent, Section } from '../../core/types';
import { api } from '../api';
import { Dices, Eye, EyeOff, Paperclip, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { CategoryIcon, Ico } from '../components/icons';
import { askConfirm, Button, IconButton, ItemIcon, Menu, Modal, StrengthMeter, Toggle, useStrength } from '../components/ui';
import { useApp } from '../state';
import { GeneratorPanel } from './Generator';
import { useTotp } from './ItemDetail';
import { SshKeyEditor } from './SshKey';

type Draft = ItemContent & { id?: string; vaultId: string };

const uid = () => Math.random().toString(36).slice(2, 10);

async function decodeQrFromFile(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

async function iconFromFile(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const s = Math.min(bmp.width, bmp.height);
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 96, 96);
  return canvas.toDataURL('image/png');
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

function TotpEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { run, toast } = useApp();
  const preview = useTotp(value || undefined);
  const [show, setShow] = useState(!value);
  return (
    <div className="totp-edit">
      <div className="pw-input">
        <input className="mono" type={show ? 'text' : 'password'} value={value} placeholder="Paste a setup key or otpauth:// link" aria-label="Setup key"
          onChange={e => onChange(e.target.value.trim())} spellCheck={false} />
        <IconButton title={show ? 'Hide setup key' : 'Show setup key'} onClick={() => setShow(x => !x)}><Ico icon={show ? EyeOff : Eye} /></IconButton>
      </div>
      <div className="row gap wrap">
        <Button small onClick={async () => {
          const r = await run(api.scanQrFromScreen());
          if (r) { onChange(r); toast('QR code found'); } else if (r === null) toast('No QR code found on screen. Make sure it is visible.', 'error');
        }}>Scan QR code on screen</Button>
        <Button small onClick={async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          const r = await decodeQrFromFile(f);
          if (r) { onChange(r); toast('QR code found'); } else toast('No QR code found in that image.', 'error');
        }}>From image file…</Button>
        {preview && ('error' in preview ? <span className="error-text">{preview.error}</span> : <span className="muted">Current code: <b className="mono">{preview.code}</b></span>)}
      </div>
    </div>
  );
}

function ConcealedEditor({ field, onChange, isPassword }: { field: Field; onChange: (v: string) => void; isPassword: boolean }) {
  const [show, setShow] = useState(false);
  const [gen, setGen] = useState(false);
  const strength = useStrength(isPassword ? field.value : '');
  return (
    <div>
      <div className="pw-input">
        <input type={show ? 'text' : 'password'} className="mono" value={field.value} onChange={e => onChange(e.target.value)} spellCheck={false} />
        <IconButton title={show ? 'Hide' : 'Show'} onClick={() => setShow(s => !s)}><Ico icon={show ? EyeOff : Eye} /></IconButton>
        {isPassword && <IconButton title="Generate password" onClick={() => setGen(true)}><Ico icon={Dices} /></IconButton>}
      </div>
      {isPassword && field.value && <StrengthMeter strength={strength} />}
      {gen && <Modal title="Generate password" onClose={() => setGen(false)}><GeneratorPanel onUse={pw => { onChange(pw); setShow(true); setGen(false); }} /></Modal>}
    </div>
  );
}

function FieldEditor({ field, onChange, onRemove, onLabel }: { field: Field; onChange: (v: string) => void; onRemove?: () => void; onLabel?: (l: string) => void }) {
  const { settings } = useApp();
  let input: React.ReactNode;
  switch (field.type) {
    case 'concealed': input = <ConcealedEditor field={field} onChange={onChange} isPassword={field.purpose === 'password'} />; break;
    case 'totp': input = <TotpEditor value={field.value} onChange={onChange} />; break;
    case 'multiline': input = <textarea rows={3} value={field.value} onChange={e => onChange(e.target.value)} />; break;
    case 'date': input = <input type="date" value={field.value} onChange={e => onChange(e.target.value)} />; break;
    case 'monthYear': input = <input type="month" value={field.value} onChange={e => onChange(e.target.value)} />; break;
    case 'menu': input = (
      <select value={field.value} onChange={e => onChange(e.target.value)}>
        <option value="" />
        {[...new Set([...(field.options ?? []), ...(field.value ? [field.value] : [])])].map(o => <option key={o}>{o}</option>)}
      </select>
    ); break;
    default: input = (
      <div className="row gap">
        <input type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text'} value={field.value}
          onChange={e => onChange(e.target.value)} spellCheck={false} />
        {field.purpose === 'username' && settings?.suggestUsername && (
          <Menu trigger={<IconButton title="Suggest a username" onClick={() => undefined}><Ico icon={Sparkles} /></IconButton>} items={[
            ...(settings.defaultUsername ? [{ label: `Use ${settings.defaultUsername}`, onClick: () => onChange(settings.defaultUsername) }] : []),
            { label: 'Generate a username', onClick: () => void api.suggestUsername().then(onChange) },
          ]} />
        )}
      </div>
    );
  }
  return (
    <div className="edit-field">
      {onLabel ? <input className="label-input" value={field.label} onChange={e => onLabel(e.target.value)} placeholder="label" /> : <label className="lbl">{field.label}</label>}
      <div className="edit-field-row">
        <div className="grow">{input}</div>
        {onRemove && <IconButton title="Remove field" onClick={onRemove}><Ico icon={X} /></IconButton>}
      </div>
    </div>
  );
}

const ADDABLE: { type: FieldType; label: string }[] = [
  { type: 'text', label: 'Text' }, { type: 'concealed', label: 'Password' }, { type: 'totp', label: 'One-time password' },
  { type: 'email', label: 'Email' }, { type: 'url', label: 'URL' }, { type: 'phone', label: 'Phone' },
  { type: 'date', label: 'Date' }, { type: 'monthYear', label: 'Month / year' }, { type: 'multiline', label: 'Multi-line text' },
];

export function ItemEditor({ id, category }: { id?: string; category?: Category }) {
  const { data, navigate, run, filter, toast } = useApp();
  const existing = id ? data?.items.find(i => i.id === id) : undefined;
  const defaultVault = filter.kind === 'vault' ? filter.vaultId : data?.vaults[0]?.id ?? '';
  const initial = useMemo<Draft | null>(() => {
    if (existing) return structuredClone({ ...existing });
    if (!category) return null;
    const d: Draft = { ...blankContent(category), vaultId: defaultVault };
    const pre = sessionStorage.getItem('prefillPassword');
    if (pre) { sessionStorage.removeItem('prefillPassword'); const f = d.fields.find(x => x.purpose === 'password'); if (f) f.value = pre; }
    if (filter.kind === 'tag') d.tags = [filter.tag];
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, category]);
  const [draft, setDraft] = useState<Draft | null>(initial);
  const [tagInput, setTagInput] = useState('');
  useEffect(() => setDraft(initial), [initial]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
      if (e.key === 'Escape' && !document.querySelector('.modal') && !document.querySelector('.menu')) {
        const el = e.target as HTMLElement | null;
        if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) { el.blur(); return; }
        void requestCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!draft || !data) return null;
  const t = TEMPLATE_BY_CATEGORY[draft.category];
  const set = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const setField = (fid: string, value: string) => set({ fields: draft.fields.map(f => (f.id === fid ? { ...f, value } : f)) });
  const setSection = (sid: string, fn: (s: Section) => Section) => set({ sections: draft.sections.map(s => (s.id === sid ? fn(s) : s)) });
  const allTags = [...new Set(data.items.flatMap(i => i.tags))].filter(x => !draft.tags.includes(x) && x.toLowerCase().includes(tagInput.toLowerCase()));

  const addField = (type: FieldType, label: string) => {
    let sections = draft.sections;
    if (!sections.length) sections = [{ id: uid(), title: '', fields: [] }];
    const last = sections[sections.length - 1];
    set({ sections: sections.map(s => (s === last ? { ...s, fields: [...s.fields, { id: uid(), label: label.toLowerCase(), type, value: '' }] } : s)) });
  };
  const addTag = (tag: string) => { const v = tag.trim().replace(/^#/, ''); if (v && !draft.tags.includes(v)) set({ tags: [...draft.tags, v] }); setTagInput(''); };

  async function save() {
    if (!draft) return;
    const pending = tagInput.trim() ? [...draft.tags, tagInput.trim()] : draft.tags;
    const saved = await run(api.saveItem({ ...draft, tags: pending, urls: draft.urls.filter(u => u.url.trim()) }), draft.id ? 'Saved' : 'Item created');
    if (saved) navigate(`/item/${saved.id}`);
  }
  function cancel() { navigate(draft?.id ? `/item/${draft.id}` : '/'); }
  async function requestCancel() {
    const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
    if (!dirty || await askConfirm('Discard changes?', 'Your changes to this item haven’t been saved.', 'Discard changes', true)) cancel();
  }

  return (
    <section className="detail-pane editor">
      <div className="detail-toolbar">
        <Button small onClick={() => void requestCancel()} title="Cancel (Esc)">Cancel</Button>
        <span className="spacer" />
        <Button small kind="primary" onClick={save}>Save</Button>
      </div>
      <div className="detail-scroll">
        <div className="detail-head">
          <button className="icon-pick" title="Change icon" onClick={async () => { const f = await pickFile('image/*'); if (f) set({ icon: await iconFromFile(f) }); }}>
            <ItemIcon item={draft} size={56} />
          </button>
          <div className="grow">
            <input className="title-input" autoFocus={!draft.id} placeholder={`${t.name} title`} value={draft.title} onChange={e => set({ title: e.target.value })} />
            <div className="row gap">
              <span className="muted with-icon"><CategoryIcon category={draft.category} size={14} />{t.name} in</span>
              <select value={draft.vaultId} onChange={e => set({ vaultId: e.target.value })}>
                {data.vaults.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {draft.icon && <button className="link" onClick={() => set({ icon: undefined })}>Remove icon</button>}
            </div>
          </div>
        </div>

        <div className="card padded">
          {draft.category === 'sshKey'
            ? <SshKeyEditor fields={draft.fields} title={draft.title} onKey={info => set({ fields: draft.fields.map(f => (f.id in info ? { ...f, value: info[f.id as keyof typeof info] } : f)), title: draft.title || 'SSH Key' })} />
            : draft.fields.map(f => <FieldEditor key={f.id} field={f} onChange={v => setField(f.id, v)} />)}
          {t.hasUrls && (
            <div className="edit-field">
              <label className="lbl">websites</label>
              {draft.urls.map((u, i) => (
                <div className="edit-field-row" key={i}>
                  <input className="grow" value={u.url} placeholder="https://example.com" onChange={e => set({ urls: draft.urls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                  <IconButton title="Remove website" onClick={() => set({ urls: draft.urls.filter((_, j) => j !== i) })}><Ico icon={X} /></IconButton>
                </div>
              ))}
              <button className="link" onClick={() => set({ urls: [...draft.urls, { label: 'website', url: '', primary: !draft.urls.length }] })}><Ico icon={Plus} size={14} />Add website</button>
            </div>
          )}
          {draft.category === 'login' && (
            <Toggle label="Submit the form after Auto-Type" hint="Presses Enter after typing your username and password." checked={draft.autosubmit !== false} onChange={v => set({ autosubmit: v })} />
          )}
        </div>

        {draft.sections.map(s => (
          <div key={s.id} className="card padded">
            <div className="row gap">
              <input className="section-title-input grow" placeholder="Section name (optional)" value={s.title} onChange={e => setSection(s.id, x => ({ ...x, title: e.target.value }))} />
              <IconButton title="Remove section" onClick={() => set({ sections: draft.sections.filter(x => x.id !== s.id) })}><Ico icon={Trash2} /></IconButton>
            </div>
            {s.fields.map(f => (
              <FieldEditor key={f.id} field={f}
                onChange={v => setSection(s.id, x => ({ ...x, fields: x.fields.map(y => (y.id === f.id ? { ...y, value: v } : y)) }))}
                onLabel={l => setSection(s.id, x => ({ ...x, fields: x.fields.map(y => (y.id === f.id ? { ...y, label: l } : y)) }))}
                onRemove={() => setSection(s.id, x => ({ ...x, fields: x.fields.filter(y => y.id !== f.id) }))} />
            ))}
          </div>
        ))}

        <div className="row gap">
          <Menu trigger={<Button small><Ico icon={Plus} size={14} />Add field</Button>} items={ADDABLE.map(a => ({ label: a.label, onClick: () => addField(a.type, a.label) }))} />
          <Button small onClick={() => set({ sections: [...draft.sections, { id: uid(), title: 'New section', fields: [] }] })}><Ico icon={Plus} size={14} />Add section</Button>
          {draft.id
            ? <Button small onClick={async () => { const n = await run(api.addAttachments(draft.id!)); if (n) toast(`Attached ${n} file${n > 1 ? 's' : ''}`); }}><Ico icon={Paperclip} size={14} />Attach files</Button>
            : <span className="hint">Save the item to attach files.</span>}
        </div>

        {existing && existing.attachments.length > 0 && (
          <div className="card padded">
            <div className="card-title">Attachments</div>
            {existing.attachments.map(a => (
              <div key={a.id} className="edit-field-row">
                <span className="grow with-icon"><Ico icon={Paperclip} size={14} />{a.name}</span>
                <IconButton title={`Remove ${a.name}`} onClick={async () => {
                  if (await askConfirm('Remove attachment?', `“${a.name}” will be removed from this item.`, 'Remove', true)) void run(api.removeAttachment(existing.id, a.id));
                }}><Ico icon={X} /></IconButton>
              </div>
            ))}
          </div>
        )}

        <div className="card padded">
          <label className="lbl">notes</label>
          <textarea rows={5} value={draft.notes} onChange={e => set({ notes: e.target.value })} placeholder="Add notes (Markdown-style text is kept as written)" />
          <label className="lbl">tags</label>
          <div className="tag-editor">
            {draft.tags.map(tag => <span key={tag} className="tag">{tag} <button aria-label={`Remove tag ${tag}`} onClick={() => set({ tags: draft.tags.filter(x => x !== tag) })}><Ico icon={X} size={12} /></button></span>)}
            <input value={tagInput} placeholder="Add tag (use / to nest, e.g. work/clients)" onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); } if (e.key === 'Backspace' && !tagInput) set({ tags: draft.tags.slice(0, -1) }); }} />
          </div>
          {tagInput && allTags.length > 0 && <div className="tag-suggest">{allTags.slice(0, 8).map(x => <button key={x} className="tag" onClick={() => addTag(x)}>{x}</button>)}</div>}
        </div>
      </div>
    </section>
  );
}
