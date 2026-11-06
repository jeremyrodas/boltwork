/**
 * Connects Boltwork to the browser extension.
 *
 * Chrome starts our native messaging host (dist/nmhost.js) when the extension connects. The host relays
 * newline-delimited JSON over a local pipe to the server here. We also register the host with
 * Chrome, Edge and Brave (per-user, no admin rights needed).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { BrowserBridge, type BridgeDeps } from '../core/browserBridge';
import { EXTENSION_ID } from '../core/extensionId';

export const HOST_NAME = 'com.boltwork.browser';
const OLD_HOST_NAME = 'com.strongroom.browser';

export function bridgeSocketPath(): string {
  if (process.env.BOLTWORK_BROWSER_SOCK) return process.env.BOLTWORK_BROWSER_SOCK;
  return process.platform === 'win32' ? '\\\\.\\pipe\\boltwork-browser' : path.join(os.homedir(), '.boltwork', 'browser.sock');
}

let server: net.Server | null = null;
let bridge: BrowserBridge | null = null;
let status: { running: boolean; error?: string; registered: string[] } = { running: false, registered: [] };

export function getBridge() { return bridge; }
export function browserHostStatus() { return { ...status, socket: bridgeSocketPath(), extensionId: EXTENSION_ID }; }

export async function startBrowserHost(deps: BridgeDeps): Promise<void> {
  if (server) return;
  bridge = new BrowserBridge(deps);
  const sock = bridgeSocketPath();
  if (process.platform !== 'win32') {
    fs.mkdirSync(path.dirname(sock), { recursive: true, mode: 0o700 });
    try { fs.unlinkSync(sock); } catch { /* not there */ }
  }
  const srv = net.createServer(conn => {
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > 4 * 1024 * 1024) { conn.destroy(); return; }
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req: { id?: unknown; origin?: unknown; msg?: unknown };
        try { req = JSON.parse(line); } catch { continue; }
        const origin = String(req.origin ?? '');
        const reply = (body: unknown) => { if (!conn.destroyed) conn.write(`${JSON.stringify({ id: req.id, body })}\n`); };
        if (origin !== `chrome-extension://${EXTENSION_ID}/`) { reply({ error: 'unknown-extension' }); continue; }
        bridge!.handle(req.msg as never, origin).then(reply, e => reply({ error: (e as Error).message }));
      }
    });
    conn.on('error', () => conn.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(sock, () => { srv.off('error', reject); resolve(); });
  }).then(() => {
    server = srv;
    if (process.platform !== 'win32') fs.chmodSync(sock, 0o600);
    status = { ...status, running: true, error: undefined };
  }, (e: NodeJS.ErrnoException) => {
    status = { ...status, running: false, error: e.code === 'EADDRINUSE' ? 'Another copy of Boltwork is already connected to the browser.' : e.message };
  });
}

export function stopBrowserHost() {
  server?.close();
  server = null;
  status = { ...status, running: false };
}

// ---------- native messaging host registration ----------

const WIN_REG_KEYS: Record<string, string> = {
  Chrome: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  Edge: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  Brave: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
  Chromium: 'HKCU\\Software\\Chromium\\NativeMessagingHosts',
};

const UNIX_DIRS: Record<string, string> = process.platform === 'darwin' ? {
  Chrome: 'Library/Application Support/Google/Chrome/NativeMessagingHosts',
  Edge: 'Library/Application Support/Microsoft Edge/NativeMessagingHosts',
  Brave: 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts',
  Chromium: 'Library/Application Support/Chromium/NativeMessagingHosts',
} : {
  Chrome: '.config/google-chrome/NativeMessagingHosts',
  Edge: '.config/microsoft-edge/NativeMessagingHosts',
  Brave: '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts',
  Chromium: '.config/chromium/NativeMessagingHosts',
};

/**
 * Writes the host launcher and manifest into `dir` and registers it with each browser.
 * `hostScript` is dist/nmhost.js; it runs under this same Electron binary in Node mode.
 */
export async function registerNativeHost(dir: string, hostScript: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const exe = process.execPath;
  let launcher: string;
  if (process.platform === 'win32') {
    launcher = path.join(dir, 'boltwork-host.bat');
    fs.writeFileSync(launcher, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${hostScript}" %*\r\n`);
  } else {
    launcher = path.join(dir, 'boltwork-host.sh');
    fs.writeFileSync(launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe}" "${hostScript}" "$@"\n`, { mode: 0o755 });
  }
  const manifest = {
    name: HOST_NAME,
    description: 'Boltwork browser extension connector',
    path: launcher,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
  const manifestFile = path.join(dir, `${HOST_NAME}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  const registered: string[] = [];
  if (process.platform === 'win32') {
    for (const [browser, key] of Object.entries(WIN_REG_KEYS)) {
      // The connector's name from before the rename (Strongroom): its manifest no longer exists.
      await new Promise<void>(resolve => execFile('reg', ['delete', `${key}\\${OLD_HOST_NAME}`, '/f'], { windowsHide: true }, () => resolve()));
      const ok = await new Promise<boolean>(resolve =>
        execFile('reg', ['add', `${key}\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f'], { windowsHide: true }, err => resolve(!err)));
      if (ok) registered.push(browser);
    }
  } else {
    for (const [browser, rel] of Object.entries(UNIX_DIRS)) {
      try {
        const d = path.join(os.homedir(), rel);
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, `${HOST_NAME}.json`), JSON.stringify(manifest, null, 2));
        fs.rmSync(path.join(d, `${OLD_HOST_NAME}.json`), { force: true });
        registered.push(browser);
      } catch { /* browser not installed */ }
    }
  }
  status = { ...status, registered };
}
