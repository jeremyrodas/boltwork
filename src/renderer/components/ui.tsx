import { useEffect, useRef, useState, type ReactNode } from 'react';
import { domainOf } from '../../core/search';
import { TEMPLATE_BY_CATEGORY } from '../../core/templates';
import type { Item, Strength } from '../../core/types';
import { api } from '../api';
import { useApp } from '../state';

export function Button({ children, kind = 'default', small, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'default' | 'primary' | 'danger' | 'ghost'; small?: boolean }) {
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

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><IconButton title="Close" onClick={onClose}>✕</IconButton></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export interface MenuEntry { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; separator?: false }
export function Menu({ trigger, items }: { trigger: ReactNode; items: (MenuEntry | { separator: true })[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <span onClick={() => setOpen(o => !o)}>{trigger}</span>
      {open && (
        <div className="menu">
          {items.map((it, i) => ('separator' in it && it.separator ? <div key={i} className="menu-sep" /> : (
            <button key={i} disabled={(it as MenuEntry).disabled} className={`menu-item${(it as MenuEntry).danger ? ' danger' : ''}`}
              onClick={() => { setOpen(false); (it as MenuEntry).onClick(); }}>{(it as MenuEntry).label}</button>
          )))}
        </div>
      )}
    </div>
  );
}

const STRENGTH_COLORS = ['#6b7280', '#dc2626', '#ea580c', '#d97706', '#65a30d', '#16a34a', '#0d9488', '#2563eb'];
export function StrengthMeter({ strength }: { strength: Strength | null }) {
  if (!strength) return null;
  return (
    <div className="strength">
      <div className="strength-bar">
        {Array.from({ length: 7 }, (_, i) => <span key={i} style={{ background: i < strength.level ? STRENGTH_COLORS[strength.level] : undefined }} />)}
      </div>
      <span className="strength-label" style={{ color: STRENGTH_COLORS[strength.level] }}>{strength.label}</span>
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
  const style = { width: size, height: size, fontSize: size * 0.55 };
  if (item.icon) return <img className="item-icon" style={style} src={item.icon} alt="" />;
  if (settings?.downloadIcons && host && !failed) {
    return <img className="item-icon" style={style} src={`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`} alt="" onError={() => setFailed(true)} />;
  }
  return <span className="item-icon emoji" style={style}>{TEMPLATE_BY_CATEGORY[item.category].icon}</span>;
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3>{children}</div>;
}

export function Toasts() {
  const { toasts } = useApp();
  return <div className="toasts">{toasts.map(t => <div key={t.id} className={`toast ${t.kind ?? ''}`}>{t.text}</div>)}</div>;
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}

export function PasswordInput({ value, onChange, placeholder, autoFocus, onEnter }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; onEnter?: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-input">
      <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false}
        onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }} />
      <IconButton title={show ? 'Hide' : 'Show'} onClick={() => setShow(s => !s)}>{show ? '🙈' : '👁'}</IconButton>
    </div>
  );
}
