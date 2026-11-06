/**
 * The desktop half of the Swift sync test. `setup` makes a vault with the desktop code, signs it up on the
 * server and syncs it; `verify` syncs again and prints what the Swift app changed.
 */
import fs from 'node:fs';
import { ready, KDF_FAST_FOR_TESTS } from '../../src/core/crypto';
import { VaultStore } from '../../src/core/store';
import { SyncClient, syncOnce } from '../../src/core/sync';
import { blankContent } from '../../src/core/templates';

const [mode, dir, server] = process.argv.slice(2);
const password = 'sync test password', secretKey = 'SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123', email = 'sync@example.com';

async function main() {
  await ready();
  if (mode === 'setup') {
    fs.rmSync(dir, { recursive: true, force: true });
    const store = await VaultStore.create(dir, password, secretKey, KDF_FAST_FOR_TESTS);
    const c = blankContent('login');
    c.title = 'From desktop';
    c.fields[1].value = 'desktop-password';
    const item = store.saveItem({ ...c, vaultId: store.snapshot().vaults[0].id });
    store.addAttachment(item.id, 'desk.txt', 'text/plain', new TextEncoder().encode('desktop file'));
    const client = new SyncClient(server);
    await client.signup(email, await store.authKey(password, secretKey), store.keyset(), 'desktop');
    store.syncState = { serverUrl: server, email, cursor: 0 };
    fs.writeFileSync(`${dir}/token`, client.token);
    console.log(JSON.stringify(await syncOnce(store, client)));
  } else {
    const store = await VaultStore.unlock(dir, password, secretKey);
    const client = new SyncClient(server, fs.readFileSync(`${dir}/token`, 'utf8'));
    const r = await syncOnce(store, client);
    const items = store.snapshot().items.map(i => ({ title: i.title, notes: i.notes, history: i.history.length, files: i.attachments.map(a => a.name) }));
    const swiftItem = store.snapshot().items.find(i => i.title === 'From iPhone');
    const file = swiftItem ? Buffer.from(store.readAttachment(swiftItem.id, swiftItem.attachments[0].id).bytes).toString() : null;
    console.log(JSON.stringify({ pulled: r.pulled, items, swiftFile: file }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
