/**
 * A minimal SSH agent (draft-miller-ssh-agent): lists identities and signs. It never accepts keys from
 * clients and never reveals private keys. Listens on a Windows named pipe or a Unix socket.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { SshReader, sshString } from './ssh';

const FAILURE = 5;
const REQUEST_IDENTITIES = 11;
const IDENTITIES_ANSWER = 12;
const SIGN_REQUEST = 13;
const SIGN_RESPONSE = 14;

export interface AgentKey { id: string; blob: Buffer; comment: string }

export interface AgentBackend {
  listKeys(): Promise<AgentKey[]>;
  /** Returns the signature blob, or null if the user denied the request. */
  sign(key: AgentKey, data: Buffer, flags: number): Promise<Buffer | null>;
}

export function defaultAgentPath(): string {
  if (process.env.STRONGROOM_AGENT_SOCK) return process.env.STRONGROOM_AGENT_SOCK;
  return process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : path.join(os.homedir(), '.strongroom', 'agent.sock');
}

const frame = (type: number, body: Buffer = Buffer.alloc(0)) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length + 1);
  return Buffer.concat([len, Buffer.from([type]), body]);
};

async function handle(msg: Buffer, backend: AgentBackend): Promise<Buffer> {
  const r = new SshReader(msg);
  const type = r.u8();
  if (type === REQUEST_IDENTITIES) {
    const keys = await backend.listKeys();
    const n = Buffer.alloc(4);
    n.writeUInt32BE(keys.length);
    return frame(IDENTITIES_ANSWER, Buffer.concat([n, ...keys.flatMap(k => [sshString(k.blob), sshString(k.comment)])]));
  }
  if (type === SIGN_REQUEST) {
    const blob = r.string();
    const data = r.string();
    const flags = r.remaining >= 4 ? r.u32() : 0;
    const key = (await backend.listKeys()).find(k => k.blob.equals(blob));
    if (!key) return frame(FAILURE);
    const sig = await backend.sign(key, Buffer.from(data), flags);
    return sig ? frame(SIGN_RESPONSE, sshString(sig)) : frame(FAILURE);
  }
  // Adding/removing keys, agent locking and extensions are not supported: keys live in the vault.
  return frame(FAILURE);
}

export function startAgent(socketPath: string, backend: AgentBackend): Promise<net.Server> {
  if (process.platform !== 'win32') {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    try { fs.unlinkSync(socketPath); } catch { /* not there */ }
  }
  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    let busy = Promise.resolve();
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk as Buffer]);
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len > 256 * 1024) { sock.destroy(); return; }
        if (buf.length < 4 + len) break;
        const msg = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        // Requests on one connection are answered in order.
        busy = busy.then(async () => {
          let reply: Buffer;
          try { reply = await handle(msg, backend); } catch { reply = frame(FAILURE); }
          if (!sock.destroyed) sock.write(reply);
        });
      }
    });
    sock.on('error', () => undefined);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600);
      resolve(server);
    });
  });
}
