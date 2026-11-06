/** Runs the SSH agent inside Boltwork: serves SSH Key items from the vault and asks before each use. */
import { Notification } from 'electron';
import type net from 'node:net';
import type { SshAgentStatus } from '../core/api';
import { sshPublicBlob, sshSign } from '../core/ssh';
import { defaultAgentPath, startAgent, type AgentKey } from '../core/sshAgent';
import type { VaultStore } from '../core/store';

interface Host {
  store: () => VaultStore | null;
  /** Shows the main window so the user can unlock. */
  requestUnlock: () => void;
  onUsed: (itemId: string) => void;
  /** Asks whether a program may sign with this key, in Boltwork's prompt window. */
  ask: (key: { title: string; fingerprint: string; keyType: string }) => Promise<'once' | 'untilLock' | 'deny'>;
}

let server: net.Server | null = null;
let status: Omit<SshAgentStatus, 'keys' | 'enabled'> = { running: false, socket: defaultAgentPath() };
const approvedUntilLock = new Set<string>();
const blobCache = new Map<string, { updatedAt: number; blob: Buffer }>();
let host: Host;

export function initSshAgent(h: Host) { host = h; }

/** Forget "allow until locked" approvals. Call when the vault locks. */
export function sshAgentLocked() { approvedUntilLock.clear(); blobCache.clear(); }

async function waitForUnlock(timeoutMs = 60_000): Promise<VaultStore | null> {
  const s = host.store();
  if (s) return s;
  host.requestUnlock();
  if (Notification.isSupported()) new Notification({ title: 'Boltwork', body: 'An SSH client wants to use a key. Unlock Boltwork to continue.' }).show();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 300));
    const st = host.store();
    if (st) return st;
  }
  return null;
}

function keysFrom(store: VaultStore): (AgentKey & { title: string; fingerprint: string; keyType: string })[] {
  const out = [];
  for (const item of store.snapshot().items) {
    if (item.category !== 'sshKey' || item.state !== 'active') continue;
    const f = (id: string) => item.fields.find(x => x.id === id)?.value ?? '';
    if (!f('privateKey')) continue;
    let cached = blobCache.get(item.id);
    if (!cached || cached.updatedAt !== item.updatedAt) {
      try { cached = { updatedAt: item.updatedAt, blob: sshPublicBlob(f('privateKey')) }; } catch { continue; }
      blobCache.set(item.id, cached);
    }
    out.push({ id: item.id, blob: cached.blob, comment: item.title, title: item.title, fingerprint: f('fingerprint'), keyType: f('keyType') });
  }
  return out;
}

async function approve(key: AgentKey, title: string, fingerprint: string, keyType: string): Promise<boolean> {
  if (approvedUntilLock.has(key.id)) return true;
  const answer = await host.ask({ title, fingerprint, keyType });
  if (answer === 'untilLock') approvedUntilLock.add(key.id);
  return answer !== 'deny';
}

export async function setSshAgentEnabled(enabled: boolean): Promise<void> {
  if (!enabled) {
    server?.close();
    server = null;
    status = { running: false, socket: defaultAgentPath() };
    return;
  }
  if (server) return;
  try {
    server = await startAgent(defaultAgentPath(), {
      listKeys: async () => {
        const s = await waitForUnlock();
        return s ? keysFrom(s) : [];
      },
      sign: async (key, data, flags) => {
        const s = await waitForUnlock();
        if (!s) return null;
        const k = keysFrom(s).find(x => x.id === key.id);
        if (!k || !(await approve(key, k.title, k.fingerprint, k.keyType))) return null;
        const pk = s.getItem(key.id).fields.find(f => f.id === 'privateKey')!.value;
        host.onUsed(key.id);
        return sshSign(pk, data, flags);
      },
    });
    status = { running: true, socket: defaultAgentPath() };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const inUse = code === 'EADDRINUSE';
    status = {
      running: false, socket: defaultAgentPath(), inUse,
      error: inUse ? 'Another SSH agent is already running.' : (e as Error).message,
    };
    server = null;
  }
}

export function sshAgentStatus(enabled: boolean): SshAgentStatus {
  const s = host.store();
  return { ...status, enabled, keys: s ? keysFrom(s).map(({ title, fingerprint, keyType }) => ({ title, fingerprint, keyType })) : [] };
}
