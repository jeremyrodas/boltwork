import { useMemo, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { TEMPLATES } from '../../core/templates';
import { CategoryIcon, Ico, NAV_ICONS, VaultIcon } from '../components/icons';
import type { Item, Settings, VaultData } from '../../core/types';
import { searchItems } from '../../core/search';
import { api } from '../api';
import { useApp, type ListFilter } from '../state';

export function collectionVaultIds(data: VaultData, settings: Settings): Set<string> | null {
  const col = data.collections.find(c => c.id === settings.activeCollection);
  return col ? new Set(col.vaultIds) : null;
}

const SORTERS: Record<Settings['itemSort'], (a: Item, b: Item) => number> = {
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  dateCreated: (a, b) => b.createdAt - a.createdAt,
  dateModified: (a, b) => b.updatedAt - a.updatedAt,
  recentlyUsed: (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
  frequentlyUsed: (a, b) => b.useCount - a.useCount,
  passwordStrength: (a, b) => a.title.localeCompare(b.title),
};

export function visibleItems(data: VaultData, settings: Settings, filter: ListFilter, query: string): Item[] {
  const inCollection = collectionVaultIds(data, settings);
  let items = data.items.filter(i => !inCollection || inCollection.has(i.vaultId));
  const state = filter.kind === 'archive' ? 'archived' : filter.kind === 'deleted' ? 'deleted' : 'active';
  items = items.filter(i => i.state === state);
  if (filter.kind === 'favorites') items = items.filter(i => i.favorite);
  if (filter.kind === 'category') items = items.filter(i => i.category === filter.category);
  if (filter.kind === 'vault') items = items.filter(i => i.vaultId === filter.vaultId);
  if (filter.kind === 'tag') items = items.filter(i => i.tags.some(t => t === filter.tag || t.startsWith(`${filter.tag}/`)));
  if (query.trim()) {
    const extra = state === 'archived' ? ' is:archived' : state === 'deleted' ? ' is:deleted' : '';
    return searchItems(items, data.vaults, query + extra);
  }
  return [...items].sort(SORTERS[settings.itemSort]);
}

/** Builds a tree from slash-separated tags: "work/dev" nests under "work". */
function tagTree(tags: string[]): { tag: string; depth: number; name: string }[] {
  const all = new Set<string>();
  for (const t of tags) {
    const parts = t.split('/');
    parts.forEach((_, i) => all.add(parts.slice(0, i + 1).join('/')));
  }
  return [...all].sort((a, b) => a.localeCompare(b)).map(tag => ({ tag, depth: tag.split('/').length - 1, name: tag.split('/').pop()! }));
}

export function Sidebar() {
  const { data, settings, filter, setFilter, navigate, route, updateSettings } = useApp();
  const scoped = useMemo(() => {
    if (!data || !settings) return [];
    const ids = collectionVaultIds(data, settings);
    return data.items.filter(i => !ids || ids.has(i.vaultId));
  }, [data, settings]);
  if (!data || !settings) return null;
  const active = scoped.filter(i => i.state === 'active');
  const count = (f: (i: Item) => boolean) => active.filter(f).length;
  const tags = tagTree([...new Set(active.flatMap(i => i.tags))]);
  const colIds = collectionVaultIds(data, settings);
  const vaults = data.vaults.filter(v => !colIds || colIds.has(v.id));
  const is = (f: ListFilter) => route === '/' && JSON.stringify(f) === JSON.stringify(filter);

  const Entry = ({ f, icon, label, n }: { f: ListFilter; icon: ReactNode; label: string; n?: number }) => (
    <button className={`side-item${is(f) ? ' active' : ''}`} aria-current={is(f) ? 'page' : undefined} onClick={() => setFilter(f)}>
      <span className="side-icon">{icon}</span><span className="side-label">{label}</span>{n !== undefined && n > 0 && <span className="side-count">{n}</span>}
    </button>
  );
  const Nav = ({ to, icon, label }: { to: string; icon: ReactNode; label: string }) => (
    <button className={`side-item${route.startsWith(to) ? ' active' : ''}`} aria-current={route.startsWith(to) ? 'page' : undefined} onClick={() => navigate(to)}>
      <span className="side-icon">{icon}</span><span className="side-label">{label}</span>
    </button>
  );

  return (
    <nav className="sidebar">
      <div className="side-top">
        <div className="brand small"><span className="brand-mark" />Strongroom</div>
        <select className="collection-select" value={settings.activeCollection} onChange={e => updateSettings({ activeCollection: e.target.value })} title="Collection">
          <option value="">All vaults</option>
          {data.collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="side-scroll">
        <Nav to="/home" icon={<Ico icon={NAV_ICONS.home} />} label="Home" />
        <Entry f={{ kind: 'all' }} icon={<Ico icon={NAV_ICONS.all} />} label="All Items" n={active.length} />
        <Entry f={{ kind: 'favorites' }} icon={<Ico icon={NAV_ICONS.favorites} />} label="Favorites" n={count(i => i.favorite)} />
        <Nav to="/watchtower" icon={<Ico icon={NAV_ICONS.watchtower} />} label="Watchtower" />
        {settings.sidebarShowCategories && (<>
          <div className="side-heading">Categories</div>
          {TEMPLATES.filter(t => count(i => i.category === t.category) > 0).map(t => (
            <Entry key={t.category} f={{ kind: 'category', category: t.category }} icon={<CategoryIcon category={t.category} />} label={t.name} n={count(i => i.category === t.category)} />
          ))}
        </>)}
        <div className="side-heading">Vaults <button className="side-add" title="New vault" aria-label="New vault" onClick={() => navigate('/settings/vaults')}><Ico icon={Plus} size={14} /></button></div>
        {vaults.map(v => <Entry key={v.id} f={{ kind: 'vault', vaultId: v.id }} icon={<VaultIcon icon={v.icon} />} label={v.name} n={count(i => i.vaultId === v.id)} />)}
        {settings.sidebarShowTags && tags.length > 0 && (<>
          <div className="side-heading">Tags</div>
          {tags.map(t => (
            <button key={t.tag} className={`side-item${is({ kind: 'tag', tag: t.tag }) ? ' active' : ''}`} style={{ paddingLeft: 14 + t.depth * 14 }} onClick={() => setFilter({ kind: 'tag', tag: t.tag })}>
              <span className="side-icon"><Ico icon={NAV_ICONS.tag} size={14} /></span><span className="side-label">{t.name}</span>
            </button>
          ))}
        </>)}
        <div className="side-heading" />
        <Entry f={{ kind: 'archive' }} icon={<Ico icon={NAV_ICONS.archive} />} label="Archive" n={scoped.filter(i => i.state === 'archived').length} />
        <Entry f={{ kind: 'deleted' }} icon={<Ico icon={NAV_ICONS.deleted} />} label="Recently Deleted" n={scoped.filter(i => i.state === 'deleted').length} />
      </div>
      <div className="side-bottom">
        <Nav to="/generator" icon={<Ico icon={NAV_ICONS.generator} />} label="Generator" />
        <Nav to="/settings" icon={<Ico icon={NAV_ICONS.settings} />} label="Settings" />
        <button className="side-item" onClick={() => api.lock()}><span className="side-icon"><Ico icon={NAV_ICONS.lock} /></span><span className="side-label">Lock</span></button>
      </div>
    </nav>
  );
}
