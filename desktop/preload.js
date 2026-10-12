// A ponte entre a página e o app. A página não tem acesso ao Node nem ao Windows:
// só a estas funções, e o main.js confere de onde veio cada pedido.

const { contextBridge, ipcRenderer } = require('electron');

const versao = process.argv.find((arg) => arg.startsWith('--ozamigos-versao='))?.split('=')[1] ?? '';

contextBridge.exposeInMainWorld('ozamigos', {
  versao,
  aoPedirFonte(ouvinte) {
    ipcRenderer.removeAllListeners('escolher-fonte');
    ipcRenderer.on('escolher-fonte', (_evento, fontes) => ouvinte(fontes));
  },
  /** Resolve { somDoApp }: true quando o som do PC vem do auxiliar (sem o Discord e sem o app). */
  responderFonte(escolha) {
    return ipcRenderer.invoke('fonte-escolhida', escolha ? { id: String(escolha.id), audio: Boolean(escolha.audio) } : null);
  },
  /** O som do PC chega em pedaços de float32 estéreo, 48 kHz. */
  aoReceberSom(ouvinte) {
    ipcRenderer.removeAllListeners('som');
    ipcRenderer.on('som', (_evento, dados) => ouvinte(dados));
  },
  pararSom() {
    ipcRenderer.send('som-parar');
  },
  trocarServidor() {
    ipcRenderer.send('trocar-servidor');
  },
  // Usadas só pela tela de início (o main.js recusa se o pedido vier de outro lugar).
  servidorAtual: () => ipcRenderer.invoke('servidor-atual'),
  salvarServidor: (endereco) => ipcRenderer.invoke('salvar-servidor', String(endereco)),
});
