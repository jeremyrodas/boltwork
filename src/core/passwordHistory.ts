/**
 * Earlier passwords of an item, worked out from its saved versions (item history), newest first.
 * Each comes with when it was replaced. A password used again later is listed once.
 */
import { fieldByPurpose } from './templates';
import type { Item } from './types';

export interface PreviousPassword { value: string; replacedAt: number }

export function previousPasswords(item: Pick<Item, 'fields' | 'sections' | 'updatedAt' | 'passwordChangedAt' | 'history'>): PreviousPassword[] {
  const versions = [
    { at: item.passwordChangedAt ?? item.updatedAt, pw: fieldByPurpose(item, 'password')?.value ?? '' },
    ...item.history.map(h => ({ at: h.savedAt, pw: fieldByPurpose(h.content, 'password')?.value ?? '' })),
  ];
  const seen = new Set([versions[0].pw]);
  const out: PreviousPassword[] = [];
  for (let k = 1; k < versions.length; k++) {
    const { pw } = versions[k];
    // versions[k - 1] is the version that replaced this one, so its save time is when the password changed.
    if (pw && pw !== versions[k - 1].pw && !seen.has(pw)) out.push({ value: pw, replacedAt: versions[k - 1].at });
    seen.add(pw);
  }
  return out;
}
