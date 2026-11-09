/** Opens a vault written by the Swift tests with the desktop app's own code and prints what it finds. */
import { VaultStore } from '../../src/core/store';
import { ready } from '../../src/core/crypto';

async function main() {
  await ready();
  const store = await VaultStore.unlock(process.argv[2], 'swift password', 'SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123');
  const data = store.snapshot();
  const item = data.items[0];
  const att = store.readAttachment(item.id, item.attachments[0].id);
  console.log(JSON.stringify({
    vaults: data.vaults.map(v => v.name), title: item.title, password: item.fields.find(f => f.purpose === 'password')?.value,
    notes: item.notes, history: item.history.length, attachment: Buffer.from(att.bytes).toString(),
  }));
}
main();
