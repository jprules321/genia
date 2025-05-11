// my-local-rag-app/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer -> Main (one-way)
  // send: (channel, data) => ipcRenderer.send(channel, data),

  // Renderer -> Main (two-way)
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // Main -> Renderer
  on: (channel, func) => {
    const subscription = (event, ...args) => func(...args);
    ipcRenderer.on(channel, subscription);
    // Return cleanup function
    return () => ipcRenderer.removeListener(channel, subscription);
  },

  // Receive indexation progress updates
  onIndexationProgress: (func) => {
    const subscription = (event, ...args) => func(...args);
    ipcRenderer.on('indexation-progress', subscription);
    return () => ipcRenderer.removeListener('indexation-progress', subscription);
  },

  // Window management
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  isWindowMaximized: () => ipcRenderer.invoke('is-window-maximized'),

  // File indexing and watching
  indexFolder: (folderPath) => ipcRenderer.invoke('index-folder', folderPath),
  indexAllFolders: (folderPaths) => ipcRenderer.invoke('index-all-folders', folderPaths),
  startWatchingFolders: (folderPaths) => ipcRenderer.invoke('start-watching-folders', folderPaths),
  stopWatchingFolders: () => ipcRenderer.invoke('stop-watching-folders'),
  stopFolderIndexation: (folderPath) => ipcRenderer.invoke('stop-folder-indexation', folderPath),
  checkFolderIndexable: (folderPath) => ipcRenderer.invoke('check-folder-indexable', folderPath),
  removeFileFromIndex: (filePath, folderId) => ipcRenderer.invoke('remove-file-from-index', filePath, folderId),
  removeFolderFromIndex: (folderPath) => ipcRenderer.invoke('remove-folder-from-index', folderPath),

  // Indexation error log
  getIndexationErrorLog: (folderPath) => ipcRenderer.invoke('get-indexation-error-log', folderPath),
  clearIndexationErrorLog: (folderPath) => ipcRenderer.invoke('clear-indexation-error-log', folderPath)
});
