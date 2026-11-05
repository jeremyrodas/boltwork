import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppState } from '../core/api';
import type { Settings, VaultData } from '../core/types';
import { api, on } from './api';

/** Where the item list is pointed. */
export type ListFilter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'category'; category: string }
  | { kind: 'vault'; vaultId: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'archive' }
  | { kind: 'deleted' };

export interface Toast { id: number; text: string; kind?: 'error' | 'info' }

interface Ctx {
  app: AppState | null;
  data: VaultData | null;
  settings: Settings | null;
  route: string;
  navigate: (r: string) => void;
  filter: ListFilter;
  setFilter: (f: ListFilter) => void;
  query: string;
  setQuery: (q: string) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  toasts: Toast[];
  run: <T>(p: Promise<T>, ok?: string) => Promise<T | undefined>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  reveal: (key: string) => boolean;
  toggleReveal: (key: string) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [app, setApp] = useState<AppState | null>(null);
  const [data, setData] = useState<VaultData | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [route, setRoute] = useState('/');
  const [filter, setFilterState] = useState<ListFilter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const toast = useCallback((text: string, kind?: Toast['kind']) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 6000 : 2600);
  }, []);

  const run = useCallback(async <T,>(p: Promise<T>, ok?: string) => {
    try {
      const v = await p;
      if (ok) toast(ok);
      return v;
    } catch (e) {
      toast((e as Error).message, 'error');
      return undefined;
    }
  }, [toast]);

  useEffect(() => {
    void api.getState().then(setApp);
    void api.getSettings().then(setSettings);
    const offs = [
      on('state', s => {
        setApp(prev => ({ ...s, window: prev?.window ?? s.window }));
        if (s.locked) { setData(null); setRevealed(new Set()); }
      }),
      on('data', setData),
      on('settings', setSettings),
      on('navigate', r => setRoute(r)),
    ];
    return () => offs.forEach(off => off());
  }, []);

  useEffect(() => {
    if (app && !app.locked && !data) void api.getData().then(setData).catch(() => undefined);
  }, [app, data]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const s = await run(api.setSettings(patch));
    if (s) setSettings(s);
  }, [run]);

  const value = useMemo<Ctx>(() => ({
    app, data, settings, route, navigate: setRoute, filter,
    setFilter: f => { setFilterState(f); setRoute('/'); },
    query, setQuery, toast, toasts, run, updateSettings,
    reveal: k => revealed.has(k),
    toggleReveal: k => setRevealed(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
  }), [app, data, settings, route, filter, query, toast, toasts, run, updateSettings, revealed]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}
