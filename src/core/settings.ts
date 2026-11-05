import type { GeneratorOptions, Settings } from './types';

export const DEFAULT_GENERATOR: GeneratorOptions = {
  mode: 'characters', length: 20, digits: true, symbols: true, avoidAmbiguous: false,
  wordCount: 4, separator: 'hyphens', capitalize: true, fullWords: true, pinLength: 6,
};


export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  density: 'default',
  zoom: 1,
  startAtLogin: false,
  keepInTray: true,
  startMinimized: false,
  autolockMinutes: 10,
  lockOnSleep: true,
  lockOnScreenLock: true,
  lockOnTrayClose: false,
  clipboardClearSeconds: 90,
  concealPasswords: true,
  showTotpInList: false,
  privacyMode: false,
  blurWhenUnfocused: false,
  screenCaptureProtection: true,
  checkVulnerable: false,
  checkCompromisedSites: false,
  check2faSites: false,
  downloadIcons: false,
  quickAccessShortcut: 'CommandOrControl+Shift+Space',
  showShortcut: 'CommandOrControl+Shift+\\',
  lockShortcut: 'CommandOrControl+Shift+L',
  autoTypeEnabled: true,
  suggestUsername: true,
  defaultUsername: '',
  itemSort: 'title',
  sidebarShowCategories: true,
  sidebarShowTags: true,
  activeCollection: '',
  notifyClipboardCleared: true,
  securityPreset: 'workday',
  generator: DEFAULT_GENERATOR,
  emptyTrashDays: 30,
  historyLimit: 30,
  sshAgentEnabled: false,
  browserIntegration: true,
};

export type PresetName = 'easy' | 'workday' | 'strictest';

/** Security presets: one-click bundles of security settings. */
export const SECURITY_PRESETS: Record<PresetName, { name: string; description: string; values: Partial<Settings> }> = {
  easy: {
    name: 'Easy & Secure',
    description: 'Stays unlocked longer and keeps copied items on the clipboard for a few minutes.',
    values: { autolockMinutes: 60, lockOnSleep: false, lockOnScreenLock: true, clipboardClearSeconds: 300, concealPasswords: true, blurWhenUnfocused: false, screenCaptureProtection: false },
  },
  workday: {
    name: 'Workday Security',
    description: 'Balanced: locks after 10 minutes idle and when your computer sleeps or locks.',
    values: { autolockMinutes: 10, lockOnSleep: true, lockOnScreenLock: true, clipboardClearSeconds: 90, concealPasswords: true, blurWhenUnfocused: false, screenCaptureProtection: true },
  },
  strictest: {
    name: 'Strictest Security',
    description: 'Locks after 1 minute, clears the clipboard after 30 seconds and hides the window from screen capture.',
    values: { autolockMinutes: 1, lockOnSleep: true, lockOnScreenLock: true, lockOnTrayClose: true, clipboardClearSeconds: 30, concealPasswords: true, blurWhenUnfocused: true, screenCaptureProtection: true, privacyMode: false },
  },
};

export function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}), generator: { ...DEFAULT_GENERATOR, ...(saved?.generator ?? {}) } };
}

/** Recomputes which preset (if any) the current settings match. */
export function detectPreset(s: Settings): Settings['securityPreset'] {
  for (const [id, p] of Object.entries(SECURITY_PRESETS)) {
    if (Object.entries(p.values).every(([k, v]) => s[k as keyof Settings] === v)) return id as PresetName;
  }
  return 'custom';
}
