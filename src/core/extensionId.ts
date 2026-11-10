/** Chrome extension ID, derived from the public key in extension/manifest.json (checked by the build). */
export const EXTENSION_ID = 'heephjlhalcgebikhcnialabmojogjih';

/**
 * IDs the browser stores gave the extension (they assign their own and ignore the manifest key). Empty until a
 * listing is approved; the apps will trust these next to EXTENSION_ID once they're filled in.
 */
export const STORE_EXTENSION_IDS: string[] = [];
