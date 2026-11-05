/** Supported sources shown in the import screen. */
export const IMPORT_SOURCES = [
  { id: '1password', name: '1Password', hint: 'Export a .1pux file from 1Password 8 (File > Export).' },
  { id: 'bitwarden', name: 'Bitwarden', hint: 'Export as JSON (unencrypted) or CSV.' },
  { id: 'chrome', name: 'Chrome / Edge / Brave / Opera / Vivaldi', hint: 'Settings > Passwords > Export passwords (CSV).' },
  { id: 'firefox', name: 'Firefox', hint: 'about:logins > ⋯ > Export logins (CSV).' },
  { id: 'safari', name: 'Safari / iCloud Keychain', hint: 'File > Export > Passwords (CSV).' },
  { id: 'lastpass', name: 'LastPass', hint: 'Advanced options > Export (CSV).' },
  { id: 'dashlane', name: 'Dashlane', hint: 'Export credentials as CSV.' },
  { id: 'keepass', name: 'KeePass / KeePassXC', hint: 'Database > Export to CSV.' },
  { id: 'other', name: 'Other (CSV)', hint: 'Any CSV with name, url, username, password columns.' },
  { id: 'strongroom', name: 'Strongroom backup', hint: 'A .json export from Strongroom, encrypted or not.' },
];
