'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlApp', {
  listConnections: () => ipcRenderer.invoke('connections:list'),
  saveConnection: (connection) => ipcRenderer.invoke('connections:save', connection),
  removeConnection: (id) => ipcRenderer.invoke('connections:remove', id),
  connect: (id) => ipcRenderer.invoke('connections:connect', id),
});
