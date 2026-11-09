/** The web vault: the desktop app's screens, with the vault handled in the page (see bridge.ts). */
import { bridge } from './bridge';

window.boltwork = bridge;
// Loaded after the bridge is in place: the renderer asks for the app state as it starts.
void import('../renderer/index');
