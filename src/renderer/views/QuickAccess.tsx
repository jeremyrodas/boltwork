import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuickAccessAction } from '../../core/api';
import { searchItems } from '../../core/search';
import { fieldByPurpose, subtitleOf } from '../../core/templates';
import type { Item } from '../../core/types';
import { api, on } from '../api';
import { BrandMark } from '../components/BrandMark';
import { ItemIcon } from '../components/ui';
import { useApp } from '../state';
import { Unlock } from './Welcome';

export function QuickAccess() {
  const { app, data, settings, toast } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => on('quickAccessShown', () => { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 30); }), []);

  const results = useMemo<Item[]>(() => {
    if (!data) return [];
    if (!q.trim()) {
      return data.items.filter(i => i.state === 'active')
        .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title)).slice(0, 30);
    }
    return searchItems(data.items, data.vaults, q).slice(0, 30);
  }, [data, q]);

  useEffect(() => { setSel(0); }, [q]);
  if (!app) return null;
  if (app.locked) return <div className="qa"><Unlock compact /></div>;

  const act = async (item: Item | undefined, action: QuickAccessAction) => {
    if (!item) return;
    try {
      await api.quickAccessAction(item.id, action);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const canAutoType = app.platform === 'win32' && settings?.autoTypeEnabled;
  const current = results[sel];

  return (
    <div className="qa" onKeyDown={e => {
      if (e.key === 'Escape') { void api.hideQuickAccess(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(results.length - 1, s + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Enter') { e.preventDefault(); void act(current, canAutoType ? 'autoType' : 'password'); }
      if (mod && e.key.toLowerCase() === 'c' && !e.shiftKey && !e.altKey && !window.getSelection()?.toString()) { e.preventDefault(); void act(current, 'password'); }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); void act(current, 'username'); }
      if (mod && e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); void act(current, 'otp'); }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void act(current, 'open'); }
    }}>
      <div className="qa-search">
        <BrandMark size={24} />
        <input ref={input} autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search Boltwork" spellCheck={false} />
      </div>
      <div className="qa-results">
        {results.length === 0 && <div className="muted qa-empty">No matching items</div>}
        {results.map((item, i) => (
          <div key={item.id} className={`qa-row${i === sel ? ' selected' : ''}`} onMouseEnter={() => setSel(i)} onDoubleClick={() => act(item, canAutoType ? 'autoType' : 'password')}>
            <ItemIcon item={item} size={28} />
            <span className="row-text"><span className="row-title">{item.title}</span><span className="row-sub">{settings?.privacyMode ? '••••••' : subtitleOf(item)}</span></span>
            {i === sel && (
              <span className="qa-actions">
                {canAutoType && fieldByPurpose(item, 'password') && <button onClick={() => act(item, 'autoType')}>Auto-Type ⏎</button>}
                {fieldByPurpose(item, 'username') && <button onClick={() => act(item, 'username')}>Username</button>}
                {fieldByPurpose(item, 'password') && <button onClick={() => act(item, 'password')}>Password</button>}
                {fieldByPurpose(item, 'totp') && <button onClick={() => act(item, 'otp')}>Code</button>}
                {item.urls[0] && <button onClick={() => act(item, 'open')}>Open</button>}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="qa-foot muted">
        <span>⏎ {canAutoType ? 'Auto-Type' : 'Copy password'}</span><span>Ctrl+C password</span><span>Ctrl+Shift+C username</span><span>Ctrl+Alt+C code</span><span>Ctrl+O open</span><span>Esc close</span>
      </div>
    </div>
  );
}

export function LargeType() {
  const [text, setText] = useState('');
  useEffect(() => { void api.getLargeTypeText().then(setText); }, []);
  return (
    <div className="large-type" onClick={() => window.close()}>
      <div className="lt-chars">
        {[...text].map((c, i) => (
          <span key={i} className="lt-char">
            <span className={/\d/.test(c) ? 'pw-digit' : /[A-Za-z]/.test(c) ? '' : 'pw-symbol'}>{c === ' ' ? '␣' : c}</span>
            <small>{i + 1}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
