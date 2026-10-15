// A ponte entre a página e o app. A página não tem acesso ao Node nem ao Windows:
// só a estas funções, e o main.js confere de onde veio cada pedido.

const { contextBridge, ipcRenderer } = require('electron');

const versao = process.argv.find((arg) => arg.startsWith('--ozamigos-versao='))?.split('=')[1] ?? '';

// Em tela cheia o Windows esconde os botões da janela: a página deixa de reservar espaço para eles.
ipcRenderer.on('tela-cheia', (_evento, cheia) => {
  document.documentElement.classList.toggle('janela-em-tela-cheia', Boolean(cheia));
});

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
  /** Pinta os botões da janela (minimizar, maximizar, fechar) com a cor do que está embaixo deles. */
  corDaBarra(cor) {
    ipcRenderer.send('cor-da-barra', String(cor));
  },
  /** Teste de desempenho (app 1.2.10 em diante): o PC, a placa de vídeo e o processador, que o navegador não mede. */
  desempenho: {
    pc: () => ipcRenderer.invoke('desempenho-pc'),
    ligar: (ligado) => ipcRenderer.invoke('desempenho-ligar', Boolean(ligado)),
    amostra: () => ipcRenderer.invoke('desempenho-amostra'),
  },
  /** Gravação das estatísticas da sala (app 1.2.11 em diante): salva em Documentos\Ozamigos\Estatísticas\<pasta>. */
  estatisticas: {
    salvar: (pasta, arquivos) => ipcRenderer.invoke('estatisticas-salvar', String(pasta), arquivos),
    abrirPasta: (pasta) => ipcRenderer.invoke('estatisticas-abrir-pasta', String(pasta)),
  },
  /** Fechar a janela deixa o app na bandeja, perto do relógio (app 1.2.13 em diante). */
  bandeja: {
    ler: () => ipcRenderer.invoke('bandeja-ler'),
    definir: (ligada) => ipcRenderer.send('bandeja-definir', Boolean(ligada)),
  },
  // Usadas só pela tela de início (o main.js recusa se o pedido vier de outro lugar).
  servidorAtual: () => ipcRenderer.invoke('servidor-atual'),
  salvarServidor: (endereco) => ipcRenderer.invoke('salvar-servidor', String(endereco)),
});
