// A ponte entre a página e o app. A página não tem acesso ao Node nem ao Windows:
// só a estas funções, e o main.js confere de onde veio cada pedido.

const { contextBridge, ipcRenderer } = require('electron');

const versao = process.argv.find((arg) => arg.startsWith('--ozamigos-versao='))?.split('=')[1] ?? '';

// O canal direto da captura do app (1.2.19): a porta vem do processo principal e vai para a página, que a entrega a um
// worker. Um MessagePort só passa do preload para a página por um postMessage da janela.
ipcRenderer.on('video-porta', (evento) => {
  window.postMessage('ozamigos-porta-do-video', window.location.origin, evento.ports);
});
// O mesmo para o som do PC (1.2.20): a página entrega a porta ao AudioWorklet.
ipcRenderer.on('som-porta', (evento) => {
  window.postMessage('ozamigos-porta-do-som', window.location.origin, evento.ports);
});

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
  /**
   * Resolve { somDoApp }: true quando o som do PC vem do auxiliar (sem o Discord e sem o app). Com escolha.captura
   * ({ largura, altura, fps }, app 1.2.18 em diante), o vídeo vem da captura do app: { videoDoApp: true }.
   */
  responderFonte(escolha) {
    if (!escolha) return ipcRenderer.invoke('fonte-escolhida', null);
    const { captura } = escolha;
    return ipcRenderer.invoke('fonte-escolhida', {
      id: String(escolha.id),
      audio: Boolean(escolha.audio),
      captura: captura ? { largura: Number(captura.largura), altura: Number(captura.altura), fps: Number(captura.fps), canal: captura.canal === true } : null,
    });
  },
  /**
   * A captura de vídeo do app (1.2.18 em diante): cada quadro é um cabeçalho de 24 bytes ("OZQ1", largura e altura em
   * u16, o número em u32, 4 de reserva e o momento da captura em ms, f64) e a imagem em NV12.
   */
  video: {
    /** Os quadros vêm pelo canal direto (a porta chega à página por postMessage), com controle de fluxo (1.2.19 em diante). */
    canalDireto: true,
    aoReceberQuadro(ouvinte) {
      ipcRenderer.removeAllListeners('quadro');
      ipcRenderer.on('quadro', (_evento, dados) => ouvinte(dados));
    },
    /** A captura parou sozinha: { motivo: 'fechou' (a janela fechou) | 'falhou', fonte: o id da fonte }. */
    aoParar(ouvinte) {
      ipcRenderer.removeAllListeners('video-parou');
      ipcRenderer.on('video-parou', (_evento, aviso) => ouvinte({ motivo: String(aviso?.motivo), fonte: String(aviso?.fonte) }));
    },
    parar() {
      ipcRenderer.send('video-parar');
    },
    /** O último segundo do auxiliar (gravação das estatísticas): { novos, repetidos, msConversao, largura, altura }. */
    medidas: () => ipcRenderer.invoke('video-medidas'),
  },
  /** O som do PC chega em pedaços de float32 estéreo, 48 kHz. */
  aoReceberSom(ouvinte) {
    ipcRenderer.removeAllListeners('som');
    ipcRenderer.on('som', (_evento, dados) => ouvinte(dados));
  },
  pararSom() {
    ipcRenderer.send('som-parar');
  },
  /** Pede o canal direto do som do PC até o AudioWorklet (1.2.20 em diante): a porta chega à página por postMessage. */
  canalDoSom() {
    ipcRenderer.send('som-canal');
  },
  /** Um convite para um servidor (link ozamigos://convite/CODIGO) chegou com o app aberto (app 1.3.1 em diante). */
  aoAbrirConvite(ouvinte) {
    ipcRenderer.removeAllListeners('abrir-convite');
    ipcRenderer.on('abrir-convite', (_evento, convite) => ouvinte(String(convite)));
  },
  /** Um link de sala de antes dos servidores (ozamigos://sala/CODIGO) chegou com o app aberto (app 1.2.16 em diante). */
  aoAbrirSala(ouvinte) {
    ipcRenderer.removeAllListeners('abrir-sala');
    ipcRenderer.on('abrir-sala', (_evento, sala) => ouvinte(String(sala)));
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
  /** Mensagens do chat ainda não vistas: o ponto na barra de tarefas e a dica da bandeja (app 1.2.13 em diante). */
  naoLidas(quantas) {
    ipcRenderer.send('nao-lidas', Number(quantas) || 0);
  },
  /** Alguém chamou a sua atenção: o ícone pisca na barra de tarefas até a janela ganhar o foco (app 1.2.21 em diante). */
  chamarAtencao() {
    ipcRenderer.send('chamar-atencao');
  },
  /** Fechar a janela deixa o app na bandeja, perto do relógio (app 1.2.13 em diante). */
  bandeja: {
    ler: () => ipcRenderer.invoke('bandeja-ler'),
    definir: (ligada) => ipcRenderer.send('bandeja-definir', Boolean(ligada)),
  },
  /**
   * Atalhos globais (app 1.2.17 em diante): as teclas de cada atalho, em teclas virtuais do Windows. Resolve true se
   * valem com o jogo na frente. O ouvinte recebe "mudo", "surdo", "falar 1" ou "falar 0".
   */
  atalhos: {
    definir: (atalhos) => ipcRenderer.invoke('atalhos-definir', atalhos),
    aoApertar(ouvinte) {
      ipcRenderer.removeAllListeners('atalho');
      ipcRenderer.on('atalho', (_evento, qual) => ouvinte(String(qual)));
    },
  },
  /**
   * O login pelo navegador do sistema (1.3.0 em diante): o app abre o navegador e espera a volta numa porta local.
   * Resolve { codigo } (no login, a página troca pela sessão; com ligacao, ela confirma a ligação) ou { erro }.
   */
  conta: {
    loginPeloNavegador: (provedor, ligacao) =>
      ipcRenderer.invoke('login-pelo-navegador', String(provedor), ligacao == null ? undefined : String(ligacao)),
  },
  // Usadas só pela tela de início (o main.js recusa se o pedido vier de outro lugar).
  servidorAtual: () => ipcRenderer.invoke('servidor-atual'),
  salvarServidor: (endereco) => ipcRenderer.invoke('salvar-servidor', String(endereco)),
  pararDeEsperar: () => ipcRenderer.send('parar-de-esperar'),
});
