import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { FlowBridge } from '../shared/bridge';
import type { TimerState } from '../shared/types';

const bridge: FlowBridge = {
  state: () => ipcRenderer.invoke('flow:getState'),
  action: (action) => ipcRenderer.invoke('flow:action', action),
  history: () => ipcRenderer.invoke('flow:history'),
  setRate: (rateCents) => ipcRenderer.invoke('flow:setRate', rateCents),
  launchAtLogin: () => ipcRenderer.invoke('flow:launchAtLogin'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('flow:setLaunchAtLogin', enabled),
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: TimerState) => listener(state);
    ipcRenderer.on('flow:state', handler);
    return () => ipcRenderer.removeListener('flow:state', handler);
  },
};

contextBridge.exposeInMainWorld('flow', bridge);
