import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';
import type { Strength, StrengthLabel } from './types';

let factory: ZxcvbnFactory | null = null;
function engine(): ZxcvbnFactory {
  factory ??= new ZxcvbnFactory({
    translations: en.translations,
    graphs: common.adjacencyGraphs,
    dictionary: { ...common.dictionary, ...en.dictionary },
  });
  return factory;
}

const LABELS: StrengthLabel[] = ['None', 'Terrible', 'Weak', 'Fair', 'Good', 'Very Good', 'Excellent', 'Fantastic'];
// Upper bounds on log10(guesses) for each level after "None".
const THRESHOLDS = [4, 6, 8, 10, 12, 14];

export function rateStrength(password: string): Strength {
  if (!password) return { label: 'None', level: 0, guessesLog10: 0, suggestions: [] };
  const r = engine().check(password.slice(0, 200));
  const g = r.guessesLog10;
  let level = THRESHOLDS.findIndex(t => g < t) + 1;
  if (level === 0) level = 7;
  return {
    label: LABELS[level], level, guessesLog10: Math.round(g * 10) / 10,
    warning: r.feedback.warning || undefined, suggestions: r.feedback.suggestions,
  };
}

/** Watchtower treats Terrible, Weak and Fair as weak. */
export const isWeak = (password: string) => rateStrength(password).level <= 3;
