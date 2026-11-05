/**
 * Strongroom's icon set: Lucide line icons at one stroke and size, so every icon in the app is drawn
 * the same way. User-chosen vault and item icons (emoji or images) are content and stay as the user set them.
 */
import {
  Archive, Braces, Car, CreditCard, Database, Dices, FileText, Fingerprint, FolderClosed, Folders, Gift, HeartPulse, House, IdCard,
  Download, Info, Keyboard, KeyRound, Landmark, Layers, Lock, Mail, BadgeCheck, BookUser, Palette, Puzzle, RefreshCw, ScrollText,
  Server, Settings, ShieldCheck, Star, StickyNote, Tag, Terminal, Trash2, Trees, Upload, Wallet, Wifi, Zap, EyeOff,
  ShieldAlert, Repeat2, Unlock, Hourglass, CopyPlus, Smartphone,
  type LucideIcon, type LucideProps,
} from 'lucide-react';
import type { Category } from '../../core/types';

export const STROKE = 1.75;

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  login: KeyRound, password: Lock, secureNote: StickyNote, creditCard: CreditCard, identity: IdCard, document: FileText,
  bankAccount: Landmark, database: Database, driverLicense: Car, emailAccount: Mail, membership: BadgeCheck, outdoorLicense: Trees,
  passport: BookUser, rewardProgram: Gift, socialSecurityNumber: Fingerprint, router: Wifi, server: Server, softwareLicense: ScrollText,
  apiCredential: Braces, cryptoWallet: Wallet, medicalRecord: HeartPulse, sshKey: Terminal,
};

export const NAV_ICONS = {
  home: House, all: Layers, favorites: Star, watchtower: ShieldCheck, archive: Archive, deleted: Trash2, generator: Dices,
  settings: Settings, lock: Lock, tag: Tag, vault: FolderClosed,
} satisfies Record<string, LucideIcon>;

export const SETTINGS_ICONS: Record<string, LucideIcon> = {
  general: Settings, appearance: Palette, security: Lock, sync: RefreshCw, privacy: EyeOff, quickaccess: Zap, browser: Puzzle,
  ssh: Terminal, vaults: Folders, import: Download, export: Upload, shortcuts: Keyboard, about: Info,
};

export const WATCHTOWER_ICONS: Record<string, LucideIcon> = {
  compromisedWebsite: ShieldAlert, vulnerable: ShieldAlert, reused: Repeat2, weak: Lock, unsecured: Unlock, inactive2fa: Smartphone,
  expiring: Hourglass, duplicate: CopyPlus,
};

/** Renders a Lucide icon with Strongroom's defaults; decorative unless given a title. */
export function Ico({ icon: I, size = 16, title, ...rest }: { icon: LucideIcon; size?: number; title?: string } & Omit<LucideProps, 'ref'>) {
  return <I size={size} strokeWidth={STROKE} aria-hidden={title ? undefined : true} aria-label={title} focusable={false} {...rest} />;
}

export function CategoryIcon({ category, size = 16 }: { category: Category; size?: number }) {
  return <Ico icon={CATEGORY_ICONS[category] ?? KeyRound} size={size} />;
}
