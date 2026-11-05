import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from '../core/api';

const bridge: Bridge = {
  call: async (method, ...args) => {
    const res = await ipcRenderer.invoke('api', method, args);
    if (res && typeof res === 'object' && 'error' in res && res.__apiError) throw new Error(res.error as string);
    return res?.value;
  },
  on: (event, cb) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload);
    ipcRenderer.on(`event:${event}`, listener);
    return () => { ipcRenderer.removeListener(`event:${event}`, listener); };
  },
};

contextBridge.exposeInMainWorld('strongroom', bridge);
