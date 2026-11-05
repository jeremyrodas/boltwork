/** Finds login fields on a page. Heuristics, kept deliberately simple and conservative. */

export type FieldKind = 'username' | 'password' | 'otp';

const hintOf = (el: HTMLInputElement) =>
  [el.autocomplete, el.name, el.id, el.placeholder, el.getAttribute('aria-label') ?? '', el.labels?.[0]?.textContent ?? ''].join(' ').toLowerCase();

export function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}

const usable = (el: HTMLInputElement) => !el.disabled && !el.readOnly && isVisible(el);

export function isPassword(el: unknown): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'password' && usable(el);
}

export function isOtp(el: unknown): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement) || !['text', 'tel', 'number', ''].includes(el.type) || !usable(el)) return false;
  if (el.autocomplete === 'one-time-code') return true;
  const h = hintOf(el);
  return /\b(otp|totp|2fa|mfa|one.?time|verification.?code|security.?code|auth(entication)?.?code|passcode|2-step|two.?factor)\b/.test(h)
    || (/\bcode\b/.test(h) && el.maxLength > 0 && el.maxLength <= 8);
}

export function isUsername(el: unknown): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement) || !['text', 'email', 'tel', ''].includes(el.type) || !usable(el)) return false;
  if (isOtp(el as unknown)) return false;
  const h = hintOf(el);
  if (/search|query|captcha|coupon|promo|address|city|zip|postal/.test(h)) return false;
  return el.type === 'email' || /\b(username|email)\b/.test(el.autocomplete) || /user|e-?mail|login|account|identifier|phone|member/.test(h);
}

function inputsIn(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll('input')];
}

/** The username field that belongs with a password field: the closest plausible text field before it. */
export function usernameFor(pw: HTMLInputElement): HTMLInputElement | null {
  const scope = pw.form ?? document;
  const all = inputsIn(scope);
  const before = all.slice(0, all.indexOf(pw)).reverse();
  return before.find(isUsername)
    ?? before.find(el => ['text', 'email', 'tel', ''].includes(el.type) && usable(el) && !isOtp(el))
    ?? null;
}

export interface LoginFields { username: HTMLInputElement | null; passwords: HTMLInputElement[]; otp: HTMLInputElement | null }

/** Fields to fill, preferring the form that contains `anchor`. */
export function loginFields(anchor?: Element | null): LoginFields {
  const scope: ParentNode = (anchor instanceof HTMLInputElement && anchor.form) || document;
  const all = inputsIn(scope);
  const pws = all.filter(isPassword);
  // Sign-up and change-password forms mark new passwords; only fill current ones (or any, if none are marked).
  const current = pws.filter(p => p.autocomplete !== 'new-password');
  const passwords = (current.length ? current : []).slice(0, 1);
  let username: HTMLInputElement | null = null;
  if (passwords[0]) username = usernameFor(passwords[0]);
  else if (anchor && isUsername(anchor)) username = anchor;
  else username = all.find(isUsername) ?? null;
  const otp = anchor && isOtp(anchor) ? anchor : all.find(isOtp) ?? null;
  return { username, passwords, otp };
}

export function kindOf(el: unknown): FieldKind | null {
  if (isPassword(el)) return el.autocomplete === 'new-password' ? null : 'password';
  if (isOtp(el)) return 'otp';
  if (isUsername(el)) return 'username';
  return null;
}

/** Sets a value the way typing would, so frameworks (React, Vue, Angular) notice. */
export function setValue(el: HTMLInputElement, value: string) {
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** What the user is submitting: a filled password and the username next to it. */
export function captureLogin(scope: ParentNode): { username: string; password: string } | null {
  const pws = inputsIn(scope).filter(el => el.type === 'password' && el.value);
  if (!pws.length) return null;
  // On sign-up / change-password forms the last password field is usually the new one.
  const newOnes = pws.filter(p => p.autocomplete === 'new-password');
  const pw = newOnes.length ? newOnes[newOnes.length - 1] : pws[0];
  return { username: usernameFor(pw)?.value.trim() ?? '', password: pw.value };
}

/** On "enter your email first" pages, the username being submitted. */
export function captureUsernameStep(scope: ParentNode): string {
  const inputs = inputsIn(scope);
  if (inputs.some(el => el.type === 'password' && isVisible(el))) return '';
  return inputs.find(el => isUsername(el) && el.value.trim())?.value.trim() ?? '';
}
