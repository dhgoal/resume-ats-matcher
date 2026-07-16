'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  listResumes: (directory) => ipcRenderer.invoke('resumes:list', directory),
  fetchModels: (params) => ipcRenderer.invoke('models:fetch', params),
  analyze: (params) => ipcRenderer.invoke('analyze:run', params),
  generateResume: (params) => ipcRenderer.invoke('resume:generate', params),
  generateCoverLetter: (params) => ipcRenderer.invoke('cover:generate', params),
  answerQuestions: (params) => ipcRenderer.invoke('qa:answer', params),
  listQuestions: () => ipcRenderer.invoke('questions:list'),
  pinQuestion: (id, pinned) => ipcRenderer.invoke('questions:pin', { id, pinned }),
  deleteQuestion: (id) => ipcRenderer.invoke('questions:delete', id),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
  onProgress: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('analyze:progress', listener);
    return () => ipcRenderer.removeListener('analyze:progress', listener);
  },
});
