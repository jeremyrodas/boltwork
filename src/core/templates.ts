import type { Category, Field, FieldPurpose, FieldType, ItemContent } from './types';

type F = [id: string, label: string, type?: FieldType, purpose?: FieldPurpose, options?: string[]];

export interface Template {
  category: Category;
  name: string;
  icon: string;
  hasUrls: boolean;
  fields: F[];
}

const ACCOUNT_TYPES = ['Checking', 'Savings', 'Line of credit', 'ATM', 'Other'];
const CARD_TYPES = ['Visa', 'Mastercard', 'American Express', 'Discover', 'JCB', 'Maestro', 'UnionPay', 'Diners Club', 'Other'];
const DB_TYPES = ['PostgreSQL', 'MySQL', 'SQL Server', 'Oracle', 'SQLite', 'MongoDB', 'Redis', 'Other'];

export const TEMPLATES: Template[] = [
  { category: 'login', name: 'Login', icon: '🔑', hasUrls: true, fields: [
    ['username', 'username', 'text', 'username'],
    ['password', 'password', 'concealed', 'password'],
    ['otp', 'one-time password', 'totp', 'totp'],
  ] },
  { category: 'password', name: 'Password', icon: '🔒', hasUrls: true, fields: [
    ['password', 'password', 'concealed', 'password'],
  ] },
  { category: 'secureNote', name: 'Secure Note', icon: '📝', hasUrls: false, fields: [] },
  { category: 'creditCard', name: 'Credit Card', icon: '💳', hasUrls: true, fields: [
    ['cardholder', 'cardholder name'],
    ['type', 'type', 'menu', undefined, CARD_TYPES],
    ['number', 'number', 'concealed'],
    ['cvv', 'verification number', 'concealed'],
    ['expiry', 'expiry date', 'monthYear', 'expiry'],
    ['validFrom', 'valid from', 'monthYear'],
    ['pin', 'PIN', 'concealed'],
    ['bank', 'issuing bank'],
    ['phone', 'customer service phone', 'phone'],
  ] },
  { category: 'identity', name: 'Identity', icon: '🪪', hasUrls: false, fields: [
    ['firstName', 'first name'], ['initial', 'initial'], ['lastName', 'last name'],
    ['birthDate', 'birth date', 'date'], ['gender', 'gender'], ['occupation', 'occupation'],
    ['company', 'company'], ['department', 'department'], ['jobTitle', 'job title'],
    ['address', 'address', 'multiline'], ['phone', 'phone', 'phone'], ['email', 'email', 'email'],
    ['website', 'website', 'url'], ['username', 'username', 'text', 'username'],
  ] },
  { category: 'document', name: 'Document', icon: '📄', hasUrls: false, fields: [] },
  { category: 'bankAccount', name: 'Bank Account', icon: '🏦', hasUrls: true, fields: [
    ['bankName', 'bank name'], ['owner', 'name on account'],
    ['accountType', 'type', 'menu', undefined, ACCOUNT_TYPES],
    ['routing', 'routing number'], ['accountNo', 'account number', 'concealed'],
    ['swift', 'SWIFT'], ['iban', 'IBAN', 'concealed'], ['pin', 'PIN', 'concealed'],
    ['branchPhone', 'branch phone', 'phone'], ['branchAddress', 'branch address', 'multiline'],
  ] },
  { category: 'database', name: 'Database', icon: '🗄️', hasUrls: false, fields: [
    ['dbType', 'type', 'menu', undefined, DB_TYPES], ['server', 'server'], ['port', 'port'],
    ['database', 'database'], ['username', 'username', 'text', 'username'],
    ['password', 'password', 'concealed', 'password'], ['sid', 'SID'], ['alias', 'alias'],
    ['options', 'connection options'],
  ] },
  { category: 'driverLicense', name: 'Driver License', icon: '🚗', hasUrls: false, fields: [
    ['fullName', 'full name'], ['address', 'address', 'multiline'], ['birthDate', 'date of birth', 'date'],
    ['sex', 'sex'], ['height', 'height'], ['number', 'number'], ['class', 'license class'],
    ['conditions', 'conditions / restrictions'], ['state', 'state'], ['country', 'country'],
    ['expiry', 'expiry date', 'date', 'expiry'],
  ] },
  { category: 'emailAccount', name: 'Email Account', icon: '✉️', hasUrls: false, fields: [
    ['accountType', 'type', 'menu', undefined, ['IMAP', 'POP3', 'Exchange', 'Other']],
    ['username', 'username', 'text', 'username'], ['server', 'server'], ['port', 'port number'],
    ['password', 'password', 'concealed', 'password'],
    ['security', 'security', 'menu', undefined, ['None', 'SSL', 'TLS']],
    ['smtpServer', 'SMTP server'], ['smtpPort', 'SMTP port'], ['smtpUsername', 'SMTP username'],
    ['smtpPassword', 'SMTP password', 'concealed'], ['provider', 'provider'],
    ['providerWebsite', 'provider website', 'url'], ['phone', 'support phone', 'phone'],
  ] },
  { category: 'membership', name: 'Membership', icon: '🎟️', hasUrls: true, fields: [
    ['group', 'group'], ['memberName', 'member name'], ['memberSince', 'member since', 'monthYear'],
    ['expiry', 'expiry date', 'monthYear', 'expiry'], ['memberId', 'member ID'],
    ['pin', 'PIN', 'concealed'], ['phone', 'telephone', 'phone'],
  ] },
  { category: 'outdoorLicense', name: 'Outdoor License', icon: '🎣', hasUrls: false, fields: [
    ['fullName', 'full name'], ['validFrom', 'valid from', 'date'], ['expiry', 'expires', 'date', 'expiry'],
    ['game', 'approved wildlife'], ['quota', 'maximum quota'], ['state', 'state'], ['country', 'country'],
  ] },
  { category: 'passport', name: 'Passport', icon: '🛂', hasUrls: false, fields: [
    ['type', 'type'], ['issuingCountry', 'issuing country'], ['number', 'number'],
    ['fullName', 'full name'], ['sex', 'sex'], ['nationality', 'nationality'],
    ['authority', 'issuing authority'], ['birthDate', 'date of birth', 'date'],
    ['birthPlace', 'place of birth'], ['issued', 'issued on', 'date'],
    ['expiry', 'expiry date', 'date', 'expiry'],
  ] },
  { category: 'rewardProgram', name: 'Reward Program', icon: '🎁', hasUrls: true, fields: [
    ['company', 'company name'], ['memberName', 'member name'], ['memberId', 'member ID'],
    ['pin', 'PIN', 'concealed'], ['memberSince', 'member since', 'monthYear'], ['phone', 'customer service phone', 'phone'],
  ] },
  { category: 'router', name: 'Wireless Router', icon: '📶', hasUrls: false, fields: [
    ['name', 'base station name'], ['password', 'base station password', 'concealed', 'password'],
    ['server', 'server / IP address'], ['networkName', 'network name'],
    ['security', 'wireless security', 'menu', undefined, ['WPA3', 'WPA2', 'WPA', 'WEP', 'None']],
    ['wirelessPassword', 'wireless network password', 'concealed'],
  ] },
  { category: 'server', name: 'Server', icon: '🖥️', hasUrls: true, fields: [
    ['username', 'username', 'text', 'username'], ['password', 'password', 'concealed', 'password'],
    ['adminUrl', 'admin console URL', 'url'], ['adminUser', 'admin console username'],
    ['adminPassword', 'admin console password', 'concealed'], ['host', 'hosting provider'],
    ['hostUrl', 'hosting provider website', 'url'], ['supportUrl', 'support URL', 'url'], ['supportPhone', 'support phone', 'phone'],
  ] },
  { category: 'socialSecurityNumber', name: 'Social Security Number', icon: '🆔', hasUrls: false, fields: [
    ['name', 'name'], ['number', 'number', 'concealed'],
  ] },
  { category: 'softwareLicense', name: 'Software License', icon: '💿', hasUrls: true, fields: [
    ['version', 'version'], ['key', 'license key', 'multiline'], ['licensedTo', 'licensed to'],
    ['email', 'registered email', 'email'], ['company', 'company'], ['publisher', 'publisher'],
    ['downloadUrl', 'download page', 'url'], ['price', 'retail price'], ['supportEmail', 'support email', 'email'],
    ['purchased', 'purchase date', 'date'], ['orderNumber', 'order number'], ['expiry', 'expiry date', 'date', 'expiry'],
  ] },
  { category: 'apiCredential', name: 'API Credential', icon: '🧩', hasUrls: true, fields: [
    ['username', 'username', 'text', 'username'], ['credential', 'credential', 'concealed', 'password'],
    ['type', 'type'], ['filename', 'filename'], ['validFrom', 'valid from', 'date'],
    ['expiry', 'expires', 'date', 'expiry'], ['hostname', 'hostname'],
  ] },
  { category: 'cryptoWallet', name: 'Crypto Wallet', icon: '🪙', hasUrls: true, fields: [
    ['recovery', 'recovery phrase', 'concealed'], ['password', 'password', 'concealed', 'password'],
    ['address', 'wallet address'],
  ] },
  { category: 'sshKey', name: 'SSH Key', icon: '🗝️', hasUrls: false, fields: [
    ['publicKey', 'public key'], ['fingerprint', 'fingerprint'], ['privateKey', 'private key', 'concealed'], ['keyType', 'key type'],
  ] },
  { category: 'medicalRecord', name: 'Medical Record', icon: '🩺', hasUrls: false, fields: [
    ['date', 'date', 'date'], ['location', 'location'], ['professional', 'healthcare professional'],
    ['patient', 'patient'], ['reason', 'reason for visit', 'multiline'],
    ['medication', 'medication'], ['dosage', 'dosage'], ['medNotes', 'medication notes', 'multiline'],
  ] },
];

export const TEMPLATE_BY_CATEGORY: Record<Category, Template> = Object.fromEntries(
  TEMPLATES.map(t => [t.category, t]),
) as Record<Category, Template>;

export function templateFields(category: Category): Field[] {
  return TEMPLATE_BY_CATEGORY[category].fields.map(([id, label, type = 'text', purpose, options]) => ({
    id, label, type, value: '', ...(purpose ? { purpose } : {}), ...(options ? { options } : {}),
  }));
}

export function blankContent(category: Category): ItemContent {
  return { category, title: '', urls: [], fields: templateFields(category), sections: [], notes: '', tags: [] };
}

/** All fields of an item, primary first, then section fields. */
export function allFields(item: Pick<ItemContent, 'fields' | 'sections'>): Field[] {
  return [...item.fields, ...item.sections.flatMap(s => s.fields)];
}

export function fieldByPurpose(item: Pick<ItemContent, 'fields' | 'sections'>, purpose: FieldPurpose): Field | undefined {
  return allFields(item).find(f => f.purpose === purpose && f.value !== '');
}

/** Short line shown under an item's title in lists. */
export function subtitleOf(item: ItemContent): string {
  const f = (id: string) => item.fields.find(x => x.id === id)?.value ?? '';
  switch (item.category) {
    case 'login': case 'database': case 'emailAccount': case 'server': case 'apiCredential':
      return f('username') || item.urls[0]?.url || '';
    case 'creditCard': {
      const n = f('number').replace(/\D/g, '');
      return n ? `${f('type') || 'Card'} •••• ${n.slice(-4)}` : f('cardholder');
    }
    case 'identity': return [f('firstName'), f('lastName')].filter(Boolean).join(' ');
    case 'bankAccount': return f('bankName');
    case 'passport': case 'driverLicense': return f('fullName');
    case 'membership': case 'rewardProgram': return f('memberName');
    case 'secureNote': return item.notes.split('\n')[0].slice(0, 80);
    case 'router': return f('networkName');
    case 'softwareLicense': return f('licensedTo') || f('version');
    case 'socialSecurityNumber': return f('name');
    case 'sshKey': return f('keyType') ? `${f('keyType')} · ${f('fingerprint').slice(7, 23)}…` : '';
    default: return item.urls[0]?.url ?? '';
  }
}
