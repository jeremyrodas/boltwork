/**
 * Boltwork sync server.
 *
 * Stores each account's records exactly as the apps seal them; it never sees a password, the Secret Key,
 * the master key or any plaintext. Apps sign in with an auth key derived one-way from the account key,
 * and the server keeps only a SHA-256 of it (the auth key is 256 random-looking bits, so a slow hash adds nothing).
 *
 * Environment:
 *   PORT                 default 8787
 *   DATA_DIR             default ./data   (SQLite database and server secret)
 *   SIGNUPS              first | open | closed   (default first: only the first account may sign up)
 *   TRUST_PROXY          1 to take the client IP from X-Forwarded-For (for rate limiting behind a proxy)
 *   STORAGE_LIMIT_MB     per-account limit for attachment files (default 0: no limit)
 *   WEB_VAULT            on to serve the web vault at / (default off; see web.ts)
 *   WEB_DIR              the web vault's files (default: the web folder next to server.js)
 *
 * Attachments are stored as files under DATA_DIR/blobs/<account>/<id>, exactly as the apps sealed them.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { webVault } from './web';

export interface ServerOptions {
  port?: number; dataDir?: string; signups?: 'first' | 'open' | 'closed'; trustProxy?: boolean; log?: (s: string) => void;
  /** Per-account attachment storage limit in bytes; 0 for none. */
  storageLimit?: number;
  /** Folder with the web vault's files to serve at /; none by default. */
  webDir?: string;
}

const MAX_BODY = 32 * 1024 * 1024;
const MAX_RECORD = 4 * 1024 * 1024;
/** A sealed 100 MB attachment (the app's limit) is about 134 MB of JSON. */
const MAX_BLOB = 140 * 1024 * 1024;
const BLOB_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SESSION_DAYS = 30;
const API = '/api/v1';

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest();
const b64 = (b: Buffer) => b.toString('base64url');

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

function sameBytes(a: Buffer, b: Buffer) { return a.length === b.length && timingSafeEqual(a, b); }

export function startServer(opts: ServerOptions = {}): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  const dataDir = opts.dataDir ?? process.env.DATA_DIR ?? path.resolve('data');
  const signups = opts.signups ?? (process.env.SIGNUPS as ServerOptions['signups']) ?? 'first';
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === '1';
  const log = opts.log ?? (s => console.log(`${new Date().toISOString()} ${s}`));
  const storageLimit = opts.storageLimit ?? Number(process.env.STORAGE_LIMIT_MB ?? 0) * 1024 * 1024;
  const webDir = opts.webDir ?? (process.env.WEB_VAULT === 'on' ? process.env.WEB_DIR ?? path.join(__dirname, 'web') : undefined);
  const web = webDir ? webVault(webDir) : null;
  if (webDir && !web) throw new Error(`WEB_VAULT is on, but ${webDir} has no index.html. Build it with npm run build (dist-web).`);
  fs.mkdirSync(dataDir, { recursive: true });
  const blobRoot = path.join(dataDir, 'blobs');

  const secretFile = path.join(dataDir, 'server-secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  const serverSecret = Buffer.from(fs.readFileSync(secretFile, 'utf8').trim(), 'hex');

  const db = new DatabaseSync(path.join(dataDir, 'strongroom.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,               -- the apps' accountId
      email TEXT NOT NULL UNIQUE,
      auth_hash BLOB NOT NULL,
      kdf TEXT NOT NULL,                 -- JSON KDF params (public)
      wrapped_key TEXT NOT NULL,         -- JSON master key sealed with the account key
      rev INTEGER NOT NULL DEFAULT 0,    -- last revision handed out
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      rev INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      data TEXT,                         -- JSON sealed blob, NULL for tombstones
      PRIMARY KEY (account_id, id)
    );
    CREATE INDEX IF NOT EXISTS records_rev ON records(account_id, rev);
    CREATE TABLE IF NOT EXISTS blobs (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash BLOB PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      device TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  const q = {
    accountCount: db.prepare('SELECT COUNT(*) AS n FROM accounts'),
    accountByEmail: db.prepare('SELECT * FROM accounts WHERE email = ?'),
    accountById: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    insertAccount: db.prepare('INSERT INTO accounts (id, email, auth_hash, kdf, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    updateKeys: db.prepare('UPDATE accounts SET auth_hash = ?, kdf = ?, wrapped_key = ? WHERE id = ?'),
    bumpRev: db.prepare('UPDATE accounts SET rev = rev + 1 WHERE id = ? RETURNING rev'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, account_id, device, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?'),
    touchSession: db.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash != ?'),
    sessions: db.prepare('SELECT device, created_at, last_used_at FROM sessions WHERE account_id = ? ORDER BY last_used_at DESC'),
    recordsSince: db.prepare('SELECT id, kind, rev, updated_at, deleted, data FROM records WHERE account_id = ? AND rev > ? ORDER BY rev LIMIT ?'),
    record: db.prepare('SELECT id, kind, rev, updated_at, deleted, data FROM records WHERE account_id = ? AND id = ?'),
    upsertRecord: db.prepare(`INSERT INTO records (account_id, id, kind, rev, updated_at, deleted, data) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET kind = excluded.kind, rev = excluded.rev, updated_at = excluded.updated_at, deleted = excluded.deleted, data = excluded.data`),
    deleteAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),
    blobs: db.prepare('SELECT id, size, created_at FROM blobs WHERE account_id = ? ORDER BY id'),
    blob: db.prepare('SELECT id, size FROM blobs WHERE account_id = ? AND id = ?'),
    blobUsage: db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM blobs WHERE account_id = ?'),
    upsertBlob: db.prepare(`INSERT INTO blobs (account_id, id, size, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET size = excluded.size`),
    deleteBlob: db.prepare('DELETE FROM blobs WHERE account_id = ? AND id = ?'),
  };

  // ---- live updates: devices wait on GET /changes and are woken when another device changes something ----
  type Waiter = { tokenHash: Buffer; wake: () => void };
  const waiters = new Map<string, Set<Waiter>>();
  /** Wakes every device of the account waiting for changes, except the one that made the change. */
  function notify(accountId: string, except?: Buffer) {
    for (const w of waiters.get(accountId) ?? []) if (!except || !w.tokenHash.equals(except)) w.wake();
  }

  // Account ids are checked against BLOB_ID-style patterns on sign-up, so they're safe as folder names.
  const blobDir = (accountId: string) => path.join(blobRoot, accountId);
  const blobFile = (accountId: string, id: string) => path.join(blobDir(accountId), id);

  type Row = Record<string, unknown>;
  const toRecord = (r: Row) => ({ id: r.id as string, kind: r.kind as string, rev: Number(r.rev), updatedAt: Number(r.updated_at), deleted: !!r.deleted, data: r.data ? JSON.parse(r.data as string) : undefined });

  // ---- rate limiting for sign-in and sign-up ----
  const attempts = new Map<string, { n: number; reset: number }>();
  function limit(key: string, max: number, windowMs: number) {
    const now = Date.now();
    const a = attempts.get(key);
    if (!a || a.reset < now) { attempts.set(key, { n: 1, reset: now + windowMs }); return; }
    if (++a.n > max) throw new HttpError(429, 'Too many attempts. Try again later.');
  }

  // ---- helpers ----
  const email = (v: unknown) => {
    const e = String(v ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(e) || e.length > 200) throw new HttpError(400, 'Enter a valid email address.');
    return e;
  };
  const authKey = (v: unknown) => {
    const k = Buffer.from(String(v ?? ''), 'base64url');
    if (k.length !== 32) throw new HttpError(400, 'Bad auth key.');
    return k;
  };
  const sealed = (v: unknown, what: string) => {
    const s = v as { n?: unknown; c?: unknown };
    if (!s || typeof s.n !== 'string' || typeof s.c !== 'string') throw new HttpError(400, `Bad ${what}.`);
    return JSON.stringify({ n: s.n, c: s.c });
  };
  const kdfParams = (v: unknown) => {
    const k = v as { salt?: unknown; ops?: unknown; mem?: unknown };
    if (!k || typeof k.salt !== 'string' || typeof k.ops !== 'number' || typeof k.mem !== 'number') throw new HttpError(400, 'Bad KDF parameters.');
    return JSON.stringify(v);
  };
  /** KDF params for unknown emails, stable per email, so prelogin doesn't reveal who has an account. */
  const fakeKdf = (e: string) => ({ alg: 'argon2id13', salt: createHmac('sha256', serverSecret).update(e).digest().subarray(0, 16).toString('base64'), ops: 3, mem: 128 * 1024 * 1024 });

  function newSession(accountId: string, device: string) {
    const token = b64(randomBytes(32));
    const now = Date.now();
    q.insertSession.run(sha256(token), accountId, device.slice(0, 80) || 'Device', now, now, now + SESSION_DAYS * 86400_000);
    return token;
  }

  function auth(req: http.IncomingMessage): { accountId: string; tokenHash: Buffer } {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!m) throw new HttpError(401, 'Sign in first.');
    const tokenHash = sha256(m[1]);
    const now = Date.now();
    const s = q.session.get(tokenHash, now) as Row | undefined;
    if (!s) throw new HttpError(401, 'Your session has expired. Sign in again.');
    if (now - Number(s.last_used_at) > 3600_000) q.touchSession.run(now, now + SESSION_DAYS * 86400_000, tokenHash);
    return { accountId: s.account_id as string, tokenHash };
  }

  // ---- routes ----
  async function route(req: http.IncomingMessage, url: URL, body: Row, ip: string): Promise<unknown> {
    const r = `${req.method} ${url.pathname}`;
    if (r === `GET ${API}/health` || r === 'GET /health') return { ok: true, name: 'strongroom-server', signups: signups === 'first' ? (Number((q.accountCount.get() as Row).n) === 0 ? 'open' : 'closed') : signups };

    if (r === `POST ${API}/accounts`) {
      limit(`signup:${ip}`, 10, 3600_000);
      const open = signups === 'open' || (signups === 'first' && Number((q.accountCount.get() as Row).n) === 0);
      if (!open) throw new HttpError(403, 'Sign-ups are closed on this server.');
      const e = email(body.email);
      const id = String(body.accountId ?? '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new HttpError(400, 'Bad account id.');
      if (q.accountByEmail.get(e) || q.accountById.get(id)) throw new HttpError(409, 'An account with that email already exists.');
      q.insertAccount.run(id, e, sha256(authKey(body.authKey)), kdfParams(body.kdf), sealed(body.wrappedKey, 'wrapped key'), Date.now());
      log(`account created ${id}`);
      return { token: newSession(id, String(body.device ?? '')), accountId: id };
    }

    if (r === `POST ${API}/prelogin`) {
      limit(`prelogin:${ip}`, 60, 600_000);
      const e = email(body.email);
      const a = q.accountByEmail.get(e) as Row | undefined;
      return { kdf: a ? JSON.parse(a.kdf as string) : fakeKdf(e) };
    }

    if (r === `POST ${API}/login`) {
      const e = email(body.email);
      limit(`login:${ip}`, 20, 600_000);
      limit(`login:${e}`, 10, 600_000);
      const a = q.accountByEmail.get(e) as Row | undefined;
      const given = sha256(authKey(body.authKey));
      if (!a || !sameBytes(given, Buffer.from(a.auth_hash as Uint8Array))) throw new HttpError(401, 'Incorrect email, password or Secret Key.');
      return { token: newSession(a.id as string, String(body.device ?? '')), accountId: a.id, kdf: JSON.parse(a.kdf as string), wrappedKey: JSON.parse(a.wrapped_key as string) };
    }

    const { accountId, tokenHash } = auth(req);

    if (r === `POST ${API}/logout`) { q.deleteSession.run(tokenHash); return { ok: true }; }

    if (r === `GET ${API}/account`) {
      const a = q.accountById.get(accountId) as Row;
      return { accountId, email: a.email, rev: Number(a.rev), devices: (q.sessions.all(accountId) as Row[]).map(s => ({ device: s.device, createdAt: Number(s.created_at), lastUsedAt: Number(s.last_used_at) })) };
    }

    if (r === `PUT ${API}/account/keys`) {
      // After a password change: new auth key and re-wrapped master key. Signs out other devices.
      q.updateKeys.run(sha256(authKey(body.authKey)), kdfParams(body.kdf), sealed(body.wrappedKey, 'wrapped key'), accountId);
      q.deleteOtherSessions.run(accountId, tokenHash);
      return { ok: true };
    }

    if (r === `GET ${API}/changes`) {
      // Long poll: answers at once if there are records newer than `since`, otherwise when another device
      // changes something, or after `wait` seconds with changed: false.
      const since = Number(url.searchParams.get('since') ?? 0) || 0;
      const rev = () => Number((q.accountById.get(accountId) as Row).rev);
      if (rev() > since) return { changed: true, rev: rev() };
      const waitMs = Math.min(Math.max(Number(url.searchParams.get('wait') ?? 25) || 25, 1), 55) * 1000;
      return new Promise(resolve => {
        const set = waiters.get(accountId) ?? new Set<Waiter>();
        waiters.set(accountId, set);
        const finish = (changed: boolean) => {
          clearTimeout(timer);
          set.delete(w);
          if (!set.size) waiters.delete(accountId);
          resolve(changed ? { changed: true, rev: q.accountById.get(accountId) ? rev() : since } : { changed: false, rev: since });
        };
        const w: Waiter = { tokenHash, wake: () => finish(true) };
        const timer = setTimeout(() => finish(false), waitMs);
        set.add(w);
        req.socket.once('close', () => { clearTimeout(timer); set.delete(w); if (!set.size) waiters.delete(accountId); });
      });
    }

    if (r === `DELETE ${API}/account`) {
      q.deleteAccount.run(accountId);
      notify(accountId);
      fs.rmSync(blobDir(accountId), { recursive: true, force: true });
      log(`account deleted ${accountId}`);
      return { ok: true };
    }

    if (r === `GET ${API}/blobs`) {
      const blobs = (q.blobs.all(accountId) as Row[]).map(b => ({ id: b.id as string, size: Number(b.size), createdAt: Number(b.created_at) }));
      return { blobs, now: Date.now() };
    }

    if (r === `GET ${API}/records`) {
      const since = Number(url.searchParams.get('since') ?? 0) || 0;
      const rows = q.recordsSince.all(accountId, since, 1001) as Row[];
      const more = rows.length > 1000;
      const records = rows.slice(0, 1000).map(toRecord);
      const cursor = records.length ? records[records.length - 1].rev : since;
      return { records, cursor, more };
    }

    if (r === `POST ${API}/records`) {
      const input = body.records;
      if (!Array.isArray(input) || input.length > 2000) throw new HttpError(400, 'Send up to 2000 records at a time.');
      const accepted: { id: string; rev: number }[] = [];
      const conflicts: ReturnType<typeof toRecord>[] = [];
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const raw of input as Row[]) {
          const id = String(raw.id ?? '');
          const kind = String(raw.kind ?? '');
          if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !['vault', 'collection', 'item'].includes(kind)) throw new HttpError(400, 'Bad record.');
          const deleted = !!raw.deleted;
          const data = deleted ? null : sealed(raw.data, 'record');
          if (data && data.length > MAX_RECORD) throw new HttpError(413, `Record ${id} is too large.`);
          const current = q.record.get(accountId, id) as Row | undefined;
          // Optimistic concurrency: the app says which revision it last saw.
          if ((current ? Number(current.rev) : 0) !== Number(raw.baseRev ?? 0)) { if (current) conflicts.push(toRecord(current)); continue; }
          const rev = Number((q.bumpRev.get(accountId) as Row).rev);
          q.upsertRecord.run(accountId, id, kind, rev, Number(raw.updatedAt) || Date.now(), deleted ? 1 : 0, data);
          accepted.push({ id, rev });
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      if (accepted.length) notify(accountId, tokenHash);
      return { accepted, conflicts };
    }

    throw new HttpError(404, 'Not found.');
  }

  /**
   * Attachment files: PUT, GET and DELETE /api/v1/blobs/<id>. Bodies are streamed rather than buffered,
   * since a sealed attachment can be over 100 MB.
   */
  async function blobRoute(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<unknown> {
    if (!BLOB_ID.test(id)) throw new HttpError(400, 'Bad attachment id.');
    const { accountId, tokenHash } = auth(req);
    const file = blobFile(accountId, id);

    if (req.method === 'GET') {
      if (!q.blob.get(accountId, id) || !fs.existsSync(file)) throw new HttpError(404, 'Attachment not found.');
      const size = fs.statSync(file).size;
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      await new Promise<void>((resolve, reject) => fs.createReadStream(file).on('error', reject).on('end', resolve).pipe(res));
      return undefined;
    }

    if (req.method === 'DELETE') {
      q.deleteBlob.run(accountId, id);
      fs.rmSync(file, { force: true });
      notify(accountId, tokenHash);
      return { ok: true };
    }

    if (req.method === 'PUT') {
      const declared = Number(req.headers['content-length'] ?? NaN);
      if (Number.isFinite(declared) && declared > MAX_BLOB) throw new HttpError(413, 'Attachments can be up to 100 MB.');
      if (storageLimit) {
        const used = Number((q.blobUsage.get(accountId) as Row).n);
        if (used + (Number.isFinite(declared) ? declared : 0) > storageLimit) throw new HttpError(507, 'This account is out of attachment storage on the sync server.');
      }
      fs.mkdirSync(blobDir(accountId), { recursive: true });
      const tmp = `${file}.${randomBytes(6).toString('hex')}.part`;
      let size = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          const out = fs.createWriteStream(tmp);
          req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MAX_BLOB) { req.pause(); out.destroy(); reject(new HttpError(413, 'Attachments can be up to 100 MB.')); return; }
            if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()); }
          });
          req.on('end', () => out.end());
          req.on('error', reject);
          out.on('error', reject);
          out.on('finish', resolve);
        });
        if (!size) throw new HttpError(400, 'Empty attachment.');
        fs.renameSync(tmp, file);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      q.upsertBlob.run(accountId, id, size, Date.now());
      notify(accountId, tokenHash);
      return { ok: true, size };
    }

    throw new HttpError(405, 'Method not allowed.');
  }

  const server = http.createServer((req, res) => {
    const ip = (trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';
    const send = (status: number, body: unknown) => {
      if (res.headersSent) { res.destroy(); return; }
      const json = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: status >= 400 ? 'close' : 'keep-alive' });
      res.end(json);
    };
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (web && !pathname.startsWith('/api/') && web(req, res, pathname)) return;
    const blob = /^\/api\/v1\/blobs\/([^/]+)$/.exec(pathname);
    if (blob) {
      blobRoute(req, res, decodeURIComponent(blob[1])).then(r => { if (r !== undefined) send(200, r); }, (e: unknown) => {
        if (e instanceof HttpError) send(e.status, { error: e.message });
        else { log(`error ${req.method} blob: ${(e as Error).stack ?? e}`); send(500, { error: 'Server error.' }); }
        req.resume();
      });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { send(413, { error: 'Request too large.' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (res.headersSent) return;
      let body: Row = {};
      try { if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(400, { error: 'Bad JSON.' }); return; }
      const url = new URL(req.url ?? '/', 'http://localhost');
      route(req, url, body, ip).then(r => send(200, r), (e: unknown) => {
        if (e instanceof HttpError) send(e.status, { error: e.message });
        else { log(`error ${req.method} ${url.pathname}: ${(e as Error).stack ?? e}`); send(500, { error: 'Server error.' }); }
      });
    });
  });

  const port = opts.port ?? Number(process.env.PORT ?? 8787);
  return new Promise(resolve => server.listen(port, () => {
    const addr = server.address() as { port: number };
    const url = `http://localhost:${addr.port}`;
    log(`strongroom-server listening on ${addr.port} (sign-ups: ${signups}, data: ${dataDir}${web ? ', web vault: on' : ''})`);
    resolve({ server, url, close: () => new Promise<void>(r => { server.close(() => { db.close(); r(); }); server.closeAllConnections(); }) });
  }));
}


