export type FieldType =
  | 'text'
  | 'concealed'
  | 'url'
  | 'email'
  | 'phone'
  | 'date'
  | 'monthYear'
  | 'totp'
  | 'multiline'
  | 'menu';

/** What a field means, independent of its label. Used by autofill, Watchtower and import/export. */
export type FieldPurpose = 'username' | 'password' | 'totp' | 'expiry' | 'notes';

export interface Field {
  id: string;
  label: string;
  type: FieldType;
  value: string;
  purpose?: FieldPurpose;
  options?: string[];
}

export interface Section {
  id: string;
  title: string;
  fields: Field[];
}

export type Category =
  | 'login'
  | 'password'
  | 'secureNote'
  | 'creditCard'
  | 'identity'
  | 'document'
  | 'bankAccount'
  | 'database'
  | 'driverLicense'
  | 'emailAccount'
  | 'membership'
  | 'outdoorLicense'
  | 'passport'
  | 'rewardProgram'
  | 'router'
  | 'server'
  | 'socialSecurityNumber'
  | 'softwareLicense'
  | 'apiCredential'
  | 'cryptoWallet'
  | 'medicalRecord'
  | 'sshKey';

export interface ItemUrl {
  label: string;
  url: string;
  primary?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  addedAt: number;
}

export type ItemState = 'active' | 'archived' | 'deleted';

export type WatchtowerCheck =
  | 'compromisedWebsite'
  | 'vulnerable'
  | 'weak'
  | 'reused'
  | 'unsecured'
  | 'inactive2fa'
  | 'expiring'
  | 'duplicate';

export interface ItemContent {
  category: Category;
  title: string;
  urls: ItemUrl[];
  fields: Field[];
  sections: Section[];
  notes: string;
  tags: string[];
  icon?: string;
  autosubmit?: boolean;
}

export interface ItemVersion {
  savedAt: number;
  content: ItemContent;
}

export interface Item extends ItemContent {
  id: string;
  vaultId: string;
  favorite: boolean;
  state: ItemState;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  lastUsedAt?: number;
  useCount: number;
  passwordChangedAt?: number;
  attachments: Attachment[];
  history: ItemVersion[];
  watchtowerIgnore: WatchtowerCheck[];
}

export interface Vault {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  createdAt: number;
}

export interface Collection {
  id: string;
  name: string;
  vaultIds: string[];
}

export interface VaultData {
  vaults: Vault[];
  items: Item[];
  collections: Collection[];
  /** SHA-1 (hex, upper) of a password -> times seen in Have I Been Pwned. Encrypted with the vault. */
  pwnedCache: Record<string, number>;
  searchHistory: string[];
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  /** The vault door's metal: logo, app icon and accent color. */
  colorScheme: import('./schemes').ColorScheme;
  density: 'default' | 'comfortable';
  zoom: number;
  startAtLogin: boolean;
  keepInTray: boolean;
  startMinimized: boolean;
  autolockMinutes: number;
  lockOnSleep: boolean;
  lockOnScreenLock: boolean;
  lockOnTrayClose: boolean;
  clipboardClearSeconds: number;
  concealPasswords: boolean;
  showTotpInList: boolean;
  privacyMode: boolean;
  blurWhenUnfocused: boolean;
  screenCaptureProtection: boolean;
  checkVulnerable: boolean;
  checkCompromisedSites: boolean;
  check2faSites: boolean;
  downloadIcons: boolean;
  quickAccessShortcut: string;
  showShortcut: string;
  lockShortcut: string;
  autoTypeEnabled: boolean;
  suggestUsername: boolean;
  defaultUsername: string;
  itemSort: 'title' | 'dateCreated' | 'dateModified' | 'recentlyUsed' | 'frequentlyUsed' | 'passwordStrength';
  sidebarShowCategories: boolean;
  sidebarShowTags: boolean;
  activeCollection: string;
  notifyClipboardCleared: boolean;
  securityPreset: 'easy' | 'workday' | 'strictest' | 'custom';
  generator: GeneratorOptions;
  emptyTrashDays: number;
  historyLimit: number;
  sshAgentEnabled: boolean;
  browserIntegration: boolean;
}

export type GeneratorMode = 'characters' | 'words' | 'pin';

export interface GeneratorOptions {
  mode: GeneratorMode;
  length: number;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
  wordCount: number;
  separator: 'hyphens' | 'spaces' | 'periods' | 'commas' | 'underscores' | 'digits' | 'digitsAndSymbols';
  capitalize: boolean;
  fullWords: boolean;
  pinLength: number;
}

export type StrengthLabel = 'None' | 'Terrible' | 'Weak' | 'Fair' | 'Good' | 'Very Good' | 'Excellent' | 'Fantastic';

export interface Strength {
  label: StrengthLabel;
  /** 0..7 */
  level: number;
  guessesLog10: number;
  warning?: string;
  suggestions: string[];
}

export interface WatchtowerIssue {
  check: WatchtowerCheck;
  itemId: string;
  detail: string;
}

export interface WatchtowerReport {
  score: number;
  scoreLabel: string;
  issues: WatchtowerIssue[];
  counts: Record<WatchtowerCheck, number>;
  checkedAt: number;
  online: { vulnerable: boolean; compromisedWebsite: boolean; twoFactor: boolean };
}
