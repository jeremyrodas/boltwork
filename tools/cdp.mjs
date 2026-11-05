// Minimal Chrome DevTools Protocol driver for testing the running app.
// usage: node tools/cdp.mjs <port> <urlHashFilter> <js-expression | @screenshot:out.png>
import fs from 'node:fs';
const [port, filter, ...rest] = process.argv.slice(2);
const cmd = rest.join(' ');
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = targets.find(x => x.type === 'page' && x.url.includes(filter));
if (!t) { console.error('targets:', targets.map(x => x.url)); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise(r => (ws.onopen = r));
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
if (cmd.startsWith('@screenshot:')) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(cmd.slice(12), Buffer.from(r.result.data, 'base64'));
  console.log('saved', cmd.slice(12));
} else {
  const r = await send('Runtime.evaluate', { expression: cmd, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result.result?.value ?? r.result.exceptionDetails?.exception?.description ?? r.result, null, 1));
}
ws.close();
