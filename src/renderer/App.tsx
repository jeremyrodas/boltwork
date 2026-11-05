import { useEffect, useRef, useState } from 'react';
import { fieldByPurpose } from '../core/templates';
import type { Category } from '../core/types';
import { api } from './api';
import { Toasts } from './components/ui';
import { useApp } from './state';
import { GeneratorView } from './views/Generator';
import { HomeView } from './views/Home';
import { ItemDetail } from './views/ItemDetail';
import { ItemEditor } from './views/ItemEditor';
import { CategoryPicker, ItemList } from './views/ItemList';
import { LargeType, QuickAccess } from './views/QuickAccess';
import { SettingsView } from './views/Settings';
import { Sidebar } from './views/Sidebar';
import { WatchtowerView } from './views/Watchtower';
import { Setup, Unlock } from './views/Welcome';

function useTheme() {
  const { settings } = useApp();
  useEffect(() => {
    if (!settings) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.density = settings.density;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings]);
  useEffect(() => {
    if (!settings?.blurWhenUnfocused) { document.body.classList.remove('blurred'); return; }
    const blur = () => document.body.classList.add('blurred');
    const focus = () => document.body.classList.remove('blurred');
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.body.classList.remove('blurred'); };
  }, [settings?.blurWhenUnfocused]);
}

function MainWindow() {
  const { app, data, route, navigate, run } = useApp();
  const [picker, setPicker] = useState(false);
  const setupStarted = useRef(false);
  const [setupDone, setSetupDone] = useState(false);

  if (app && !app.hasVault) setupStarted.current = true;

  // Global shortcuts inside the window for the selected item.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const m = route.match(/^\/item\/(\w+)/);
      const item = m ? data?.items.find(i => i.id === m[1]) : undefined;
      if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); navigate('/generator'); }
      if (!item) return;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const pw = fieldByPurpose(item, 'password')?.value;
        if (pw) void run(api.copy(pw, true).then(() => api.markUsed(item.id)), 'Copied password');
      }
      if (mod && e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const u = fieldByPurpose(item, 'username')?.value;
        if (u) void run(api.copy(u, false), 'Copied username');
      }
      if (mod && e.key.toLowerCase() === 'e' && item.state === 'active') { e.preventDefault(); navigate(`/edit/${item.id}`); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, data, navigate, run]);

  useEffect(() => { if (route === '/new') { setPicker(true); navigate('/'); } }, [route, navigate]);

  if (!app) return null;
  if (setupStarted.current && !setupDone) return <Setup onDone={() => setSetupDone(true)} />;
  if (app.locked) return <Unlock />;
  if (!data) return null;

  let main: React.ReactNode;
  const m = route.match(/^\/(item|edit|new|settings)\/?([^/]*)/);
  if (route.startsWith('/home')) main = <HomeView />;
  else if (route.startsWith('/watchtower')) main = <WatchtowerView />;
  else if (route.startsWith('/generator')) main = <GeneratorView />;
  else if (m?.[1] === 'settings' || route === '/settings') main = <SettingsView pane={m?.[2] || 'general'} />;
  else {
    const kind = m?.[1];
    const arg = m?.[2];
    main = (<>
      <ItemList selectedId={kind === 'item' || kind === 'edit' ? arg : undefined} />
      {kind === 'item' && arg && <ItemDetail id={arg} />}
      {kind === 'edit' && arg && <ItemEditor id={arg} />}
      {kind === 'new' && arg && <ItemEditor key={`new-${arg}`} category={arg as Category} />}
      {!kind && <section className="detail-pane placeholder"><div className="empty"><div className="empty-icon">🔐</div><p className="muted">Select an item, or press Ctrl+N to add one.</p></div></section>}
    </>);
  }
  return (
    <div className="shell">
      <Sidebar />
      <main className="content">{main}</main>
      {picker && <CategoryPicker onClose={() => setPicker(false)} onPick={c => { setPicker(false); navigate(`/new/${c}`); }} />}
    </div>
  );
}

export function App() {
  const { app } = useApp();
  useTheme();
  const kind = window.location.hash.slice(1) || app?.window || 'main';
  return (
    <>
      {kind === 'quickAccess' ? <QuickAccess /> : kind === 'largeType' ? <LargeType /> : <MainWindow />}
      <Toasts />
    </>
  );
}
