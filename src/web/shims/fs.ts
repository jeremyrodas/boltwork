/**
 * The vault store's files, in memory: the web vault downloads the vault from the server on every sign-in
 * and keeps nothing in the browser, so locking (or closing the tab) leaves no copy behind.
 * Only the calls VaultStore makes are here.
 */
const files = new Map<string, Uint8Array>();
const dirs = new Set<string>();

const norm = (p: string) => p.replace(/\/+/g, '/').replace(/\/$/, '');
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

function need(p: string): Uint8Array {
  const f = files.get(norm(p));
  if (!f) throw Object.assign(new Error(`ENOENT: no such file, '${p}'`), { code: 'ENOENT' });
  return f;
}

export function existsSync(p: string): boolean { return files.has(norm(p)) || dirs.has(norm(p)); }
export function mkdirSync(p: string, _opts?: unknown): void { dirs.add(norm(p)); }

export function readFileSync(p: string, enc?: string | { encoding?: string }): string | Uint8Array {
  const bytes = need(p);
  return enc ? fromUtf8.decode(bytes) : bytes.slice();
}

export function writeFileSync(p: string, data: string | Uint8Array, _opts?: unknown): void {
  files.set(norm(p), typeof data === 'string' ? utf8.encode(data) : Uint8Array.from(data));
}

export function copyFileSync(from: string, to: string): void { files.set(norm(to), need(from).slice()); }

export function renameSync(from: string, to: string): void {
  const f = need(from);
  files.delete(norm(from));
  files.set(norm(to), f);
}

export function readdirSync(p: string): string[] {
  const prefix = `${norm(p)}/`;
  return [...files.keys()].filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(k => k.slice(prefix.length));
}

export function rmSync(p: string, _opts?: unknown): void {
  const n = norm(p);
  files.get(n)?.fill(0);
  files.delete(n);
}
export const unlinkSync = (p: string) => rmSync(p);

/** Forgets every file (after zeroing it), when the web vault locks. */
export function wipeAll(): void {
  for (const f of files.values()) f.fill(0);
  files.clear();
  dirs.clear();
}

export default { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, readdirSync, rmSync, unlinkSync };
