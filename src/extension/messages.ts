/** Messages between the extension's popup, content scripts and service worker. */

export type ExtMessage =
  | { type: 'popupState' }
  | { type: 'pair'; code: string; name: string }
  | { type: 'open' }
  | { type: 'matches'; url?: string }
  | { type: 'search'; query: string }
  | { type: 'fill'; id: string; explicit?: boolean }
  | { type: 'copy'; id: string }
  | { type: 'saveCandidate'; username: string; password: string }
  | { type: 'rememberUsername'; username: string }
  | { type: 'pendingSave' }
  | { type: 'saveDecision'; key: string; action: 'save' | 'dismiss' | 'never' }
  | { type: 'neverSaveList' }
  | { type: 'removeNeverSave'; host: string }
  | { type: 'unpair' };

/** Messages the service worker sends to content scripts. */
export type TabMessage =
  | { type: 'doFill'; creds: Creds }
  | { type: 'fillBest' }
  | { type: 'showSave'; pending: PublicPendingSave };

export interface Creds { username: string; password: string; totp: string }

export interface PendingSave {
  key: string; at: number; url: string; host: string; username: string; password: string;
  status: 'new' | 'update'; id?: string; title: string;
}

export type PublicPendingSave = Pick<PendingSave, 'key' | 'host' | 'username' | 'status' | 'title'>;

export interface PopupState {
  state: 'no-host' | 'not-running' | 'unpaired' | 'locked' | 'ready' | 'error';
  detail?: string;
}
