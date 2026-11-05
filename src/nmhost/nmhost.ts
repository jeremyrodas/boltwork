/**
 * Native messaging host. Chrome starts this (via the launcher the app registers) and talks to it with
 * 4-byte length-prefixed JSON on stdin/stdout. We relay each message to the running Strongroom app over
 * its local pipe, tagged with the extension origin Chrome passed us, and relay replies back.
 */
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const origin = process.argv.find(a => a.startsWith('chrome-extension://')) ?? '';
const sockPath = process.env.STRONGROOM_BROWSER_SOCK
  || (process.platform === 'win32' ? '\\\\.\\pipe\\strongroom-browser' : path.join(os.homedir(), '.strongroom', 'browser.sock'));

function send(obj: unknown) {
  let json = Buffer.from(JSON.stringify(obj), 'utf8');
  if (json.length > 1024 * 1024) json = Buffer.from(JSON.stringify({ id: (obj as { id?: unknown }).id, body: { error: 'too-large' } }));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([len, json]));
}

let conn: net.Socket | null = null;
let connecting: Promise<net.Socket | null> | null = null;

function connect(): Promise<net.Socket | null> {
  if (conn && !conn.destroyed) return Promise.resolve(conn);
  if (connecting) return connecting;
  connecting = new Promise(resolve => {
    const s = net.connect(sockPath);
    let buf = '';
    s.setEncoding('utf8');
    s.once('connect', () => { conn = s; connecting = null; resolve(s); });
    s.once('error', () => { if (conn !== s) { connecting = null; resolve(null); } });
    s.on('close', () => { if (conn === s) conn = null; });
    s.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try { send(JSON.parse(line)); } catch { /* ignore */ }
      }
    });
  });
  return connecting;
}

async function relay(msg: { id?: unknown; msg?: unknown }) {
  const s = await connect();
  if (!s) { send({ id: msg.id, body: { error: 'not-running' } }); return; }
  s.write(`${JSON.stringify({ id: msg.id, origin, msg: msg.msg })}\n`);
}

let input = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const len = input.readUInt32LE(0);
    if (len > 4 * 1024 * 1024) process.exit(1);
    if (input.length < 4 + len) break;
    const body = input.subarray(4, 4 + len).toString('utf8');
    input = input.subarray(4 + len);
    try { void relay(JSON.parse(body)); } catch { /* ignore malformed */ }
  }
});
process.stdin.on('end', () => process.exit(0));
