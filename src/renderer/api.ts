import type { Api, ApiEvents, Bridge } from '../core/api';

declare global {
  interface Window { strongroom: Bridge }
}

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

/** Typed client for the main-process API: `await api.saveItem(...)`. */
export const api = new Proxy({} as Async<Api>, {
  get: (_t, method: string) => (...args: unknown[]) => (window.strongroom.call as (m: string, ...a: unknown[]) => Promise<unknown>)(method, ...args),
});

export function on<E extends keyof ApiEvents>(event: E, cb: (p: ApiEvents[E]) => void): () => void {
  return window.strongroom.on(event, cb);
}
