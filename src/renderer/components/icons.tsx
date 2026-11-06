/**
 * Boltwork's icon set: Lucide line icons at one stroke and size, so every icon in the app is drawn
 * the same way. Vault icons come from this set too; custom item icons (images) are content and stay as the user set them.
 */
import {
  Archive, Braces, Car, CreditCard, Database, Dices, FileText, Fingerprint, FolderClosed, Folders, Gift, HeartPulse, House, IdCard,
  Download, Info, Keyboard, KeyRound, Landmark, Layers, Lock, Mail, BadgeCheck, BookUser, Palette, Puzzle, RefreshCw, ScrollText,
  Server, Settings, ShieldCheck, Star, StickyNote, Tag, Terminal, Trash2, Trees, Upload, Wallet, Wifi, Zap, EyeOff,
  ShieldAlert, Repeat2, Unlock, Hourglass, CopyPlus, Smartphone,
  Briefcase, Users, PiggyBank, Plane, Gamepad2, FlaskConical, Globe, GraduationCap, ShoppingBag, Code, Building2, Music, Camera,
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

/**
 * Vault icons, stored by name on the vault. Older vaults stored an emoji; those map to the matching
 * icon here, so nothing needs migrating and the sidebar stays in one icon style.
 */
export const VAULT_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  house: { icon: House, label: 'Home' },
  briefcase: { icon: Briefcase, label: 'Work' },
  users: { icon: Users, label: 'Family' },
  'piggy-bank': { icon: PiggyBank, label: 'Money' },
  plane: { icon: Plane, label: 'Travel' },
  gamepad: { icon: Gamepad2, label: 'Games' },
  flask: { icon: FlaskConical, label: 'Testing' },
  folder: { icon: FolderClosed, label: 'General' },
  lock: { icon: Lock, label: 'Private' },
  globe: { icon: Globe, label: 'Web' },
  health: { icon: HeartPulse, label: 'Health' },
  school: { icon: GraduationCap, label: 'School' },
  shopping: { icon: ShoppingBag, label: 'Shopping' },
  code: { icon: Code, label: 'Development' },
  server: { icon: Server, label: 'Servers' },
  building: { icon: Building2, label: 'Company' },
  music: { icon: Music, label: 'Media' },
  camera: { icon: Camera, label: 'Photos' },
};

const EMOJI_TO_VAULT_ICON: Record<string, string> = {
  '🏠': 'house', '💼': 'briefcase', '👪': 'users', '💰': 'piggy-bank', '✈️': 'plane', '✈': 'plane',
  '🎮': 'gamepad', '🧪': 'flask', '🗂️': 'folder', '🗂': 'folder', '🔒': 'lock', '🌐': 'globe',
  '🏥': 'health', '🎓': 'school',
};

/** The icon name for a vault, accepting old emoji values. Unknown values fall back to a folder. */
export function vaultIconName(icon: string | undefined): string {
  if (icon && VAULT_ICONS[icon]) return icon;
  return (icon && EMOJI_TO_VAULT_ICON[icon]) || 'folder';
}

export function VaultIcon({ icon, size = 16 }: { icon: string | undefined; size?: number }) {
  return <Ico icon={VAULT_ICONS[vaultIconName(icon)].icon} size={size} />;
}

/** Renders a Lucide icon with Boltwork's defaults; decorative unless given a title. */
export function Ico({ icon: I, size = 16, title, ...rest }: { icon: LucideIcon; size?: number; title?: string } & Omit<LucideProps, 'ref'>) {
  return <I size={size} strokeWidth={STROKE} aria-hidden={title ? undefined : true} aria-label={title} focusable={false} {...rest} />;
}

export function CategoryIcon({ category, size = 16 }: { category: Category; size?: number }) {
  return <Ico icon={CATEGORY_ICONS[category] ?? KeyRound} size={size} />;
}
