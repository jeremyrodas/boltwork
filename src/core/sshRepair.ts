/** Tidies SSH Key items: reads keys an older import couldn't, orders fields like a new item, and drops 1Password's exported-passphrase lists. */
import { importSshKey } from './ssh';
import type { VaultStore } from './store';
import { blankContent } from './templates';
import type { Field, Item } from './types';

const STANDARD = ['publicKey', 'fingerprint', 'privateKey', 'keyType'] as const;
const isPassphraseList = (title: string) => /exported passphrase/i.test(title);

function repaired(item: Item): Item | null {
  const fields = structuredClone(item.fields);
  let sections = structuredClone(item.sections).filter(s => !isPassphraseList(s.title));
  const get = (id: string) => fields.find(f => f.id === id);
  if (!get('privateKey')?.value) {
    // An older import left the raw key in an extra field when it couldn't read it.
    for (const s of sections) {
      const raw = s.fields.find(f => /private key/i.test(f.label) && /PRIVATE KEY-----/.test(f.value));
      if (!raw) continue;
      try {
        const info = importSshKey(raw.value, undefined, item.title);
        for (const id of STANDARD) {
          const f = get(id);
          if (f) f.value = info[id];
          else fields.push({ ...blankContent('sshKey').fields.find(t => t.id === id)!, value: info[id] });
        }
        s.fields = s.fields.filter(f => f !== raw);
      } catch { /* leave it as it is */ }
      break;
    }
  }
  sections = sections.filter(s => s.fields.length);
  const ordered = [...STANDARD.map(id => fields.find(f => f.id === id)).filter((f): f is Field => !!f),
    ...fields.filter(f => !(STANDARD as readonly string[]).includes(f.id))];
  const next = { ...item, fields: ordered, sections };
  return JSON.stringify([next.fields, next.sections]) === JSON.stringify([item.fields, item.sections]) ? null : next;
}

/** Returns how many items changed. Earlier versions stay in item history. */
export function repairSshItems(store: VaultStore): number {
  let n = 0;
  for (const item of store.snapshot().items) {
    if (item.category !== 'sshKey' || item.state === 'deleted') continue;
    const next = repaired(item);
    if (!next) continue;
    store.saveItem({ ...next, id: item.id, vaultId: item.vaultId });
    n++;
  }
  return n;
}
