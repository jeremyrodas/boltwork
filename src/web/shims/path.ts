/** The few path helpers shared code uses, for the in-memory files of the web vault. */
export const sep = '/';
export const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '.');
export const extname = (p: string) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; };

export default { sep, join, basename, dirname, extname };
