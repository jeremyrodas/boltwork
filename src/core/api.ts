/** The contract between the renderer (UI) and the main process (vault, OS integration). */
import type {
  Collection, GeneratorOptions, Item, ItemContent, Settings, Strength, Vault, VaultData, WatchtowerCheck, WatchtowerReport,
} from './types';
import type { PasskeyDecision, PasskeyPrompt } from './browserBridge';
import type { PresetName } from './settings';
import type { SshKeyInfo, SshKeyType } from './ssh';

export interface BrowserStatus {
  enabled: boolean;
  running: boolean;
  error?: string;
  /** Browsers the native messaging host is registered with. */
  registered: string[];
  extensionId: string;
  extensionFolder: string;
  pairings: { id: string; name: string; createdAt: number; lastUsedAt: number }[];
}

export interface SyncStatus {
  configured: boolean;
  serverUrl?: string;
  email?: string;
  lastSyncAt?: number;
  syncing: boolean;
  error?: string;
  /** The server rejected our session; the user must sign in again. */
  signedOut?: boolean;
}

export interface SshAgentStatus {
  enabled: boolean;
  running: boolean;
  socket: string;
  error?: string;
  /** True when another agent (e.g. the Windows OpenSSH service) already owns the socket. */
  inUse?: boolean;
  keys: { title: string; fingerprint: string; keyType: string }[];
}

export interface AppState {
  hasVault: boolean;
  locked: boolean;
  /** True on a device that has never stored this vault's Secret Key. */
  needsSecretKey: boolean;
  platform: NodeJS.Platform;
  version: string;
  window: 'main' | 'quickAccess' | 'largeType' | 'passkeyPrompt';
  /** Quick unlock offered on the lock screen, if set up on this device. */
  quickUnlock: { method: 'pin' | 'hello' | null; needsPassword?: string };
}

export interface QuickUnlockStatus {
  method: 'pin' | 'hello' | null;
  needsPassword?: string;
  helloAvailable: boolean;
}

export interface ImportPreview {
  fileName: string;
  needsPassword: boolean;
  source?: string;
  count?: number;
  /** Items not already in Boltwork; only these are imported. */
  newCount?: number;
  skipped?: number;
  vaultNames?: string[];
}

export type QuickAccessAction = 'autoType' | 'username' | 'password' | 'otp' | 'open';

export interface Api {
  getState(): AppState;
  createVault(password: string): { secretKey: string };
  unlock(password: string, secretKey?: string): void;
  /** Unlocks with Windows Hello, or with the Boltwork PIN when `pin` is given. */
  unlockQuick(pin?: string): void;
  quickUnlockStatus(): QuickUnlockStatus;
  /** Turns on quick unlock; needs the account password. */
  quickUnlockEnable(method: 'pin' | 'hello', password: string, pin?: string): QuickUnlockStatus;
  quickUnlockDisable(): QuickUnlockStatus;
  lock(): void;
  getData(): VaultData;

  saveItem(input: ItemContent & { id?: string; vaultId: string }): Item;
  duplicateItem(id: string): Item;
  restoreVersion(id: string, index: number): Item;
  setFavorite(id: string, favorite: boolean): void;
  archive(id: string): void;
  trash(id: string): void;
  restore(id: string): void;
  purge(id: string): void;
  emptyTrash(): number;
  move(id: string, vaultId: string): void;
  setWatchtowerIgnore(id: string, ignore: WatchtowerCheck[]): void;
  markUsed(id: string): void;

  saveVault(v: Partial<Vault> & { name: string }): Vault;
  deleteVault(id: string, moveItemsTo?: string): void;
  saveCollection(c: Partial<Collection> & { name: string; vaultIds: string[] }): Collection;
  deleteCollection(id: string): void;
  renameTag(from: string, to: string): void;

  addAttachments(itemId: string): number;
  saveAttachment(itemId: string, attachmentId: string): boolean;
  removeAttachment(itemId: string, attachmentId: string): void;
  removePasskey(itemId: string, credentialId: string): void;

  generate(options: GeneratorOptions): { password: string; strength: Strength };
  rateStrength(password: string): Strength;
  suggestUsername(): string;
  totp(value: string): { code: string; remaining: number; period: number } | { error: string };
  watchtower(): WatchtowerReport;

  copy(text: string, secret: boolean): void;
  getSettings(): Settings;
  setSettings(patch: Partial<Settings>): Settings;
  applyPreset(name: PresetName): Settings;

  importChoose(): ImportPreview | null;
  importPreview(password: string): ImportPreview;
  importCommit(vaultId: string | 'byName'): number;
  exportData(format: 'csv' | 'json' | 'encrypted', accountPassword: string, exportPassword?: string): string | null;
  /** Saves the Emergency Kit PDF (it contains the Secret Key); needs the account password. */
  emergencyKit(password: string): string | null;
  changePassword(oldPassword: string, newPassword: string): void;
  revealSecretKey(accountPassword: string): string;

  largeType(text: string): void;
  getLargeTypeText(): string;
  /** The passkey prompt window: what it's asking, the user's answer, and its content height. */
  getPasskeyPrompt(): PasskeyPrompt | null;
  answerPasskeyPrompt(decision: PasskeyDecision): void;
  fitPasskeyPrompt(height: number): void;
  openUrl(url: string): void;
  scanQrFromScreen(): string | null;
  addSearchHistory(q: string): void;
  clearSearchHistory(): void;

  sshGenerate(type: SshKeyType, comment: string): SshKeyInfo;
  sshImport(text: string, passphrase?: string, comment?: string): SshKeyInfo;
  sshExport(itemId: string, which: 'private' | 'public'): string | null;
  sshAgentStatus(): SshAgentStatus;
  browserStatus(): BrowserStatus;
  syncStatus(): SyncStatus;
  syncCheckServer(url: string): { serverUrl: string; signups: string };
  /** Turns on sync for the unlocked vault (creates the server account). */
  syncSetup(url: string, email: string, password: string): SyncStatus;
  /** First run on a new device: sign in to a server and download the vault. */
  syncSignIn(url: string, email: string, password: string, secretKey: string): void;
  syncNow(): SyncStatus;
  syncReconnect(password: string): SyncStatus;
  syncDisconnect(deleteAccount: boolean): void;
  browserRevoke(id: string): void;
  browserShowExtensionFolder(): void;
  /** Windows passkey provider (Windows 11 with the November 2025 update or later). */
  passkeyProviderStatus(): { installed: boolean; state?: 'enabled' | 'disabled' | 'not-registered'; serving: boolean; error?: string };
  passkeyProviderRegister(): { installed: boolean; state?: 'enabled' | 'disabled' | 'not-registered'; serving: boolean; error?: string };
  passkeyProviderUnregister(): { installed: boolean; state?: 'enabled' | 'disabled' | 'not-registered'; serving: boolean; error?: string };
  openWindowsPasskeySettings(): void;

  quickAccessAction(itemId: string, action: QuickAccessAction): void;
  hideQuickAccess(): void;
  showMain(route?: string): void;
}

export type ApiMethod = keyof Api;

/** Events pushed from main to renderers. */
export interface ApiEvents {
  state: AppState;
  data: VaultData;
  settings: Settings;
  navigate: string;
  /** A Watchtower check finished (whichever window started it). */
  watchtowerUpdated: WatchtowerReport;
  /** Password lookups done so far in the running check; null when it's finished. */
  watchtowerProgress: { done: number; total: number; phase: 'strength' | 'breaches' } | null;
  quickAccessShown: null;
}

/** Shape of `window.boltwork` (exposed by the preload script). */
export interface Bridge {
  call<M extends ApiMethod>(method: M, ...args: Parameters<Api[M]>): Promise<Awaited<ReturnType<Api[M]>>>;
  on<E extends keyof ApiEvents>(event: E, cb: (payload: ApiEvents[E]) => void): () => void;
}
