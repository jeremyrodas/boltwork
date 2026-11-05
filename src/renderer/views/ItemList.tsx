import { useEffect, useMemo, useRef, useState } from 'react';
import { subtitleOf, TEMPLATES } from '../../core/templates';
import type { Category, Settings } from '../../core/types';
import { api } from '../api';
import { Button, Empty, IconButton, ItemIcon, Modal } from '../components/ui';
import { useApp } from '../state';
import { visibleItems } from './Sidebar';

export function CategoryPicker({ onPick, onClose }: { onPick: (c: Category) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = TEMPLATES.filter(t => t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="What would you like to add?" onClose={onClose} wide>
      <input autoFocus placeholder="Search categories" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && list[0]) onPick(list[0].category); }} />
      <div className="category-grid">
        {list.map(t => (
          <button key={t.category} className="category-tile" onClick={() => onPick(t.category)}>
            <span className="emoji">{t.icon}</span>{t.name}
          </button>
        ))}
      </div>
    </Modal>
  );
}

const FILTER_TITLES: Record<string, string> = { all: 'All Items', favorites: 'Favorites', archive: 'Archive', deleted: 'Recently Deleted' };

export function ItemList({ selectedId }: { selectedId?: string }) {
  const { data, settings, filter, query, setQuery, navigate, updateSettings, run } = useApp();
  const [picker, setPicker] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => (data && settings ? visibleItems(data, settings, filter, query) : []), [data, settings, filter, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); setPicker(true); }
      if (typing && e.target !== searchRef.current) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = items.findIndex(i => i.id === selectedId);
        const next = items[Math.max(0, Math.min(items.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) navigate(`/item/${next.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, selectedId, navigate]);

  useEffect(() => {
    listRef.current?.querySelector('.row-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  if (!data || !settings) return null;
  const title = filter.kind === 'category' ? TEMPLATES.find(t => t.category === filter.category)?.name
    : filter.kind === 'vault' ? data.vaults.find(v => v.id === filter.vaultId)?.name
      : filter.kind === 'tag' ? `#${filter.tag}` : FILTER_TITLES[filter.kind];

  return (
    <section className="list-pane">
      <div className="list-head">
        <div className="search-wrap">
          <span className="search-icon">⌕</span>
          <input ref={searchRef} className="search" placeholder="Search  (try tag:work, is:favorite, has:otp)" value={query}
            onChange={e => setQuery(e.target.value)} onFocus={() => setShowHistory(true)} onBlur={() => setTimeout(() => setShowHistory(false), 150)}
            onKeyDown={e => {
              if (e.key === 'Enter' && items[0]) { navigate(`/item/${items[0].id}`); void api.addSearchHistory(query); }
              if (e.key === 'Escape') setQuery('');
            }} />
          {showHistory && !query && data.searchHistory.length > 0 && (
            <div className="search-history">
              <div className="sh-head">Recent searches <button className="link" onMouseDown={() => run(api.clearSearchHistory(), 'Search history cleared')}>Clear</button></div>
              {data.searchHistory.map(h => <button key={h} className="sh-item" onMouseDown={() => setQuery(h)}>{h}</button>)}
            </div>
          )}
        </div>
        <IconButton title={settings.privacyMode ? 'Turn off Privacy Mode' : 'Privacy Mode: hide details'} active={settings.privacyMode}
          onClick={() => updateSettings({ privacyMode: !settings.privacyMode })}>{settings.privacyMode ? '🕶️' : '👁'}</IconButton>
        <Button kind="primary" small onClick={() => setPicker(true)}>＋ New Item</Button>
      </div>
      <div className="list-sub">
        <span className="list-title">{query ? `Results for “${query}”` : title} <span className="muted">{items.length}</span></span>
        <select value={settings.itemSort} onChange={e => updateSettings({ itemSort: e.target.value as Settings['itemSort'] })} title="Sort by">
          <option value="title">Title</option>
          <option value="dateModified">Date modified</option>
          <option value="dateCreated">Date created</option>
          <option value="recentlyUsed">Recently used</option>
          <option value="frequentlyUsed">Most used</option>
        </select>
      </div>
      {filter.kind === 'deleted' && items.length > 0 && (
        <div className="banner">Items here are deleted for good after {settings.emptyTrashDays} days.
          <button className="link danger" onClick={async () => { if (confirm('Permanently delete everything in Recently Deleted?')) await run(api.emptyTrash(), 'Recently Deleted emptied'); }}>Empty now</button>
        </div>
      )}
      <div className="list" ref={listRef}>
        {items.length === 0 && (query
          ? <Empty icon="🔍" title="No matches">Try fewer words, or search a different vault.</Empty>
          : <Empty icon="🗝️" title="Nothing here yet"><Button onClick={() => setPicker(true)}>Add an item</Button></Empty>)}
        {items.map(item => (
          <button key={item.id} className={`row-item${item.id === selectedId ? ' selected' : ''}`} onClick={() => navigate(`/item/${item.id}`)}
            onDoubleClick={() => item.state === 'active' && navigate(`/edit/${item.id}`)}>
            <ItemIcon item={item} />
            <span className="row-text">
              <span className="row-title">{item.title}</span>
              <span className="row-sub">{settings.privacyMode ? '••••••' : subtitleOf(item)}</span>
            </span>
            {item.favorite && <span className="row-fav">★</span>}
          </button>
        ))}
      </div>
      {picker && <CategoryPicker onClose={() => setPicker(false)} onPick={c => { setPicker(false); navigate(`/new/${c}`); }} />}
    </section>
  );
}
