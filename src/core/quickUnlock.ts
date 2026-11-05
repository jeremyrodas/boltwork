/**
 * Quick unlock: open the vault with Windows Hello or a short PIN instead of the full account password.
 *
 * Turning it on (which needs the account password) stores a copy of the master key on this device, sealed with a
 * "quick key". The quick key always mixes in a random device secret that the OS protects for this user
 * (DPAPI on Windows), so the stored copy is useless on another computer or account:
 *
 *   Windows Hello: quick key = BLAKE2b(key = device secret, Hello signature of a random challenge).
 *                  Hello keys live in the TPM and sign only after face, fingerprint or Windows PIN;
 *                  RSA PKCS#1 v1.5 signatures are deterministic, so the same challenge gives the same key.
 *   Strongroom PIN: quick key = BLAKE2b(key = device secret, Argon2id(PIN)). Five wrong PINs turn quick unlock off.
 *
 * Either way the full password is required again after 14 days, and the master key never changes,
 * so changing the account password doesn't break quick unlock.
 */
import fs from 'node:fs';
import { derivePasswordKey, keyedHash, newKdfParams, openJson, randomKey, sealJson, wipe, type KdfParams, type Sealed } from './crypto';

export type QuickMethod = 'pin' | 'hello';

export const MAX_PIN_FAILURES = 5;
export const PASSWORD_EVERY_MS = 14 * 86400_000;
const PIN_KDF = { ops: 3, mem: 64 * 1024 * 1024 };
const aad = (m: QuickMethod) => `strongroom:quick-unlock:v1:${m}`;

interface QuickFile {
  version: 1;
  method: QuickMethod;
  /** The vault this belongs to. */
  accountId: string;
  createdAt: number;
  /** Last time the full password was used; quick unlock stops working 14 days later. */
  passwordAt: number;
  failures: number;
  /** Device secret, encrypted by the OS for this user (base64). */
  deviceSecret: string;
  pinKdf?: KdfParams;
  /** Random challenge Windows Hello signs (base64). */
  challenge?: string;
  wrapped: Sealed;
}

/** OS-level protection for the device secret (Electron safeStorage in the app). */
export interface DeviceProtector {
  encrypt(data: Uint8Array): string;
  decrypt(data: string): Uint8Array;
}

/** Asks Windows Hello to sign `challenge` (creating the Hello key first when `create` is set). */
export type HelloSigner = (challenge: Uint8Array, create: boolean) => Promise<Uint8Array>;

export class QuickUnlockError extends Error {
  constructor(message: string, public disabled = false) { super(message); }
}

export interface QuickStatus {
  method: QuickMethod | null;
  /** Set when quick unlock exists but the password is needed this time. */
  needsPassword?: string;
}

export class QuickUnlock {
  constructor(private file: string, private protector: DeviceProtector, private now = () => Date.now()) {}

  private read(): QuickFile | null {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) as QuickFile; } catch { return null; }
  }
  private write(f: QuickFile) { fs.writeFileSync(this.file, JSON.stringify(f), { mode: 0o600 }); }

  status(accountId: string): QuickStatus {
    const f = this.read();
    if (!f || f.accountId !== accountId) return { method: null };
    if (this.now() - f.passwordAt > PASSWORD_EVERY_MS) return { method: f.method, needsPassword: 'It’s been 14 days. Enter your account password to keep using quick unlock.' };
    return { method: f.method };
  }

  disable() { try { fs.unlinkSync(this.file); } catch { /* already off */ } }

  /** Call after every successful password unlock: restarts the 14-day window. */
  notePasswordUnlock(accountId: string) {
    const f = this.read();
    if (!f) return;
    if (f.accountId !== accountId) { this.disable(); return; }
    f.passwordAt = this.now();
    f.failures = 0;
    this.write(f);
  }

  private quickKey(deviceSecret: Uint8Array, material: Uint8Array): Uint8Array {
    return keyedHash(deviceSecret, material);
  }

  async enablePin(masterKey: Uint8Array, accountId: string, pin: string): Promise<void> {
    if (!/^\S{4,32}$/.test(pin)) throw new QuickUnlockError('Use 4 to 32 characters, without spaces, for your PIN.');
    const device = randomKey();
    const pinKdf = newKdfParams(PIN_KDF);
    const stretched = await derivePasswordKey(pin, pinKdf);
    const key = this.quickKey(device, stretched);
    this.write({
      version: 1, method: 'pin', accountId, createdAt: this.now(), passwordAt: this.now(), failures: 0,
      deviceSecret: this.protector.encrypt(device), pinKdf, wrapped: sealJson(key, Array.from(masterKey), aad('pin')),
    });
    wipe(stretched); wipe(key); wipe(device);
  }

  async enableHello(masterKey: Uint8Array, accountId: string, sign: HelloSigner): Promise<void> {
    const device = randomKey();
    const challenge = randomKey();
    const signature = await sign(challenge, true);
    // Hello signatures must be repeatable, or this device could never unlock again. Check before relying on it.
    const again = await sign(challenge, false);
    if (Buffer.compare(Buffer.from(signature), Buffer.from(again)) !== 0) throw new QuickUnlockError('Windows Hello on this computer can’t be used to protect the vault.');
    const key = this.quickKey(device, signature);
    this.write({
      version: 1, method: 'hello', accountId, createdAt: this.now(), passwordAt: this.now(), failures: 0,
      deviceSecret: this.protector.encrypt(device), challenge: Buffer.from(challenge).toString('base64'),
      wrapped: sealJson(key, Array.from(masterKey), aad('hello')),
    });
    wipe(key); wipe(device);
  }

  /** Returns the master key. */
  async unlockWithPin(accountId: string, pin: string): Promise<Uint8Array> {
    const f = this.usable(accountId, 'pin');
    const device = this.protector.decrypt(f.deviceSecret);
    const stretched = await derivePasswordKey(pin, f.pinKdf!);
    const key = this.quickKey(device, stretched);
    try {
      const master = Uint8Array.from(openJson<number[]>(key, f.wrapped, aad('pin')));
      if (f.failures) { f.failures = 0; this.write(f); }
      return master;
    } catch {
      f.failures += 1;
      if (f.failures >= MAX_PIN_FAILURES) {
        this.disable();
        throw new QuickUnlockError('Too many wrong PINs. Quick unlock is off; enter your account password.', true);
      }
      this.write(f);
      const left = MAX_PIN_FAILURES - f.failures;
      throw new QuickUnlockError(`Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before your password is needed.`);
    } finally { wipe(stretched); wipe(key); wipe(device); }
  }

  async unlockWithHello(accountId: string, sign: HelloSigner): Promise<Uint8Array> {
    const f = this.usable(accountId, 'hello');
    const device = this.protector.decrypt(f.deviceSecret);
    const signature = await sign(Buffer.from(f.challenge!, 'base64'), false);
    const key = this.quickKey(device, signature);
    try {
      return Uint8Array.from(openJson<number[]>(key, f.wrapped, aad('hello')));
    } catch {
      throw new QuickUnlockError('Windows Hello didn’t match this vault. Enter your account password, then turn Windows Hello on again.');
    } finally { wipe(key); wipe(device); }
  }

  private usable(accountId: string, method: QuickMethod): QuickFile {
    const f = this.read();
    const st = this.status(accountId);
    if (!f || st.method !== method) throw new QuickUnlockError('Quick unlock isn’t set up. Enter your account password.', true);
    if (st.needsPassword) throw new QuickUnlockError(st.needsPassword, true);
    return f;
  }
}
