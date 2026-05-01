import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('ivsDashboard', {
  prototype: true
});
