/**
 * Import from other password managers and browsers; export to CSV, JSON and encrypted JSON.
 *
 * CSV: header auto-detection covers Chrome, Edge, Brave, Opera, Vivaldi, Firefox, Safari/iCloud,
 * Bitwarden, LastPass, Dashlane, KeePassXC, RoboForm, NordPass, Dropbox Passwords, Proton Pass and generic files.
 * JSON: Bitwarden (unencrypted), Boltwork export (plain or encrypted). ZIP: 1Password .1pux.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { derivePasswordKey, newKdfParams, openJson, sealJson, type KdfParams, type Sealed } from './crypto';
import { importSshKey } from './ssh';
import { blankContent, fieldByPurpose, TEMPLATE_BY_CATEGORY, TEMPLATES } from './templates';
import type { Category, Field, FieldType, Item, ItemContent, Section, Vault } from './types';

export type ImportedItem = ItemContent & { favorite?: boolean; vaultName?: string };

export interface ImportResult {
  source: string;
  items: ImportedItem[];
  skipped: number;
}

// ---------- CSV ----------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const csvEscape = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (rows: string[][]) => rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';

const HEADER_ALIASES: Record<string, string[]> = {
  title: ['title', 'name', 'account', 'item name', 'entry'],
  url: ['url', 'website', 'web site', 'login_uri', 'login uri', 'uri', 'address', 'web address', 'urls', 'login url', 'site'],
  username: ['username', 'user name', 'login', 'login_username', 'login name', 'user', 'email', 'username1', 'login username'],
  password: ['password', 'login_password', 'pass', 'pwd', 'login password'],
  otp: ['totp', 'otp', 'otpauth', 'login_totp', 'otpsecret', 'one-time password', 'onetimepassword', 'otpurl', 'totp secret', 'authenticator key'],
  notes: ['notes', 'note', 'extra', 'comments', 'comment', 'description'],
  tags: ['tags', 'tag', 'folder', 'grouping', 'group', 'category', 'collection', 'vault'],
  favorite: ['favorite', 'fav', 'favourite', 'starred'],
};

function mapHeaders(header: string[]): Record<string, number> {
  const norm = header.map(h => h.trim().toLowerCase());
  const map: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = aliases.map(a => norm.indexOf(a)).find(i => i >= 0);
    if (idx !== undefined) map[key] = idx;
  }
  return map;
}

function loginItem(p: { title?: string; url?: string; username?: string; password?: string; otp?: string; notes?: string; tags?: string[]; favorite?: boolean }): ImportedItem {
  const c = blankContent(p.password || p.username || p.url ? 'login' : 'secureNote') as ImportedItem;
  const set = (purpose: string, v?: string) => { const f = c.fields.find(x => x.purpose === purpose); if (f && v) f.value = v.trim(); };
  set('username', p.username);
  set('password', p.password);
  set('totp', p.otp);
  c.urls = (p.url ?? '').split(/[\n|]/).map(u => u.trim()).filter(u => u && u !== 'http://' && u !== 'http://sn')
    .map((url, i) => ({ label: 'website', url, primary: i === 0 }));
  c.title = (p.title?.trim() || hostLabel(c.urls[0]?.url) || 'Untitled');
  c.notes = p.notes?.trim() ?? '';
  c.tags = p.tags ?? [];
  c.favorite = p.favorite;
  return c;
}

function hostLabel(url?: string): string {
  if (!url) return '';
  try { return new URL(/^\w+:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function importCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { source: 'CSV', items: [], skipped: 0 };
  const h = mapHeaders(rows[0]);
  if (h.password === undefined && h.username === undefined && h.url === undefined) {
    throw new Error('Could not recognize this CSV file. It needs a header row with columns like name, url, username and password.');
  }
  const header = rows[0].map(x => x.toLowerCase());
  const source = header.includes('login_uri') ? 'Bitwarden CSV' : header.includes('grouping') ? 'LastPass CSV'
    : header.includes('httprealm') ? 'Firefox CSV' : header.includes('otpauth') ? 'Safari CSV' : 'CSV';
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const g = (k: string) => (h[k] !== undefined ? r[h[k]] ?? '' : '');
    if (!g('password') && !g('username') && !g('url') && !g('notes') && !g('title')) { skipped++; continue; }
    // LastPass secure notes come through with url "http://sn"
    const tagsRaw = g('tags');
    items.push(loginItem({
      title: g('title'), url: g('url'), username: g('username'), password: g('password'), otp: g('otp'), notes: g('notes'),
      tags: tagsRaw.trim() ? [tagsRaw.replace(/\\/g, '/').trim()] : [],
      favorite: ['1', 'true', 'yes'].includes(g('favorite').toLowerCase()),
    }));
  }
  return { source, items, skipped };
}

// ---------- Bitwarden JSON ----------

interface BwItem {
  type: number; name: string; notes?: string | null; favorite?: boolean; folderId?: string | null;
  login?: { username?: string; password?: string; totp?: string; uris?: { uri: string }[] };
  card?: { cardholderName?: string; brand?: string; number?: string; expMonth?: string; expYear?: string; code?: string };
  identity?: Record<string, string | null>;
  fields?: { name: string; value: string; type: number }[];
}

function bitwarden(json: { items: BwItem[]; folders?: { id: string; name: string }[]; encrypted?: boolean }): ImportResult {
  if (json.encrypted) throw new Error('This Bitwarden export is encrypted. Export it again as unencrypted JSON.');
  const folders = new Map((json.folders ?? []).map(f => [f.id, f.name]));
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const bw of json.items) {
    let c: ImportedItem;
    const tags = bw.folderId && folders.get(bw.folderId) ? [folders.get(bw.folderId)!] : [];
    if (bw.type === 1) {
      c = loginItem({ title: bw.name, username: bw.login?.username, password: bw.login?.password, otp: bw.login?.totp,
        url: (bw.login?.uris ?? []).map(u => u.uri).join('\n'), notes: bw.notes ?? '', tags, favorite: bw.favorite });
    } else if (bw.type === 2) {
      c = { ...blankContent('secureNote'), title: bw.name, notes: bw.notes ?? '', tags, favorite: bw.favorite };
    } else if (bw.type === 3) {
      c = { ...blankContent('creditCard'), title: bw.name, notes: bw.notes ?? '', tags, favorite: bw.favorite };
      const set = (id: string, v?: string | null) => { const f = c.fields.find(x => x.id === id); if (f && v) f.value = v; };
      set('cardholder', bw.card?.cardholderName); set('type', bw.card?.brand); set('number', bw.card?.number); set('cvv', bw.card?.code);
      if (bw.card?.expMonth && bw.card?.expYear) set('expiry', `${bw.card.expYear}-${bw.card.expMonth.padStart(2, '0')}`);
    } else if (bw.type === 4) {
      c = { ...blankContent('identity'), title: bw.name, notes: bw.notes ?? '', tags, favorite: bw.favorite };
      const id = bw.identity ?? {};
      const set = (fid: string, v?: string | null) => { const f = c.fields.find(x => x.id === fid); if (f && v) f.value = v; };
      set('firstName', id.firstName); set('initial', id.middleName); set('lastName', id.lastName); set('company', id.company);
      set('email', id.email); set('phone', id.phone); set('username', id.username);
      set('address', [id.address1, id.address2, id.address3, [id.city, id.state, id.postalCode].filter(Boolean).join(' '), id.country].filter(Boolean).join('\n'));
    } else { skipped++; continue; }
    if (bw.fields?.length) {
      c.sections.push({ id: 'custom', title: 'Custom fields', fields: bw.fields.map((f, i) => ({ id: `bw${i}`, label: f.name, type: f.type === 1 ? 'concealed' : 'text', value: f.value ?? '' })) });
    }
    items.push(c);
  }
  return { source: 'Bitwarden', items, skipped };
}

// ---------- 1Password 1PUX ----------

const ONEPUX_CATEGORIES: Record<string, Category> = {
  '001': 'login', '002': 'creditCard', '003': 'secureNote', '004': 'identity', '005': 'password', '006': 'document',
  '100': 'softwareLicense', '101': 'bankAccount', '102': 'database', '103': 'driverLicense', '104': 'outdoorLicense',
  '105': 'membership', '106': 'passport', '107': 'rewardProgram', '108': 'socialSecurityNumber', '109': 'router',
  '110': 'server', '111': 'emailAccount', '112': 'apiCredential', '113': 'medicalRecord', '114': 'sshKey', '115': 'cryptoWallet',
};

type PuxValue = Record<string, unknown>;

function puxValue(v: PuxValue): { value: string; type: FieldType } {
  const [kind, raw] = Object.entries(v)[0] ?? ['string', ''];
  if (raw === null || raw === undefined) return { value: '', type: 'text' };
  switch (kind) {
    case 'concealed': case 'creditCardNumber': return { value: String(raw), type: 'concealed' };
    case 'totp': return { value: String(raw), type: 'totp' };
    case 'email': return { value: String((raw as { email_address?: string }).email_address ?? raw), type: 'email' };
    case 'url': return { value: String(raw), type: 'url' };
    case 'phone': return { value: String(raw), type: 'phone' };
    case 'date': return { value: new Date(Number(raw) * 1000).toISOString().slice(0, 10), type: 'date' };
    case 'monthYear': { const n = String(raw); return { value: `${n.slice(0, 4)}-${n.slice(4, 6)}`, type: 'monthYear' }; }
    case 'address': {
      const a = raw as Record<string, string>;
      return { value: [a.street, [a.city, a.state, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean).join('\n'), type: 'multiline' };
    }
    default: return { value: typeof raw === 'object' ? JSON.stringify(raw) : String(raw), type: 'text' };
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function onePux(zip: Uint8Array): ImportResult {
  const files = unzipSync(zip);
  const dataFile = files['export.data'];
  if (!dataFile) throw new Error('This .1pux file has no export.data.');
  const exp = JSON.parse(strFromU8(dataFile)) as { accounts: { vaults: { attrs: { name: string }; items: PuxItem[] }[] }[] };
  interface PuxItem {
    state?: string; favIndex?: number; categoryUuid: string;
    overview: { title?: string; url?: string; urls?: { label?: string; url: string }[]; tags?: string[] };
    details: { loginFields?: { value: string; designation?: string; name?: string }[]; notesPlain?: string; password?: string;
      sections?: { title?: string; fields?: { title?: string; id?: string; value: PuxValue }[] }[] };
  }
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const account of exp.accounts) for (const vault of account.vaults) for (const p of vault.items) {
    const category = ONEPUX_CATEGORIES[p.categoryUuid];
    if (!category) { skipped++; continue; }
    const c = blankContent(category) as ImportedItem;
    c.title = p.overview.title ?? 'Untitled';
    c.tags = p.overview.tags ?? [];
    c.notes = p.details.notesPlain ?? '';
    c.favorite = !!p.favIndex;
    c.vaultName = vault.attrs.name;
    const urls = p.overview.urls?.length ? p.overview.urls : p.overview.url ? [{ url: p.overview.url }] : [];
    c.urls = urls.map((u, i) => ({ label: u.label || 'website', url: u.url, primary: i === 0 }));
    const setPurpose = (purpose: string, v?: string) => { const f = c.fields.find(x => x.purpose === purpose); if (f && v) f.value = v; };
    for (const lf of p.details.loginFields ?? []) {
      if (lf.designation === 'username') setPurpose('username', lf.value);
      if (lf.designation === 'password') setPurpose('password', lf.value);
    }
    if (p.details.password) setPurpose('password', p.details.password);
    for (const sec of p.details.sections ?? []) {
      // 1Password records passphrases it used when you downloaded the key as a file. They don't protect the key itself, so leave them out.
      if (category === 'sshKey' && /exported passphrase/i.test(sec.title ?? '')) continue;
      const extra: Field[] = [];
      for (const [i, f] of (sec.fields ?? []).entries()) {
        const ssh = (f.value as { sshKey?: { privateKey?: string } }).sshKey;
        if (ssh?.privateKey && category === 'sshKey') {
          try {
            const info = importSshKey(ssh.privateKey, undefined, c.title);
            for (const k of ['privateKey', 'publicKey', 'fingerprint', 'keyType'] as const) c.fields.find(x => x.id === k)!.value = info[k];
          } catch { extra.push({ id: `pux${i}`, label: f.title || 'private key', type: 'concealed', value: ssh.privateKey }); }
          continue;
        }
        const { value, type } = puxValue(f.value);
        if (!value) continue;
        const target = type === 'totp' ? c.fields.find(x => x.type === 'totp' && !x.value)
          : c.fields.find(x => !x.value && (norm(x.label) === norm(f.title ?? '') || norm(x.id) === norm(f.id ?? '')));
        if (target) target.value = value;
        else extra.push({ id: `pux${i}`, label: f.title || 'field', type, value });
      }
      if (extra.length) c.sections.push({ id: `s${c.sections.length}`, title: sec.title ?? '', fields: extra });
    }
    if (p.state === 'archived') c.tags.push('Archived in 1Password');
    items.push(c);
  }
  return { source: '1Password (1PUX)', items, skipped };
}

// ---------- Boltwork export ----------

export interface BoltworkExport {
  format: 'strongroom-export';
  version: 1;
  exportedAt: number;
  vaults: { name: string; description: string }[];
  items: (ImportedItem & { vaultName: string })[];
}

interface EncryptedExport {
  format: 'strongroom-export-encrypted';
  version: 1;
  kdf: KdfParams;
  data: Sealed;
}

const AAD_EXPORT = 'strongroom:export:v1';

export function buildExport(vaults: Vault[], items: Item[]): BoltworkExport {
  const vaultName = new Map(vaults.map(v => [v.id, v.name]));
  return {
    format: 'strongroom-export', version: 1, exportedAt: Date.now(),
    vaults: vaults.map(v => ({ name: v.name, description: v.description })),
    items: items.filter(i => i.state !== 'deleted').map(i => ({
      category: i.category, title: i.title, urls: i.urls, fields: i.fields, sections: i.sections, notes: i.notes,
      tags: i.tags, icon: i.icon, favorite: i.favorite, vaultName: vaultName.get(i.vaultId) ?? 'Imported',
    })),
  };
}

export async function encryptExport(exp: BoltworkExport, password: string): Promise<EncryptedExport> {
  const kdf = newKdfParams();
  return { format: 'strongroom-export-encrypted', version: 1, kdf, data: sealJson(await derivePasswordKey(password, kdf), exp, AAD_EXPORT) };
}

export function exportCsv(vaults: Vault[], items: Item[]): string {
  const vaultName = new Map(vaults.map(v => [v.id, v.name]));
  const rows = [['title', 'url', 'username', 'password', 'otp', 'notes', 'category', 'tags', 'favorite', 'vault']];
  for (const i of items.filter(x => x.state !== 'deleted')) {
    rows.push([
      i.title, i.urls.map(u => u.url).join('\n'), fieldByPurpose(i, 'username')?.value ?? '', fieldByPurpose(i, 'password')?.value ?? '',
      fieldByPurpose(i, 'totp')?.value ?? '', i.notes, TEMPLATE_BY_CATEGORY[i.category].name, i.tags.join(';'), i.favorite ? '1' : '',
      vaultName.get(i.vaultId) ?? '',
    ]);
  }
  return toCsv(rows);
}

// ---------- entry point ----------

export class NeedsPasswordError extends Error {
  constructor() { super('This export is encrypted. Enter its password.'); }
}

/** Detects the file type and imports it. `password` is only needed for encrypted Boltwork exports. */
export async function importFile(fileName: string, bytes: Uint8Array, password?: string): Promise<ImportResult> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.1pux') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return onePux(bytes);
  const text = new TextDecoder().decode(bytes);
  if (lower.endsWith('.json') || text.trimStart().startsWith('{')) {
    const json = JSON.parse(text);
    if (json.format === 'strongroom-export-encrypted') {
      if (!password) throw new NeedsPasswordError();
      const key = await derivePasswordKey(password, json.kdf);
      let inner: BoltworkExport;
      try { inner = openJson<BoltworkExport>(key, json.data, AAD_EXPORT); }
      catch { throw new Error('Incorrect export password.'); }
      return { source: 'Boltwork (encrypted)', items: inner.items, skipped: 0 };
    }
    if (json.format === 'strongroom-export') return { source: 'Boltwork', items: json.items, skipped: 0 };
    if (Array.isArray(json.items)) return bitwarden(json);
    throw new Error('Unrecognized JSON export.');
  }
  return importCsv(text);
}


export const ALL_TEMPLATES = TEMPLATES;
export type { Section };
