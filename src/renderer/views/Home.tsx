import { Download, Layers, ShieldCheck } from 'lucide-react';
import { subtitleOf } from '../../core/templates';
import { Ico } from '../components/icons';
import type { Item } from '../../core/types';
import { Button, ItemIcon } from '../components/ui';
import { useApp } from '../state';
import { collectionVaultIds } from './Sidebar';
import { useWatchtower } from './Watchtower';

function Tiles({ items }: { items: Item[] }) {
  const { navigate, settings } = useApp();
  return (
    <div className="tiles">
      {items.map(i => (
        <button key={i.id} className="tile" onClick={() => navigate(`/item/${i.id}`)}>
          <ItemIcon item={i} size={36} />
          <span className="row-title">{i.title}</span>
          <span className="row-sub">{settings?.privacyMode ? '••••••' : subtitleOf(i)}</span>
        </button>
      ))}
    </div>
  );
}

export function HomeView() {
  const { data, settings, navigate, setFilter } = useApp();
  const { report } = useWatchtower();
  if (!data || !settings) return null;
  const ids = collectionVaultIds(data, settings);
  const active = data.items.filter(i => i.state === 'active' && (!ids || ids.has(i.vaultId)));
  const favorites = active.filter(i => i.favorite).slice(0, 8);
  const recent = [...active].filter(i => i.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 8);
  const created = [...active].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const hour = new Date().getHours();

  return (
    <section className="page">
      <h1>{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}</h1>
      <div className="home-grid">
        <button className="card padded home-stat" onClick={() => navigate('/watchtower')}>
          <span className="stat-icon"><Ico icon={ShieldCheck} size={20} /></span>
          <span><b>Watchtower</b><span className="muted">{report ? `Score ${report.score} · ${report.issues.length} issue${report.issues.length === 1 ? '' : 's'}` : 'Checking…'}</span></span>
        </button>
        <button className="card padded home-stat" onClick={() => setFilter({ kind: 'all' })}>
          <span className="stat-icon"><Ico icon={Layers} size={20} /></span><span><b>{active.length} items</b><span className="muted">in {ids ? ids.size : data.vaults.length} vault{data.vaults.length === 1 ? '' : 's'}</span></span>
        </button>
        <button className="card padded home-stat" onClick={() => navigate('/settings/import')}>
          <span className="stat-icon"><Ico icon={Download} size={20} /></span><span><b>Import</b><span className="muted">from 1Password, Bitwarden, browsers…</span></span>
        </button>
      </div>
      {active.length === 0 && (
        <div className="card padded">
          <h2>Get started</h2>
          <p className="muted">Bring your passwords over from another app or browser, or add your first item.</p>
          <div className="row gap"><Button kind="primary" onClick={() => navigate('/settings/import')}>Import passwords</Button><Button onClick={() => navigate('/new/login')}>Add a login</Button></div>
        </div>
      )}
      {favorites.length > 0 && (<><h2>Favorites</h2><Tiles items={favorites} /></>)}
      {recent.length > 0 && (<><h2>Recently used</h2><Tiles items={recent} /></>)}
      {created.length > 0 && (<><h2>Recently added</h2><Tiles items={created} /></>)}
    </section>
  );
}
