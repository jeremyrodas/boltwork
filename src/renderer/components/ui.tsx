import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff, X, type LucideIcon } from 'lucide-react';
import { domainOf } from '../../core/search';
import { CategoryIcon, Ico } from './icons';
import type { Item, Strength } from '../../core/types';
import { api } from '../api';
import { useApp } from '../state';

export function Button({ children, kind = 'default', small, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'default' | 'primary' | 'danger' | 'solid-danger' | 'ghost'; small?: boolean }) {
  return <button {...rest} className={`btn btn-${kind}${small ? ' btn-sm' : ''} ${rest.className ?? ''}`}>{children}</button>;
}

export function IconButton({ title, children, onClick, active }: { title: string; children: ReactNode; onClick: (e: React.MouseEvent) => void; active?: boolean }) {
  return <button className={`icon-btn${active ? ' active' : ''}`} title={title} aria-label={title} onClick={onClick}>{children}</button>;
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span><span className="toggle-label">{label}</span>{hint && <span className="hint">{hint}</span>}</span>
      <input type="checkbox" className="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // Focus the first field (or first control) inside, unless something inside already took focus.
    if (!ref.current?.contains(document.activeElement)) {
      const first = ref.current?.querySelector<HTMLElement>('.modal-body input, .modal-body textarea, .modal-body select') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }
    return () => { opener?.focus?.(); };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      // Keep Tab inside the dialog.
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><IconButton title="Close" onClick={onClose}><Ico icon={X} /></IconButton></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export interface MenuEntry { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; separator?: false }
export function Menu({ trigger, items }: { trigger: ReactNode; items: (MenuEntry | { separator: true })[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    ref.current?.querySelector<HTMLElement>('.menu-trigger button')?.focus();
  };
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('.menu-item:not(:disabled)')?.focus();
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', out);
    return () => window.removeEventListener('mousedown', out);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const els = [...(menuRef.current?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length;
    els[next]?.focus();
  };
  return (
    <div className="menu-wrap" ref={ref} onKeyDown={onKey}>
      <span className="menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>{trigger}</span>
      {open && (
        <div className="menu" role="menu" ref={menuRef}>
          {items.map((it, i) => ('separator' in it && it.separator ? <div key={i} className="menu-sep" role="separator" /> : (
            <button key={i} role="menuitem" disabled={(it as MenuEntry).disabled} className={`menu-item${(it as MenuEntry).danger ? ' danger' : ''}`}
              onClick={() => { close(); (it as MenuEntry).onClick(); }}>{(it as MenuEntry).label}</button>
          )))}
        </div>
      )}
    </div>
  );
}

/** Strength colours are theme tokens (--strength-0 to --strength-7) so the label stays readable in light and dark. */
export function StrengthMeter({ strength }: { strength: Strength | null }) {
  if (!strength) return null;
  const color = `var(--strength-${strength.level})`;
  return (
    <div className="strength" role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={7} aria-valuenow={strength.level} aria-valuetext={strength.label}>
      <div className="strength-bar">
        {Array.from({ length: 7 }, (_, i) => <span key={i} style={{ background: i < strength.level ? color : undefined }} />)}
      </div>
      <span className="strength-label" style={{ color }}>{strength.label}</span>
    </div>
  );
}

export function useStrength(password: string): Strength | null {
  const [s, setS] = useState<Strength | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { void api.rateStrength(password).then(r => { if (live) setS(r); }); }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [password]);
  return s;
}

/** Colored password: digits blue, symbols red, as in most password managers. */
export function ColoredPassword({ value }: { value: string }) {
  return (
    <span className="mono">
      {[...value].map((c, i) => <span key={i} className={/\d/.test(c) ? 'pw-digit' : /[A-Za-z]/.test(c) ? '' : 'pw-symbol'}>{c}</span>)}
    </span>
  );
}

export function ItemIcon({ item, size = 32 }: { item: Pick<Item, 'category' | 'icon' | 'urls'>; size?: number }) {
  const { settings } = useApp();
  const [failed, setFailed] = useState(false);
  const host = item.urls[0] ? domainOf(item.urls[0].url) : '';
  const style = { width: size, height: size };
  if (item.icon) return <img className="item-icon" style={style} src={item.icon} alt="" />;
  if (settings?.downloadIcons && host && !failed) {
    return <img className="item-icon" style={style} src={`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`} alt="" onError={() => setFailed(true)} />;
  }
  return <span className="item-icon" style={style}><CategoryIcon category={item.category} size={Math.round(size * 0.5)} /></span>;
}

export function Empty({ icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Ico icon={icon} size={28} /></div><h3>{title}</h3>{children}</div>;
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(t => <div key={t.id} className={`toast ${t.kind ?? ''}`}>{t.text}</div>)}
    </div>
  );
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}

export function PasswordInput({ value, onChange, placeholder, autoFocus, onEnter, id, invalid }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; onEnter?: () => void; id?: string; invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const capsCheck = (e: React.KeyboardEvent | React.MouseEvent) => setCaps(e.getModifierState('CapsLock'));
  return (
    <div className="pw-wrap">
      <div className="pw-input">
        <input id={id} type={show ? 'text' : 'password'} value={value} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false}
          aria-invalid={invalid || undefined}
          onChange={e => onChange(e.target.value)} onKeyUp={capsCheck} onMouseDown={capsCheck} onBlur={() => setCaps(false)}
          onKeyDown={e => { capsCheck(e); if (e.key === 'Enter') onEnter?.(); }} />
        <IconButton title={show ? 'Hide' : 'Show'} onClick={() => setShow(s => !s)}><Ico icon={show ? EyeOff : Eye} /></IconButton>
      </div>
      {caps && <span className="caps-hint">Caps Lock is on</span>}
    </div>
  );
}

// ---------- in-app confirmation (replaces window.confirm, which breaks the app's look at its riskiest moments) ----------

export interface Choice { label: string; value: string; kind?: 'primary' | 'danger' | 'default' }
interface ChoiceRequest { title: string; body: ReactNode; choices: Choice[]; resolve: (v: string | null) => void }
let pushChoice: ((r: ChoiceRequest) => void) | null = null;

/** Asks the user to pick one of several actions. Resolves to the chosen value, or null if dismissed. */
export function askChoice(title: string, body: ReactNode, choices: Choice[]): Promise<string | null> {
  return new Promise(resolve => {
    if (!pushChoice) { resolve(null); return; }
    pushChoice({ title, body, choices, resolve });
  });
}

/** Yes/no confirmation. `danger` styles the confirm button as destructive. */
export async function askConfirm(title: string, body: ReactNode, confirmLabel: string, danger = false): Promise<boolean> {
  return (await askChoice(title, body, [{ label: confirmLabel, value: 'yes', kind: danger ? 'danger' : 'primary' }])) === 'yes';
}

export function ConfirmHost() {
  const [req, setReq] = useState<ChoiceRequest | null>(null);
  useEffect(() => { pushChoice = setReq; return () => { pushChoice = null; }; }, []);
  if (!req) return null;
  const done = (v: string | null) => { req.resolve(v); setReq(null); };
  return (
    <Modal title={req.title} onClose={() => done(null)}>
      <div className="confirm-body">{req.body}</div>
      <div className="row gap end">
        <Button autoFocus onClick={() => done(null)}>Cancel</Button>
        {req.choices.map(c => (
          <Button key={c.value} kind={c.kind === 'danger' ? 'solid-danger' : c.kind ?? 'default'} onClick={() => done(c.value)}>{c.label}</Button>
        ))}
      </div>
    </Modal>
  );
}

/** "Copied password · clears in 90 s": the reassurance people want at the moment they copy a secret. */
export function copiedMessage(what: string, secret: boolean, settings: { clipboardClearSeconds: number } | null | undefined): string {
  const s = settings?.clipboardClearSeconds ?? 0;
  return secret && s > 0 ? `Copied ${what} · clears in ${s} s` : `Copied ${what}`;
}
