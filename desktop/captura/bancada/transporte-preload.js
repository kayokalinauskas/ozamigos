// O preload da medição do transporte (transporte.js): como no app, a página isolada só recebe os quadros.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ponteDeTeste', {
  aoReceberQuadro: (ouvinte) => ipcRenderer.on('quadro', (_e, dados) => ouvinte(dados)),
});
