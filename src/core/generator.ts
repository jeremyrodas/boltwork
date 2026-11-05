import { randomInt } from 'node:crypto';
import { WORDS } from './wordlist';
import type { GeneratorOptions } from './types';
import { DEFAULT_GENERATOR } from './settings';

export { DEFAULT_GENERATOR };


const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/~';
const AMBIGUOUS = /[Il1O0o|`'"]/g;
const SEPARATORS: Record<string, string> = { hyphens: '-', spaces: ' ', periods: '.', commas: ',', underscores: '_' };

const pick = (s: string) => s[randomInt(s.length)];

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function characters(o: GeneratorOptions): string {
  const strip = (s: string) => (o.avoidAmbiguous ? s.replace(AMBIGUOUS, '') : s);
  const sets = [strip(LOWER), strip(UPPER)];
  if (o.digits) sets.push(strip(DIGITS));
  if (o.symbols) sets.push(strip(SYMBOLS));
  const length = Math.max(Math.min(o.length, 100), sets.length);
  // Guarantee one character from each enabled set, fill the rest from all of them.
  const all = sets.join('');
  const chars = sets.map(pick);
  while (chars.length < length) chars.push(pick(all));
  return shuffle(chars).join('');
}

/** Pronounceable chunk (consonant-vowel-consonant) for the "syllables" word style. */
function syllable(): string {
  const c = 'bcdfghjklmnpqrstvwxz', v = 'aeiouy';
  return pick(c) + pick(v) + pick(c);
}

function words(o: GeneratorOptions): string {
  const count = Math.max(3, Math.min(o.wordCount, 15));
  const list = Array.from({ length: count }, () => {
    const w = o.fullWords ? WORDS[randomInt(WORDS.length)] : syllable() + syllable();
    return o.capitalize ? w[0].toUpperCase() + w.slice(1) : w;
  });
  if (o.separator === 'digits' || o.separator === 'digitsAndSymbols') {
    const pool = o.separator === 'digits' ? DIGITS : DIGITS + SYMBOLS;
    return list.reduce((acc, w, i) => (i === 0 ? w : acc + pick(pool) + w), '');
  }
  return list.join(SEPARATORS[o.separator] ?? '-');
}

export function generatePassword(o: GeneratorOptions = DEFAULT_GENERATOR): string {
  switch (o.mode) {
    case 'words': return words(o);
    case 'pin': return Array.from({ length: Math.max(3, Math.min(o.pinLength, 12)) }, () => pick(DIGITS)).join('');
    default: return characters(o);
  }
}

/** Username suggestion: two random words and a number, e.g. "quiet-otter-482". */
export function suggestUsername(): string {
  return `${WORDS[randomInt(WORDS.length)]}-${WORDS[randomInt(WORDS.length)]}-${randomInt(100, 1000)}`.toLowerCase();
}
