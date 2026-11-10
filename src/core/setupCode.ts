/**
 * A setup code: what a signed-in device shows (as a QR code) so a new device can join the same account by
 * scanning it. It carries the Secret Key and, when the vault syncs, the server's address and the email. Never the
 * account password, which the person still types on the new device. Every Boltwork app reads and writes the same text.
 */
export interface SetupCode {
  /** Missing when the vault doesn't sync: the code then holds only the Secret Key. */
  server?: string;
  /** Another address for the same server, if this device has one. */
  backup?: string;
  email?: string;
  secretKey: string;
}

export const SETUP_CODE_PREFIX = 'boltwork-setup:';
const VERSION = 1;

export function setupCodeText(code: SetupCode): string {
  return SETUP_CODE_PREFIX + JSON.stringify({ v: VERSION, ...(code.server ? { server: code.server } : {}), ...(code.backup ? { backup: code.backup } : {}), ...(code.email ? { email: code.email } : {}), secretKey: code.secretKey });
}

/** Throws if `text` isn't a setup code this version can read. */
export function parseSetupCode(text: string): SetupCode {
  const trimmed = text.trim();
  if (!trimmed.startsWith(SETUP_CODE_PREFIX)) throw new Error('That isn’t a Boltwork setup code.');
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(trimmed.slice(SETUP_CODE_PREFIX.length)); } catch { throw new Error('That isn’t a Boltwork setup code.'); }
  if (typeof raw !== 'object' || raw === null) throw new Error('That isn’t a Boltwork setup code.');
  if (raw.v !== VERSION) throw new Error('This setup code needs a newer version of Boltwork.');
  const { server, backup, email, secretKey } = raw;
  if (typeof secretKey !== 'string' || !secretKey) throw new Error('That isn’t a Boltwork setup code.');
  const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  return { ...(str(server) ? { server: str(server) } : {}), ...(str(backup) ? { backup: str(backup) } : {}), ...(str(email) ? { email: str(email) } : {}), secretKey };
}
