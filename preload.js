// my-local-rag-app/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer -> Main (one-way)
  // send: (channel, data) => ipcRenderer.send(channel, data),

  // Renderer -> Main (two-way)
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // Main -> Renderer
  // on: (channel, func) => {
  //   const subscription = (event, ...args) => func(...args);
  //   ipcRenderer.on(channel, subscription);
  //   // Return cleanup function
  //   return () => ipcRenderer.removeListener(channel, subscription);
  // }

  // Example specific to the dialog
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  isWindowMaximized: () => ipcRenderer.invoke('is-window-maximized')

});
