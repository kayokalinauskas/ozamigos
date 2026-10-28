// O app para Windows. Ele abre a interface que o servidor do Ozamigos já serve (a mesma do navegador)
// e acrescenta o que só um app consegue: o seletor de janelas e telas, uma captura de vídeo mais rápida que a do
// navegador, o som do PC sem o Discord e sem o próprio app, notificações do Windows, e não ser freado quando fica
// atrás do jogo.

const { iconeComMarca, marcaSozinha, textoDaMarca } = require('./marcaDoChat');
const { app, BrowserWindow, MessageChannelMain, Menu, Notification, Tray, desktopCapturer, ipcMain, nativeImage, nativeTheme, net, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

// O app se chamava "Ozamigos Share". Com o nome novo, o Electron guardaria tudo numa pasta nova
// e cada um perderia o servidor, o nome, a senha e os volumes: por isso a pasta continua a antiga.
app.setPath('userData', path.join(app.getPath('appData'), 'Ozamigos Share'));

// O codificador de vídeo da placa passa um pouco do alvo em cenas cheias de efeito, e o WebRTC respondia
// jogando fora os quadros seguintes: a transmissão engasgava (5 a 9 fps por um segundo) com a captura em 21.
// Medido com o Path of Exile: sem esse descarte, os fps enviados acompanham a captura.
app.commandLine.appendSwitch('force-fieldtrials', 'WebRTC-FrameDropper/Disabled/');

const SERVIDOR_PADRAO = process.env.OZAMIGOS_SERVIDOR || require('./package.json').ozamigos.servidor || '';
// Endereços oficiais que já foram desligados. Quem os tiver guardado volta sozinho para o padrão.
const SERVIDORES_APOSENTADOS = new Set(['https://ozamigos-share-app.onrender.com']);
const ARQUIVO_DE_CONFIGURACAO = path.join(app.getPath('userData'), 'configuracao.json');
// O .ico traz cada tamanho desenhado à parte: com o PNG de 256, o ícone de 16 da barra de título saía torto.
const ICONE = path.join(__dirname, 'build', 'icone.ico');
const INICIO = path.join(__dirname, 'inicio.html');
// screen-wake-lock: com mais alguém na sala, a página segura a tela acordada (web/src/telaAcordada.ts).
const PERMISSOES = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'screen-wake-lock']);

let janela = null;
let pedidoDeFonte = null; // { responder, fontes } enquanto o seletor está aberto
let auxiliarDeSom = null; // o OzamigosSom.exe, enquanto alguém transmite com som
let capturaDeVideo = null; // o OzamigosCaptura.exe, enquanto alguém transmite pela captura do app
let portaDoVideo = null; // o canal direto dos quadros até o worker da página (1.2.19), até a página trocar
let portaDoSom = null; // o canal direto do som do PC até o AudioWorklet da página (1.2.20), até a página trocar
let ligandoAuxiliar = null; // Promise enquanto o auxiliar está abrindo
let avisoDeAtualizacao = null; // a janelinha "Baixando a versão nova", enquanto baixa
let bandeja = null; // o ícone perto do relógio
let saindo = false; // o app está fechando de verdade (Sair, atualização): a janela fecha em vez de ir para a bandeja

// O som desses programas nunca vai na transmissão: o próprio app (este processo e os filhos dele,
// que tocam o som das transmissões) e o Discord, para os amigos não ouvirem a própria voz de volta.
const SEM_SOM_DE = ['Discord.exe', 'DiscordPTB.exe', 'DiscordCanary.exe'];

// ===== Configuração (endereço do servidor e posição da janela) =====

function lerConfiguracao() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_DE_CONFIGURACAO, 'utf8'));
  } catch {
    return {};
  }
}

function salvarConfiguracao(mudancas) {
  const configuracao = { ...lerConfiguracao(), ...mudancas };
  fs.mkdirSync(path.dirname(ARQUIVO_DE_CONFIGURACAO), { recursive: true });
  fs.writeFileSync(ARQUIVO_DE_CONFIGURACAO, JSON.stringify(configuracao, null, 2));
}

/** O endereço guardado pela pessoa (tem prioridade) ou o que vem no app. */
function servidor() {
  const guardado = lerConfiguracao().servidor;
  if (guardado && SERVIDORES_APOSENTADOS.has(origemDe(guardado))) {
    salvarConfiguracao({ servidor: undefined }); // o JSON não grava undefined: a chave some
    return SERVIDOR_PADRAO;
  }
  return guardado || SERVIDOR_PADRAO;
}

/** "http://localhost:8090/" e "http://localhost:8090/?sala=x" viram "http://localhost:8090". */
function origemDe(endereco) {
  try {
    return new URL(endereco).origin;
  } catch {
    return null;
  }
}

function origemDoServidor() {
  return origemDe(servidor());
}

/** É a tela de início do app? Nenhum outro arquivo do disco: a página do servidor não pode abrir um file:// qualquer. */
function ehOInicio(endereco) {
  try {
    return path.resolve(fileURLToPath(endereco)).toLowerCase() === path.resolve(INICIO).toLowerCase();
  } catch {
    return false; // não é file:
  }
}

/** Só https, ou http no próprio computador (para testar o servidor rodando localmente). */
function enderecoValido(texto) {
  try {
    const url = new URL(texto.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Na primeira abertura de cada versão, apaga o cache de páginas e arquivos (o que guardar a interface
 * antiga). Nome, senha, volumes e o endereço do servidor ficam em outro lugar e continuam.
 */
async function limparCacheSeAtualizou() {
  if (lerConfiguracao().versaoDoCache === app.getVersion()) return;
  try {
    await session.defaultSession.clearCache();
  } catch (erro) {
    console.error('Não foi possível limpar o cache', erro);
  }
  salvarConfiguracao({ versaoDoCache: app.getVersion() });
}

// ===== Janela =====

// ===== Acordar o servidor =====
// O Render gratuito dorme depois de 15 min sem ninguém: o primeiro pedido fica parado até ele acordar (75 s medidos
// em 17/10/2026). A janela só aparecia com a página pronta, e o app parecia não abrir. Agora, se o servidor não
// responde logo, a tela de início mostra "Conectando…" com o tempo, e a sala abre sozinha quando ele acorda. A tela
// não fala em servidor dormindo nem em plano gratuito (pedido do dono: o app é um produto).
const MOSTRAR_ACORDANDO_DEPOIS = 1_500;
const PRAZO_DE_CADA_PERGUNTA = 90_000; // o Render segura o pedido enquanto acorda: não desistir antes disso
const PRAZO_PARA_ACORDAR = 3 * 60_000;
let esperaDoServidor = 0; // cada espera tem um número: abrir outra coisa (trocar o servidor) cancela a anterior

/**
 * O servidor está de pé? Qualquer resposta dele vale (a verificação de saúde do Render, /actuator/health, é a menor
 * página que ele tem); 502, 503 e 504 são do Render, com o servidor ainda subindo. Enquanto acorda, o Render segura
 * o pedido sem responder. Lança se a rede falhar (sem internet, endereço errado).
 */
async function servidorAcordado(origem) {
  const resposta = await net.fetch(`${origem}/actuator/health`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(PRAZO_DE_CADA_PERGUNTA),
  });
  return ![502, 503, 504].includes(resposta.status);
}

/** caminho: a página do servidor por onde começar (a de um convite ozamigos://, caminhoDoLink); sem ele, a raiz. */
function abrirServidorOuInicio(erro, caminho = null) {
  const vez = ++esperaDoServidor;
  if (erro || !origemDoServidor()) {
    janela.loadFile(INICIO, { query: erro ? { erro } : {} });
    return;
  }
  void esperarOServidor(vez, origemDoServidor(), caminho);
}

async function esperarOServidor(vez, origem, caminho) {
  const vale = () => vez === esperaDoServidor && janela && !janela.isDestroyed();
  const comeco = Date.now();
  const acordando = setTimeout(() => vale() && janela.loadFile(INICIO, { query: { acordando: origem, desde: String(comeco) } }), MOSTRAR_ACORDANDO_DEPOIS);
  let falhas = 0;
  try {
    while (vale()) {
      let acordado = false;
      try {
        acordado = await servidorAcordado(origem);
        falhas = 0;
      } catch (erro) {
        // Sem internet ou endereço errado: duas falhas seguidas (a primeira pode ser um soluço) mostram o erro.
        if (!vale()) return;
        if (++falhas >= 2 && erro?.name !== 'TimeoutError') {
          janela.loadFile(INICIO, { query: { erro: `Não foi possível abrir ${origem} (${erro?.message ?? erro}). Confira o endereço e a internet.` } });
          return;
        }
      }
      if (!vale()) return;
      if (acordado) {
        // Sempre pergunta ao servidor pela página: um deploy novo aparece na hora, nunca a cópia guardada.
        janela.loadURL(`${origem}${caminho ?? '/'}`, { extraHeaders: 'pragma: no-cache\ncache-control: no-cache\n' });
        return;
      }
      if (Date.now() - comeco > PRAZO_PARA_ACORDAR) {
        janela.loadFile(INICIO, { query: { erro: `Não foi possível conectar a ${origem}. Confira a internet e o endereço, ou tente de novo daqui a pouco.` } });
        return;
      }
      await new Promise((pronto) => setTimeout(pronto, 2_000));
    }
  } finally {
    clearTimeout(acordando);
  }
}

ipcMain.on('parar-de-esperar', (evento) => {
  if (vindoDoInicio(evento)) esperaDoServidor++;
});

// Os botões da janela (minimizar, maximizar, fechar) desenhados pelo Windows, por cima da página.
const BARRA_DA_JANELA = { color: '#0b0e0a', symbolColor: '#c9d4bb', height: 32 };

/**
 * A posição guardada só vale se o topo da janela (onde ela é arrastada) cai em alguma tela de agora. Sem isso, a
 * janela guardada num segundo monitor que foi desligado abria fora da tela: o app parecia não abrir.
 */
function posicaoVisivel({ x, y, width = 1600 } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return {};
  const topo = { x, y, width, height: 32 };
  const aparece = screen.getAllDisplays().some(({ workArea: a }) => {
    const largura = Math.min(topo.x + topo.width, a.x + a.width) - Math.max(topo.x, a.x);
    const altura = Math.min(topo.y + topo.height, a.y + a.height) - Math.max(topo.y, a.y);
    return largura >= 100 && altura >= 16;
  });
  return aparece ? { x, y } : {}; // fora de todas as telas: o Windows centraliza na principal
}

/** atualizando: resolve true se o app vai fechar para instalar uma versão nova (a janela nem aparece). */
function criarJanela(atualizando) {
  const { posicao = {} } = lerConfiguracao();
  janela = new BrowserWindow({
    width: posicao.width ?? 1600,
    height: posicao.height ?? 940,
    ...posicaoVisivel(posicao),
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0e0a',
    // Sem a barra de título do Windows: a página ocupa a janela toda e só os botões de minimizar, maximizar
    // e fechar ficam por cima, na cor do app. A interface reserva essa faixa (env(titlebar-area-height)) e
    // arrasta a janela por ela.
    titleBarStyle: 'hidden',
    titleBarOverlay: BARRA_DA_JANELA,
    title: 'Ozamigos',
    icon: ICONE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Com o jogo na frente, a janela do Ozamigos fica escondida: sem isto, o Chromium a frearia.
      backgroundThrottling: false,
      // O som das transmissões pode começar sem um clique (ex.: voltar a assistir sozinho quando o amigo retoma).
      autoplayPolicy: 'no-user-gesture-required',
      additionalArguments: [`--ozamigos-versao=${app.getVersion()}`],
    },
  });
  if (posicao.maximizada) janela.maximize();
  // A interface carrega enquanto o app confere se há versão nova: as duas coisas juntas, não uma depois da outra.
  const pronta = new Promise((resolver) => janela.once('ready-to-show', resolver));
  void Promise.all([pronta, atualizando]).then(([, vaiAtualizar]) => {
    if (!vaiAtualizar && janela && !janela.isDestroyed()) janela.show();
  });

  // Lembra o tamanho e a posição para a próxima vez.
  janela.on('close', (evento) => {
    salvarConfiguracao({ posicao: { ...janela.getNormalBounds(), maximizada: janela.isMaximized() } });
    if (saindo || !bandeja || !fecharParaBandeja()) return;
    // O X só esconde a janela, como no Discord: a conversa e as transmissões continuam. Sair fica na bandeja.
    evento.preventDefault();
    janela.hide();
    avisarDaBandejaUmaVez();
  });
  // Voltou para a janela: o ícone da barra de tarefas para de piscar (a mensagem nova já está à vista).
  janela.on('focus', () => janela.flashFrame(false));
  // Desligar, reiniciar ou sair do Windows: a janela escondida não pode segurar o desligamento.
  janela.on('session-end', () => {
    saindo = true;
  });

  const conteudo = janela.webContents;
  // Dentro do evento, isFullScreen() ainda pode responder o estado antigo: cada evento manda o seu.
  janela.on('enter-full-screen', () => conteudo.send('tela-cheia', true));
  janela.on('leave-full-screen', () => conteudo.send('tela-cheia', false));
  conteudo.on('did-finish-load', () => conteudo.send('tela-cheia', janela.isFullScreen()));
  // Recarregou (ou trocou de servidor) no meio de uma transmissão ou de um teste: o auxiliar de som e os contadores
  // do Windows param junto. Sem isso, o auxiliar seguia capturando o som do PC para uma página que não o ouvia mais.
  conteudo.on('did-start-navigation', (detalhes) => {
    if (!detalhes.isMainFrame || detalhes.isSameDocument) return;
    desligarContadores();
    desligarAuxiliarDeSom();
    desligarCapturaDeVideo();
    fecharPortaDoVideo();
    desligarAtalhos(); // a página nova manda os atalhos de novo ao abrir
  });
  // A página travou ou caiu (falta de memória, falha da placa de vídeo): sem isto, a janela ficava vazia até a pessoa
  // apertar Ctrl+R. Abre de novo sozinha; se cair outra vez em menos de 30 s, mostra a tela de início com o erro, em vez
  // de recarregar para sempre.
  let ultimaQueda = 0;
  conteudo.on('render-process-gone', (_evento, { reason }) => {
    console.error('A página caiu:', reason);
    desligarContadores();
    desligarAuxiliarDeSom();
    desligarCapturaDeVideo();
    fecharPortaDoVideo();
    desligarAtalhos();
    if (reason === 'clean-exit' || janela.isDestroyed()) return;
    const seguida = Date.now() - ultimaQueda < 30_000;
    ultimaQueda = Date.now();
    if (seguida) janela.loadFile(INICIO, { query: { erro: `A página do Ozamigos caiu duas vezes seguidas (${reason}). Tente abrir de novo.` } });
    else abrirServidorOuInicio();
  });
  // Sem barra de título, o menu não aparece: os atalhos dele são tratados aqui, sem depender do menu.
  conteudo.on('before-input-event', (evento, tecla) => {
    if (tecla.type !== 'keyDown') return;
    const ctrl = tecla.control || tecla.meta;
    if ((ctrl && !tecla.shift && tecla.key.toLowerCase() === 'r') || tecla.key === 'F5') conteudo.reload();
    else if (tecla.key === 'F11') janela.setFullScreen(!janela.isFullScreen());
    else if ((ctrl && tecla.shift && tecla.key.toLowerCase() === 'i') || tecla.key === 'F12') conteudo.toggleDevTools();
    else return;
    evento.preventDefault();
  });
  // A janela só navega dentro do servidor; qualquer outro link abre no navegador de verdade.
  conteudo.on('will-navigate', (evento, url) => {
    if (ehOInicio(url) || origemDe(url) === origemDoServidor()) return;
    evento.preventDefault();
    abrirFora(url);
  });
  conteudo.setWindowOpenHandler(({ url }) => {
    abrirFora(url);
    return { action: 'deny' };
  });
  conteudo.on('did-fail-load', (_evento, codigo, descricao, url, principal) => {
    if (!principal || codigo === -3 || url.startsWith('file:')) return; // -3: navegação cancelada
    abrirServidorOuInicio(`Não foi possível abrir ${origemDoServidor()} (${descricao}). Confira o endereço e a internet.`);
  });

  abrirServidorOuInicio(null, caminhoDoLink(linkDosArgumentos(process.argv))); // aberto por um convite: já nele
}

function abrirFora(url) {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

// ===== Permissões: câmera/tela, notificações e tela cheia, só para o servidor do Ozamigos =====

function configurarSessao() {
  const sessao = session.defaultSession;
  const permitido = (origem, permissao) => origem !== null && origem === origemDoServidor() && PERMISSOES.has(permissao);
  sessao.setPermissionRequestHandler((_conteudo, permissao, responder, detalhes) => {
    responder(permitido(origemDe(detalhes.requestingUrl), permissao));
  });
  sessao.setPermissionCheckHandler((_conteudo, permissao, origem) => permitido(origemDe(origem), permissao));

  // Quando a página chama getDisplayMedia, o app lista janelas e telas e pede para a interface mostrar o seletor.
  sessao.setDisplayMediaRequestHandler(async (pedido, responder) => {
    if (origemDe(pedido.securityOrigin) !== origemDoServidor() || !janela) {
      console.warn('Captura de tela recusada para', pedido.securityOrigin);
      responder(null);
      return;
    }
    pedidoDeFonte?.responder(null); // um seletor por vez
    let fontes;
    try {
      fontes = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true,
      });
    } catch (erro) {
      console.error('Não foi possível listar janelas e telas', erro);
      responder(null);
      return;
    }
    const propria = janela.getMediaSourceId();
    fontes = fontes.filter((fonte) => fonte.id !== propria && fonte.name);
    pedidoDeFonte = { responder, fontes };
    janela.webContents.send(
      'escolher-fonte',
      fontes.map((fonte) => ({
        id: fonte.id,
        nome: fonte.name,
        tipo: fonte.id.startsWith('screen:') ? 'tela' : 'janela',
        // JPEG: 10 vezes mais rápido de gerar e um terço do tamanho do PNG (medido: 5 ms e 205 KB contra 55 ms e 700 KB).
        miniatura: `data:image/jpeg;base64,${fonte.thumbnail.toJPEG(80).toString('base64')}`,
        icone: fonte.appIcon && !fonte.appIcon.isEmpty() ? fonte.appIcon.toDataURL() : null,
      })),
    );
  });

  // Devolve { somDoApp: true } quando o som vem do auxiliar: a página então junta essa faixa ao vídeo. Com
  // { videoDoApp: true }, o vídeo vem da captura do app (OzamigosCaptura.exe): o getDisplayMedia da página é recusado
  // e ela monta a trilha com os quadros que chegam por "quadro". Só quando a página pede (escolha.captura): a página
  // de antes não saberia montar a trilha.
  ipcMain.handle('fonte-escolhida', async (evento, escolha) => {
    if (!pedidoDeFonte || origemDe(evento.senderFrame?.url) !== origemDoServidor()) return { somDoApp: false };
    const { responder, fontes } = pedidoDeFonte;
    pedidoDeFonte = null;
    const fonte = escolha && fontes.find((f) => f.id === escolha.id);
    if (!fonte) {
      responder(null); // a pessoa cancelou (a transmissão de agora, se houver, continua como está)
      return { somDoApp: false };
    }
    const tipo = fonte.id.startsWith('screen:') ? 'tela' : 'janela';
    const somDoApp = escolha.audio ? await ligarAuxiliarDeSom() : false;
    const captura = tamanhoDaCaptura(escolha.captura);
    // Sem o auxiliar de som, o som do Windows inteiro vem pelo Chromium: o vídeo vai junto, pela captura dele.
    if (captura && (somDoApp || !escolha.audio)) {
      const motivo = await ligarCapturaDeVideo(fonte, captura);
      if (!motivo) {
        responder(null);
        return { somDoApp, videoDoApp: true, tipo, fonte: fonte.id };
      }
      console.warn('A captura do app não abriu, vai a do Chromium:', motivo);
    } else {
      desligarCapturaDeVideo(); // trocou para a captura do Chromium
    }
    // Se o auxiliar de som não rodar (Windows antigo demais), vai o som do Windows inteiro, como no navegador.
    responder(somDoApp || !escolha.audio ? { video: fonte } : { video: fonte, audio: 'loopback' });
    return { somDoApp, videoDoApp: false, tipo };
  });

  ipcMain.on('video-parar', (evento) => {
    if (vindoDaPagina(evento)) desligarCapturaDeVideo();
  });

  /**
   * O último segundo do auxiliar de captura ({ novos, repetidos, msConversao, msSaida, largura, altura }) e quantos
   * quadros o app deixou de fora desde a última pergunta (a página atrasada), ou null.
   */
  ipcMain.handle('video-medidas', (evento) => {
    if (!vindoDaPagina(evento) || !capturaDeVideo?.medidas) return null;
    const { novos, repetidos, msConversao, msSaida, largura, altura } = capturaDeVideo.medidas;
    const deixados = capturaDeVideo.deixados;
    capturaDeVideo.deixados = 0;
    return { novos, repetidos, msConversao, msSaida, largura, altura, deixados };
  });

  // O canal direto do som do PC (1.2.20): a página pede ao abrir o AudioWorklet, e a porta vai a ela por postMessage
  // (o preload a repassa), e dela ao AudioWorklet. Um pedido novo troca o canal.
  ipcMain.on('som-canal', (evento) => {
    if (!vindoDaPagina(evento) || !janela || janela.isDestroyed()) return;
    portaDoSom?.close();
    const { port1, port2 } = new MessageChannelMain();
    portaDoSom = port1;
    janela.webContents.postMessage('som-porta', null, [port2]);
  });

  ipcMain.on('som-parar', (evento) => {
    if (origemDe(evento.senderFrame?.url) === origemDoServidor()) desligarAuxiliarDeSom();
  });
}

// ===== Som do PC, sem o Discord e sem o próprio app (desktop/som, roda escondido) =====

function caminhoDoAuxiliar() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'som', 'OzamigosSom.exe')
    : path.join(__dirname, 'som', 'publicado', 'OzamigosSom.exe');
}

/**
 * Com o jogo na frente e outro app entre ele e o Ozamigos, o Windows 11 dá o app por invisível e, depois de uns
 * segundos, passa a ignorar o pedido de relógio fino dele: a captura da tela, que pede um quadro a cada 33 ms, só acorda
 * no tique padrão de 15,6 ms (a cada 46,9 ms) e fica presa em ~21 fps, com a placa folgada (relatórios reais de 15/10/2026;
 * com o Ozamigos logo atrás do jogo, ficava normal). O auxiliar marca este processo para o Windows continuar honrando o
 * relógio (Relogio.cs). Numa bancada: 21–22 fps sem a marca, 29–30 com. Sem o auxiliar ou no Windows 10, segue sem.
 */
function honrarRelogioFino() {
  if (!fs.existsSync(caminhoDoAuxiliar())) return;
  try {
    const processo = spawn(caminhoDoAuxiliar(), ['--relogio', String(process.pid)], { windowsHide: true, stdio: 'ignore' });
    processo.on('error', (erro) => console.warn('Não foi possível pedir o relógio fino', erro));
  } catch (erro) {
    console.warn('Não foi possível pedir o relógio fino', erro);
  }
}

/**
 * Liga o auxiliar (se ainda não estiver ligado). Resolve true quando ele avisa "pronto".
 * Dois pedidos seguidos (trocar a fonte rápido) esperam o mesmo auxiliar: nunca dois ao mesmo tempo.
 */
function ligarAuxiliarDeSom() {
  if (auxiliarDeSom) return Promise.resolve(true);
  ligandoAuxiliar ??= abrirAuxiliarDeSom().finally(() => {
    ligandoAuxiliar = null;
  });
  return ligandoAuxiliar;
}

function abrirAuxiliarDeSom() {
  const executavel = caminhoDoAuxiliar();
  if (!fs.existsSync(executavel)) return Promise.resolve(false);
  return new Promise((resolver) => {
    const processo = spawn(executavel, ['--excluir-pid', String(process.pid), '--excluir-nome', SEM_SOM_DE.join(',')], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let pronto = false;
    let sobra = Buffer.alloc(0);
    const desistir = setTimeout(() => {
      if (!pronto) processo.kill();
    }, 8000);

    processo.stderr.setEncoding('utf8');
    processo.stderr.on('data', (texto) => {
      for (const linha of texto.split(/\r?\n/).filter(Boolean)) {
        if (linha === 'pronto' && !pronto) {
          pronto = true;
          clearTimeout(desistir);
          auxiliarDeSom = processo;
          resolver(true);
        } else {
          console.log('[som]', linha);
        }
      }
    });
    // A saída é float32 estéreo (8 bytes por quadro): só manda quadros inteiros para a página.
    processo.stdout.on('data', (dados) => {
      if (!pronto || !janela || janela.isDestroyed()) return;
      const tudo = sobra.length ? Buffer.concat([sobra, dados]) : dados;
      const inteiros = tudo.length - (tudo.length % 8);
      sobra = Buffer.from(tudo.subarray(inteiros));
      if (inteiros === 0) return;
      // Pelo canal direto, o som não passa pela thread da página (que, ocupada com o vídeo, o atrasava); a página de
      // antes recebe pelo ipcRenderer.
      if (portaDoSom) portaDoSom.postMessage(tudo.buffer.slice(tudo.byteOffset, tudo.byteOffset + inteiros));
      else janela.webContents.send('som', tudo.subarray(0, inteiros));
    });
    processo.on('error', (erro) => console.error('Auxiliar de som não abriu', erro));
    processo.on('exit', (codigo) => {
      clearTimeout(desistir);
      if (auxiliarDeSom === processo) auxiliarDeSom = null;
      if (!pronto) resolver(false);
      console.log('Auxiliar de som terminou, código', codigo);
    });
  });
}

function desligarAuxiliarDeSom() {
  if (!auxiliarDeSom) return;
  auxiliarDeSom.stdin.end(); // ele termina sozinho quando a entrada fecha
  auxiliarDeSom.kill();
  auxiliarDeSom = null;
}

// ===== Captura de vídeo do app (desktop/captura, roda escondido; 1.2.18 em diante) =====
// O Chromium copia o quadro inteiro para a memória antes de reduzir e nunca deixa a cópia passar de metade do tempo:
// com o jogo pesado, a captura dele ficava em ~21 fps. O auxiliar captura pelo Windows (Windows Graphics Capture), reduz
// e converte na placa de vídeo, e escreve os quadros NV12 prontos (no Path of Exile, 28–30 fps; ~7 ms até a página e ~2%
// do processador, medidos em 17/10/2026). A página monta a trilha do WebRTC com eles. Se ele não abrir, vai a captura
// do Chromium; se parar no meio, a página troca para a do Chromium sozinha (video-parou).

const ESPERA_DO_PRIMEIRO_QUADRO = 4_000;
// Controle de fluxo do canal direto: no máximo 3 quadros a caminho da página (o worker confirma cada um). Com a página
// atrasada, o quadro novo fica de fora em vez de esperar numa fila: sem isto (no 1.2.18), em 1080p a 60 o atraso até a
// página crescia sem parar, de 13 ms para 2,7 s em 30 s, e a memória do app junto.
const QUADROS_A_CAMINHO = 3;
const SEM_QUADROS_POR = 3_000; // ele repete o último a cada 100 ms com a imagem parada: 3 s sem nada é defeito

function caminhoDaCaptura() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'captura', 'OzamigosCaptura.exe')
    : path.join(__dirname, 'captura', 'publicado', 'OzamigosCaptura.exe');
}

/**
 * { largura, altura, fps, canal } pedidos pela página, conferidos; null se a página não pediu a captura do app.
 * canal: a página recebe os quadros pelo canal direto (a página de antes os recebia pelo ipcRenderer, "quadro").
 */
function tamanhoDaCaptura(pedido) {
  if (!pedido || typeof pedido !== 'object') return null;
  const inteiro = (valor, minimo, maximo) => (Number.isInteger(valor) && valor >= minimo && valor <= maximo ? valor : null);
  const largura = inteiro(pedido.largura, 160, 3840);
  const altura = inteiro(pedido.altura, 90, 2160);
  const fps = inteiro(pedido.fps, 5, 120);
  return largura && altura && fps ? { largura, altura, fps, canal: pedido.canal === true } : null;
}

/**
 * O canal direto dos quadros: um MessagePort entregue à página (o preload o repassa a ela, e ela a um worker), que
 * monta os VideoFrame fora da thread da página e confirma cada quadro de volta. Um por página: trocar de página o fecha.
 */
function abrirPortaDoVideo() {
  if (portaDoVideo) return portaDoVideo;
  const { port1, port2 } = new MessageChannelMain();
  port1.on('message', () => {
    if (!capturaDeVideo) return;
    capturaDeVideo.aCaminho = Math.max(0, capturaDeVideo.aCaminho - 1);
    capturaDeVideo.ultimaConfirmacao = Date.now();
  });
  port1.start();
  janela.webContents.postMessage('video-porta', null, [port2]);
  portaDoVideo = port1;
  return port1;
}

function fecharPortaDoVideo() {
  portaDoVideo?.close();
  portaDoVideo = null;
  portaDoSom?.close(); // o mesmo vale para o canal do som: a página nova pede o dela
  portaDoSom = null;
}

/**
 * O que o auxiliar captura: a janela pelo HWND (o id do Chromium é "window:HWND:0"), ou a tela por um ponto no meio
 * dela, em pixels de verdade (o auxiliar acha a tela pelo ponto). null se não der para saber.
 */
function argumentosDaFonte(fonte) {
  const [tipo, numero] = fonte.id.split(':');
  if (tipo === 'window') return /^\d+$/.test(numero) ? ['--janela', numero] : null;
  const tela = screen.getAllDisplays().find((t) => String(t.id) === fonte.display_id);
  if (!tela) return null;
  const { x, y, width, height } = tela.bounds;
  const meio = screen.dipToScreenPoint({ x: x + width / 2, y: y + height / 2 });
  return ['--tela', `${Math.round(meio.x)},${Math.round(meio.y)}`];
}

/**
 * Liga a captura do app para a fonte, no lugar da que estiver ligada. Resolve null quando o primeiro quadro chega
 * (já indo para a página), ou o motivo de não ter dado certo (a página fica com a captura do Chromium).
 */
function ligarCapturaDeVideo(fonte, { largura, altura, fps, canal }) {
  desligarCapturaDeVideo();
  const porta = canal ? abrirPortaDoVideo() : null;
  const argumentos = argumentosDaFonte(fonte);
  if (!argumentos) return Promise.resolve('fonte desconhecida');
  if (!fs.existsSync(caminhoDaCaptura())) return Promise.resolve('sem o auxiliar de captura');
  return new Promise((resolver) => {
    const processo = spawn(caminhoDaCaptura(), ['--fps', String(fps), '--largura', String(largura), '--altura', String(altura), ...argumentos], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // aCaminho: quadros mandados pelo canal direto e ainda não confirmados; deixados: os que ficaram de fora por isso.
    const atual = { processo, fonte: fonte.id, fechou: false, ultimoQuadro: 0, vigia: null, medidas: null, aCaminho: 0, ultimaConfirmacao: Date.now(), deixados: 0 };
    capturaDeVideo = atual;
    let resolvido = false;
    let erro = '';
    const terminar = (motivo) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(desistir);
      resolver(motivo);
    };
    const desistir = setTimeout(() => {
      terminar(erro || 'nenhum quadro em 4 s');
      if (capturaDeVideo === atual) desligarCapturaDeVideo();
    }, ESPERA_DO_PRIMEIRO_QUADRO);

    processo.stderr.setEncoding('utf8');
    processo.stderr.on('data', (texto) => {
      for (const linha of texto.split(/\r?\n/).filter(Boolean)) {
        if (linha === 'fechou') atual.fechou = true;
        else if (linha.startsWith('erro:')) erro = linha;
        else if (linha.startsWith('{')) {
          // As medidas do último segundo, para a gravação das estatísticas (video-medidas).
          try {
            atual.medidas = JSON.parse(linha);
          } catch {
            // linha cortada: a próxima chega em 1 s
          }
        } else console.log('[captura]', linha);
      }
    });

    // Cada quadro: 24 bytes de cabeçalho ("OZQ1", largura e altura em u16…) e o NV12, largura × altura × 1,5 bytes
    // (1,4 MB em 720p, 3,1 MB em 1080p), em pedaços de 64 KB. Os pedaços vão direto para um buffer do tamanho do quadro,
    // reaproveitado (mandar copia na hora, então ele fica livre para o próximo); um quadro que vai ficar de fora (a página
    // atrasada) nem é copiado. Antes, juntar os pedaços e copiar de novo para mandar eram duas cópias a mais por quadro
    // nesta thread, que é a da janela.
    const cabecalho = Buffer.alloc(24);
    let noCabecalho = 0; // bytes do cabeçalho já lidos
    let quadro = null; // o buffer do quadro de agora (null: lendo o cabeçalho)
    let pular = false; // este quadro fica de fora: os bytes só passam
    let preenchido = 0;
    let esperado = 0;
    const paginaAberta = () => capturaDeVideo === atual && janela && !janela.isDestroyed() && origemDe(janela.webContents.getURL()) === origemDoServidor();
    processo.stdout.on('data', (dados) => {
      let i = 0;
      while (i < dados.length) {
        if (esperado === 0) {
          const n = Math.min(24 - noCabecalho, dados.length - i);
          dados.copy(cabecalho, noCabecalho, i, i + n);
          noCabecalho += n;
          i += n;
          if (noCabecalho < 24) return;
          noCabecalho = 0;
          if (cabecalho.toString('latin1', 0, 4) !== 'OZQ1') {
            erro = 'quadro estragado';
            processo.kill();
            return;
          }
          esperado = 24 + (cabecalho.readUInt16LE(4) * cabecalho.readUInt16LE(6) * 3) / 2;
          pular = porta !== null && atual.aCaminho >= QUADROS_A_CAMINHO;
          if (!pular && quadro?.length !== esperado) quadro = new Uint8Array(esperado); // a janela mudou de tamanho
          if (!pular) quadro.set(cabecalho, 0);
          preenchido = 24;
          continue;
        }
        const n = Math.min(esperado - preenchido, dados.length - i);
        if (!pular) quadro.set(dados.subarray(i, i + n), preenchido);
        preenchido += n;
        i += n;
        if (preenchido < esperado) continue;
        esperado = 0;
        atual.ultimoQuadro = Date.now();
        if (pular) {
          atual.deixados++; // a página está atrasada: este ficou de fora
        } else if (paginaAberta()) {
          if (porta) {
            porta.postMessage(quadro.buffer); // copiado aqui mesmo: o buffer serve para o próximo
            atual.aCaminho++;
          } else {
            janela.webContents.send('quadro', quadro); // a página de antes do canal direto
          }
          terminar(null);
        }
      }
    });
    // Travou sem cair (não manda mais nada): é desligado, e a página troca para a captura do Chromium.
    atual.vigia = setInterval(() => {
      if (atual.ultimoQuadro && Date.now() - atual.ultimoQuadro > SEM_QUADROS_POR) {
        erro ||= 'parou de mandar quadros';
        processo.kill();
      }
      // Uma confirmação que se perdeu (o worker foi refeito) não pode travar o canal: 1 s sem nenhuma, recomeça a conta.
      if (atual.aCaminho >= QUADROS_A_CAMINHO && Date.now() - atual.ultimaConfirmacao > 1_000) {
        atual.aCaminho = 0;
        atual.ultimaConfirmacao = Date.now();
      }
    }, 1_000);
    processo.on('error', (e) => {
      erro = String(e?.message ?? e);
    });
    processo.on('exit', (codigo) => {
      clearInterval(atual.vigia);
      terminar(erro || `terminou (código ${codigo})`);
      if (capturaDeVideo !== atual) return; // desligado pelo app: nada a avisar
      capturaDeVideo = null;
      console.warn('A captura do app parou:', atual.fechou ? 'a janela fechou' : erro || codigo);
      if (atual.ultimoQuadro && janela && !janela.isDestroyed()) {
        janela.webContents.send('video-parou', { motivo: atual.fechou ? 'fechou' : 'falhou', fonte: atual.fonte });
      }
    });
  });
}

function desligarCapturaDeVideo() {
  const atual = capturaDeVideo;
  if (!atual) return;
  capturaDeVideo = null; // antes de matar: assim o "exit" sabe que foi o app
  clearInterval(atual.vigia);
  atual.processo.stdin.end(); // ele termina sozinho quando a entrada fecha
  atual.processo.kill();
}

// ===== Tela de início (escolher o servidor) =====

function vindoDoInicio(evento) {
  return ehOInicio(evento.senderFrame?.url ?? '');
}

ipcMain.handle('servidor-atual', (evento) => (vindoDoInicio(evento) ? servidor() : null));

ipcMain.handle('salvar-servidor', (evento, texto) => {
  if (!vindoDoInicio(evento)) return 'Pedido recusado.';
  const origem = enderecoValido(String(texto));
  if (!origem) return 'Use um endereço que comece com https:// (ou http://localhost para testar no seu PC).';
  // O endereço que já vem no app não é guardado: assim, se o padrão mudar numa versão nova, todos acompanham.
  salvarConfiguracao({ servidor: origem === origemDe(SERVIDOR_PADRAO) ? undefined : origem });
  abrirServidorOuInicio();
  return null;
});

ipcMain.on('cor-da-barra', (evento, cor) => {
  if (origemDe(evento.senderFrame?.url) !== origemDoServidor() || !/^#[0-9a-f]{6}$/i.test(cor)) return;
  janela?.setTitleBarOverlay({ ...BARRA_DA_JANELA, color: cor });
});

ipcMain.on('trocar-servidor', (evento) => {
  if (origemDe(evento.senderFrame?.url) === origemDoServidor()) trocarServidor();
});

function trocarServidor() {
  esperaDoServidor++;
  janela?.loadFile(INICIO);
}

const vindoDaPagina = (evento) => origemDe(evento.senderFrame?.url) === origemDoServidor();

// ===== Estatísticas da sala (Ctrl+Shift+G na sala): salvas sozinhas em Documentos\Ozamigos\Estatísticas =====

const pastaDasEstatisticas = () => path.join(app.getPath('documents'), 'Ozamigos', 'Estatísticas');
// Só um nome, nunca um caminho: a página não escolhe onde gravar no disco. Nem um nome que o Windows reserva
// (CON, NUL, COM1…, com ou sem extensão), que não vira arquivo.
const nomeSeguro = (texto) =>
  typeof texto === 'string' &&
  /^[^\\/:*?"<>|\x00-\x1f]{1,120}$/.test(texto) &&
  !/^[. ]|[. ]$/.test(texto) &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(texto);

ipcMain.handle('estatisticas-salvar', async (evento, pasta, arquivos) => {
  if (!vindoDaPagina(evento) || !nomeSeguro(pasta) || !arquivos || typeof arquivos !== 'object') return null;
  const destino = path.join(pastaDasEstatisticas(), pasta);
  await fs.promises.mkdir(destino, { recursive: true });
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    if (!nomeSeguro(nome) || !/\.(md|json|html)$/.test(nome) || typeof conteudo !== 'string') continue;
    // Grava num temporário e troca: um salvamento cortado no meio não estraga o anterior.
    const final = path.join(destino, nome);
    await fs.promises.writeFile(`${final}.tmp`, conteudo, 'utf8');
    await fs.promises.rename(`${final}.tmp`, final);
  }
  return destino;
});

ipcMain.handle('estatisticas-abrir-pasta', async (evento, pasta) => {
  if (!vindoDaPagina(evento) || !nomeSeguro(pasta)) return false;
  const destino = path.join(pastaDasEstatisticas(), pasta);
  if (!fs.existsSync(destino)) return false;
  return (await shell.openPath(destino)) === '';
});

// ===== Atalhos globais: mudo, som desligado e apertar para falar, com o jogo na frente =====
// O auxiliar (--atalhos, Atalhos.cs) pergunta ao Windows o estado das teclas: não toma a tecla do jogo, como o
// globalShortcut do Electron tomaria, e conta quando ela é solta (apertar para falar). A página manda as teclas
// (teclas virtuais do Windows) e recebe "mudo", "surdo", "falar 1" e "falar 0".

let auxiliarDeAtalhos = null;
const NOMES_DOS_ATALHOS = ['mudo', 'surdo', 'falar'];

/** { mudo: [17, 16, 77], falar: [5] } vira "mudo=17,16,77 falar=5"; o que não for válido fica de fora. */
function linhaDosAtalhos(atalhos) {
  if (!atalhos || typeof atalhos !== 'object') return '';
  return NOMES_DOS_ATALHOS.map((nome) => {
    const teclas = Array.isArray(atalhos[nome]) ? atalhos[nome].filter((t) => Number.isInteger(t) && t >= 1 && t <= 254) : [];
    return teclas.length > 0 && teclas.length <= 4 ? `${nome}=${teclas.join(',')}` : '';
  })
    .filter(Boolean)
    .join(' ');
}

function desligarAtalhos() {
  auxiliarDeAtalhos?.stdin.end();
  auxiliarDeAtalhos?.kill();
  auxiliarDeAtalhos = null;
}

/** Resolve true se os atalhos valem com o jogo na frente (o auxiliar existe); false: só com a janela em foco. */
ipcMain.handle('atalhos-definir', (evento, atalhos) => {
  if (!vindoDaPagina(evento)) return false;
  const linha = linhaDosAtalhos(atalhos);
  if (!linha) {
    desligarAtalhos();
    return fs.existsSync(caminhoDoAuxiliar());
  }
  if (!auxiliarDeAtalhos) {
    if (!fs.existsSync(caminhoDoAuxiliar())) return false;
    const processo = spawn(caminhoDoAuxiliar(), ['--atalhos'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    auxiliarDeAtalhos = processo;
    let resto = '';
    processo.stdout.setEncoding('utf8');
    processo.stdout.on('data', (texto) => {
      const linhas = (resto + texto).split(/\r?\n/);
      resto = linhas.pop();
      if (!janela || janela.isDestroyed() || origemDe(janela.webContents.getURL()) !== origemDoServidor()) return;
      for (const evento of linhas) {
        if (/^(mudo|surdo|falar [01])$/.test(evento)) janela.webContents.send('atalho', evento);
      }
    });
    processo.on('error', (erro) => console.error('Auxiliar dos atalhos não abriu', erro));
    processo.on('exit', () => {
      if (auxiliarDeAtalhos === processo) auxiliarDeAtalhos = null;
    });
  }
  auxiliarDeAtalhos.stdin.write(`${linha}\n`);
  return true;
});

// ===== Teste de desempenho (o que o navegador não mede: o PC e a placa de vídeo) =====

let contadores = null; // o auxiliar em modo --contadores, enquanto um teste grava
let ultimaLeitura = null; // a linha JSON mais recente dele

function desligarContadores() {
  contadores?.stdin.end();
  contadores?.kill();
  contadores = null;
  ultimaLeitura = null;
}


ipcMain.handle('desempenho-pc', async (evento) => {
  if (!vindoDaPagina(evento)) return null;
  const os = require('node:os');
  const { screen } = require('electron');
  let placa = null;
  try {
    const info = await app.getGPUInfo('complete');
    const ativa = info.gpuDevice?.find((d) => d.active) ?? info.gpuDevice?.[0];
    // "ANGLE (AMD, AMD  Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11-…)" -> "AMD Radeon RX 7800 XT"
    const renderizador = info.auxAttributes?.glRenderer ?? '';
    const nome = /^ANGLE \([^,]+,\s*(.+?)\s*(\(0x|Direct3D)/.exec(renderizador)?.[1]?.replace(/\s+/g, ' ') ?? (renderizador || null);
    placa = { nome, driver: ativa?.driverVersion ?? null, fabricante: ativa?.vendorId ?? null };
  } catch {
    // sem informação da placa: o relatório diz "?"
  }
  return {
    sistema: `${os.version()} (${os.release()})`,
    processador: os.cpus()[0]?.model.trim() ?? '?',
    nucleos: os.cpus().length,
    memoriaGB: Math.round(os.totalmem() / 2 ** 30),
    placa,
    telas: screen.getAllDisplays().map((t) => ({
      tamanho: `${Math.round(t.size.width * t.scaleFactor)}x${Math.round(t.size.height * t.scaleFactor)}`,
      escala: t.scaleFactor,
      hz: t.displayFrequency,
      principal: t.id === screen.getPrimaryDisplay().id,
    })),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    contadoresDoWindows: fs.existsSync(caminhoDoAuxiliar()),
  };
});

ipcMain.handle('desempenho-ligar', (evento, ligado) => {
  if (!vindoDaPagina(evento)) return false;
  if (!ligado) {
    desligarContadores();
    return true;
  }
  if (contadores || !fs.existsSync(caminhoDoAuxiliar())) return Boolean(contadores);
  const processo = spawn(caminhoDoAuxiliar(), ['--contadores'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  contadores = processo;
  let sobra = '';
  processo.stdout.setEncoding('utf8');
  processo.stdout.on('data', (texto) => {
    const linhas = (sobra + texto).split('\n');
    sobra = linhas.pop();
    for (const linha of linhas) {
      try {
        ultimaLeitura = JSON.parse(linha);
      } catch {
        // linha cortada: a próxima chega em 1 s
      }
    }
  });
  processo.on('error', (erro) => console.error('Contadores do Windows não abriram', erro));
  processo.on('exit', () => {
    if (contadores === processo) contadores = null;
  });
  return true;
});

/**
 * Uma amostra por segundo. O processador do app vem do Electron (por tipo de processo); o do PC inteiro e a
 * placa de vídeo vêm dos contadores do Windows, separando o que é do app (estes processos e o auxiliar de som)
 * do resto (o jogo, principalmente).
 */
ipcMain.handle('desempenho-amostra', (evento) => {
  if (!vindoDaPagina(evento)) return null;
  const metricas = app.getAppMetrics();
  const pids = new Set(metricas.map((m) => String(m.pid)));
  if (auxiliarDeSom?.pid) pids.add(String(auxiliarDeSom.pid));
  if (capturaDeVideo?.processo.pid) pids.add(String(capturaDeVideo.processo.pid));
  if (contadores?.pid) pids.add(String(contadores.pid));
  // percentCPUUsage já vem em % do processador inteiro (o Electron divide pelos núcleos).
  const processos = {};
  for (const m of metricas) {
    const tipo = m.type === 'Utility' ? (m.serviceName ?? m.name ?? 'Utility') : m.type;
    const atual = processos[tipo] ?? { cpu: 0, memoriaMB: 0 };
    atual.cpu += m.cpu.percentCPUUsage;
    atual.memoriaMB += (m.memory.workingSetSize ?? 0) / 1024;
    processos[tipo] = atual;
  }
  for (const atual of Object.values(processos)) {
    atual.cpu = Math.round(atual.cpu * 10) / 10;
    atual.memoriaMB = Math.round(atual.memoriaMB);
  }
  let placa = null;
  if (ultimaLeitura) {
    const doApp = {};
    const outros = {};
    for (const [pid, tipos] of Object.entries(ultimaLeitura.porProcesso ?? {})) {
      const destino = pids.has(pid) ? doApp : outros;
      for (const [tipo, uso] of Object.entries(tipos)) destino[tipo] = Math.round(((destino[tipo] ?? 0) + uso) * 10) / 10;
    }
    placa = { total: ultimaLeitura.motores ?? {}, doApp, outros, memoriaMB: ultimaLeitura.memoriaDaPlacaMB ?? null };
  }
  return { processos, cpuDoPc: ultimaLeitura?.cpu ?? null, placa };
});

// ===== Convites: links ozamigos://convite/CODIGO abrem o app no convite de um servidor =====

const PROTOCOLO = 'ozamigos';

/**
 * O link ozamigos:// entre os argumentos (o Windows passa o link ao abrir o app): um convite para um servidor
 * (ozamigos://convite/CODIGO, 1.3.1 em diante) ou uma sala de antes dos servidores (ozamigos://sala/CODIGO, que a
 * página só avisa que não vale mais). O link só traz o código: o servidor continua o configurado no app. Um link que
 * trocasse o servidor seria uma isca para levar a pessoa (e o login dela) a um servidor de outra pessoa.
 */
function linkDosArgumentos(argumentos) {
  for (const argumento of argumentos) {
    if (typeof argumento !== 'string' || !argumento.toLowerCase().startsWith(`${PROTOCOLO}://`)) continue;
    try {
      const link = new URL(argumento);
      const codigo = link.pathname.replace(/^\/+|\/+$/g, '');
      // As mesmas regras do servidor: Servidores.CODIGO (convite) e o código das salas de antes.
      if (link.hostname === 'convite' && /^[A-Za-z0-9]{10}$/.test(codigo)) return { convite: codigo };
      if (link.hostname === 'sala' && /^[A-Za-z0-9]{6,20}$/.test(codigo)) return { sala: codigo };
    } catch {
      // link estragado: o app só abre
    }
  }
  return null;
}

/** A página por onde o app começa, aberto por um link: a do convite; uma sala de antes, a entrada. */
function caminhoDoLink(link) {
  return link?.convite ? `/c/${link.convite}` : null;
}

/**
 * Um link com o app já aberto: a página decide (fora de uma sala, vai ao convite; numa sala, pergunta antes de sair
 * dela). Na tela de início (sem servidor), só mostra a janela.
 */
function abrirLink(link) {
  if (!janela || janela.isDestroyed()) return;
  if (origemDe(janela.webContents.getURL()) !== origemDoServidor()) return;
  if (link.convite) janela.webContents.send('abrir-convite', link.convite);
  else janela.webContents.send('abrir-sala', link.sala);
}

/**
 * O Windows abre o app nos links ozamigos://. Só o app instalado se registra: a versão portátil roda de uma pasta
 * temporária que some ao fechar, e o registro apontaria para o nada. O desinstalador apaga o registro
 * (build/installer.nsh).
 */
function registrarConvites() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  if (!app.setAsDefaultProtocolClient(PROTOCOLO)) console.warn('Não foi possível registrar os links ozamigos://');
}

// ===== Bandeja (o ícone perto do relógio): fechar a janela não encerra o app =====

/** Fechar a janela deixa o app na bandeja? Ligado por padrão; desliga na engrenagem (aba Geral). */
function fecharParaBandeja() {
  return lerConfiguracao().fecharParaBandeja !== false;
}

function mostrarJanela() {
  if (!janela || janela.isDestroyed()) return;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
}

function criarBandeja() {
  bandeja = new Tray(ICONE);
  bandeja.setToolTip('Ozamigos');
  bandeja.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir o Ozamigos', click: mostrarJanela },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() },
    ]),
  );
  bandeja.on('click', mostrarJanela);
}

/** Na primeira vez que a janela vai para a bandeja, explica onde o app foi parar (senão parece que fechou). */
function avisarDaBandejaUmaVez() {
  if (lerConfiguracao().avisouDaBandeja || !Notification.isSupported()) return;
  salvarConfiguracao({ avisouDaBandeja: true });
  const aviso = new Notification({
    title: 'O Ozamigos continua aberto',
    body: 'Ele fica na bandeja, perto do relógio, e a conversa continua. Para sair, clique com o botão direito no ícone e escolha Sair.',
    icon: ICONE,
  });
  aviso.on('click', mostrarJanela);
  aviso.show();
}

ipcMain.handle('bandeja-ler', (evento) => (vindoDaPagina(evento) ? fecharParaBandeja() : null));

ipcMain.on('bandeja-definir', (evento, ligada) => {
  if (vindoDaPagina(evento)) salvarConfiguracao({ fecharParaBandeja: Boolean(ligada) });
});

// ===== Mensagens novas do chat: aviso na barra de tarefas e na bandeja =====

let mensagensNaoLidas = 0;
const marcas = new Map(); // o número escrito -> as imagens, para não redesenhar a cada mensagem

/**
 * A marca das mensagens não lidas (marcaDoChat.js), nos dois tamanhos que o Windows usa (100% e 200% da tela): a
 * bolinha sozinha, para a barra de tarefas, e o ícone com ela no canto de cima, para a bandeja.
 */
function imagensDaMarca(quantas) {
  const texto = textoDaMarca(quantas);
  if (marcas.has(texto)) return marcas.get(texto);
  const juntar = (desenhar) => {
    const imagem = nativeImage.createFromBitmap(desenhar(16), { width: 16, height: 16 });
    imagem.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromBitmap(desenhar(32), { width: 32, height: 32 }).toPNG() });
    return imagem;
  };
  const icone = nativeImage.createFromPath(ICONE);
  const doIcone = (lado) => icone.resize({ width: lado, height: lado, quality: 'best' }).toBitmap();
  const imagens = {
    barra: juntar((lado) => marcaSozinha(quantas, lado)),
    bandeja: juntar((lado) => iconeComMarca(doIcone(lado), lado, quantas)),
  };
  marcas.set(texto, imagens);
  return imagens;
}

/**
 * A página conta as mensagens do chat que a pessoa ainda não viu (e zera quando ela abre o chat). Com alguma: a marca
 * com o número no ícone da barra de tarefas (o Windows a põe no canto de baixo) e no da bandeja (no canto de cima), e o
 * número na dica; chegou uma nova com a janela fora de foco, o ícone pisca até a pessoa voltar. Até a 1.2.20, era um
 * ponto verde sem número, e a bandeja não mudava.
 */
ipcMain.on('nao-lidas', (evento, quantas) => {
  if (!vindoDaPagina(evento) || !janela || janela.isDestroyed()) return;
  const n = Math.max(0, Math.min(999, Math.floor(Number(quantas) || 0)));
  const texto = n === 1 ? '1 mensagem nova no chat' : `${n} mensagens novas no chat`;
  const imagens = n > 0 ? imagensDaMarca(n) : null;
  janela.setOverlayIcon(imagens?.barra ?? null, n > 0 ? texto : '');
  bandeja?.setImage(imagens?.bandeja ?? ICONE);
  bandeja?.setToolTip(n > 0 ? `Ozamigos · ${texto}` : 'Ozamigos');
  if (n > mensagensNaoLidas && !janela.isFocused()) janela.flashFrame(true);
  else if (n === 0) janela.flashFrame(false); // tudo lido (a pessoa abriu o chat): não há mais o que chamar atenção
  mensagensNaoLidas = n;
});

// Alguém da sala chamou a atenção desta pessoa (o "chamado" da página): pisca o ícone até a janela ganhar o foco (o
// 'focus' da janela para de piscar). A página já toca o som e mostra a notificação.
ipcMain.on('chamar-atencao', (evento) => {
  if (!vindoDaPagina(evento) || !janela || janela.isDestroyed() || janela.isFocused()) return;
  janela.flashFrame(true);
});

// ===== Login pelo navegador do sistema (contas, 1.3.0 em diante) =====

/*
 * O Google não deixa entrar dentro de uma janela embutida (disallowed_useragent). Como recomenda a RFC 8252 para apps
 * nativos, o app abre uma porta só no 127.0.0.1 e o navegador do sistema faz o login; no fim, o servidor manda o
 * navegador para essa porta com um código de uso único, e a página troca o código pela sessão (POST /api/conta/codigo),
 * no cookie desta janela. O estado sorteado aqui garante que a volta é do login que este app começou: um link de login
 * forjado por outra pessoa não chega a nada. Ligar mais um provedor é igual, com o código de ligação que a página pediu.
 * Funciona no instalado e na portátil (não depende do ozamigos://).
 */
const PROVEDORES_DE_LOGIN = new Set(['google', 'discord']);
const ESPERA_DO_LOGIN_MS = 5 * 60_000;
const CODIGO_DO_LOGIN = /^[A-Za-z0-9_-]{43}$/;
let loginEmAndamento = null; // { cancelar(motivo) }, enquanto o navegador não volta

/** Resolve { codigo }, { ligou: provedor } ou { erro: motivo }. Só um login por vez: um novo cancela o anterior. */
function loginPeloNavegador(provedor, ligacao) {
  loginEmAndamento?.cancelar('outro-login');
  const http = require('node:http');
  const estado = require('node:crypto').randomBytes(24).toString('base64url');
  return new Promise((resolver) => {
    let terminou = false;
    const local = http.createServer((pedido, resposta) => {
      const url = new URL(pedido.url ?? '/', 'http://127.0.0.1');
      if (pedido.method !== 'GET' || url.pathname !== '/login' || url.searchParams.get('estado') !== estado) {
        resposta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
        return;
      }
      const codigo = url.searchParams.get('codigo');
      const ligou = url.searchParams.get('ligou');
      const erro = url.searchParams.get('erro');
      const resultado =
        codigo && CODIGO_DO_LOGIN.test(codigo) ? { codigo }
        : ligou && PROVEDORES_DE_LOGIN.has(ligou) ? { ligou }
        : { erro: erro && /^[a-z-]{1,40}$/.test(erro) ? erro : 'recusado' };
      resposta.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
      resposta.end(paginaDaVoltaDoLogin(!resultado.erro));
      terminar(resultado);
    });
    const prazo = setTimeout(() => terminar({ erro: 'tempo' }), ESPERA_DO_LOGIN_MS);
    function terminar(resultado) {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      local.close();
      loginEmAndamento = null;
      if (!resultado.erro) mostrarJanela(); // a pessoa está no navegador: o app volta para a frente
      resolver(resultado);
    }
    loginEmAndamento = { cancelar: (motivo) => terminar({ erro: motivo }) };
    local.on('error', () => terminar({ erro: 'porta' }));
    local.listen(0, '127.0.0.1', () => {
      const destino = new URL(`/conta/${ligacao ? 'ligar' : 'entrar'}/${provedor}`, origemDoServidor());
      destino.searchParams.set('app', String(local.address().port));
      destino.searchParams.set('estado', estado);
      if (ligacao) destino.searchParams.set('ligacao', ligacao);
      shell.openExternal(destino.toString()).catch(() => terminar({ erro: 'navegador' }));
    });
  });
}

/** O que o navegador mostra no fim: a pessoa volta para o app (que já veio para a frente). */
function paginaDaVoltaDoLogin(deuCerto) {
  const titulo = deuCerto ? 'Pronto!' : 'O login não terminou';
  const texto = deuCerto
    ? 'Pode fechar esta aba e voltar para o Ozamigos.'
    : 'Volte para o Ozamigos e tente de novo. Esta aba pode ser fechada.';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ozamigos</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e0a;color:#e8ede4;font:16px/1.5 system-ui,sans-serif;text-align:center}
main{padding:24px}h1{color:#b6f24a;font-size:24px;margin:0 0 8px}p{margin:0;color:#a9b3a3}</style></head>
<body><main><h1>${titulo}</h1><p>${texto}</p></main></body></html>`;
}

ipcMain.handle('login-pelo-navegador', (evento, provedor, ligacao) => {
  if (!vindoDaPagina(evento) || !PROVEDORES_DE_LOGIN.has(provedor)) return { erro: 'pedido-invalido' };
  if (ligacao !== undefined && !CODIGO_DO_LOGIN.test(String(ligacao))) return { erro: 'pedido-invalido' };
  return loginPeloNavegador(provedor, ligacao === undefined ? undefined : String(ligacao));
});

// ===== Menu (sem barra de título, ele não aparece: fica pelos atalhos de teclado) =====

function configurarMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Ozamigos',
        submenu: [
          { label: 'Trocar o servidor', click: trocarServidor },
          { type: 'separator' },
          { role: 'reload', label: 'Recarregar' },
          { role: 'togglefullscreen', label: 'Tela cheia' },
          { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' },
          { type: 'separator' },
          { role: 'quit', label: 'Sair' },
        ],
      },
      {
        label: 'Editar',
        submenu: [
          { role: 'undo', label: 'Desfazer' },
          { role: 'redo', label: 'Refazer' },
          { type: 'separator' },
          { role: 'cut', label: 'Recortar' },
          { role: 'copy', label: 'Copiar' },
          { role: 'paste', label: 'Colar' },
          { role: 'selectAll', label: 'Selecionar tudo' },
        ],
      },
    ]),
  );
}

// ===== Atualização automática (pelas releases do GitHub, ao abrir o app) =====

/** Só o app instalado se atualiza: rodando do código ou na versão portátil, não há o que trocar. */
function podeAtualizar() {
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
}

function comPrazo(promessa, milissegundos) {
  return Promise.race([
    promessa,
    new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('demorou demais')), milissegundos)),
  ]);
}

/**
 * Confere se há versão nova. Havendo, baixa mostrando o progresso, instala sem perguntar nada e o app
 * reabre sozinho já atualizado: resolve true (o app vai fechar). Sem versão nova, sem internet ou com
 * qualquer erro, resolve false e o app abre normalmente; a próxima abertura tenta de novo.
 */
async function atualizarSeHouver() {
  if (!podeAtualizar()) return false;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  try {
    // Uma conferência rápida: a internet lenta não pode prender a abertura do app.
    const resultado = await comPrazo(autoUpdater.checkForUpdates(), 6000);
    if (!resultado?.isUpdateAvailable) return false;

    mostrarAvisoDeAtualizacao(resultado.updateInfo.version);
    autoUpdater.on('download-progress', ({ percent }) => mostrarProgresso(percent));
    await autoUpdater.downloadUpdate();
    mostrarProgresso(100, 'Instalando… o Ozamigos abre de novo sozinho.');
    // Sem a tela do instalador (true) e abrindo o app no fim (true).
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 600);
    return true;
  } catch (erro) {
    console.warn('Atualização não conferida ou não baixada:', erro?.message ?? erro);
    return false;
  }
}

function mostrarAvisoDeAtualizacao(versao) {
  avisoDeAtualizacao = new BrowserWindow({
    width: 420,
    height: 190,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#0b0e0a',
    title: 'Atualizando o Ozamigos',
    icon: ICONE,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  avisoDeAtualizacao.once('ready-to-show', () => avisoDeAtualizacao?.show());
  void avisoDeAtualizacao.loadFile(path.join(__dirname, 'atualizando.html')).then(() => {
    mostrarProgresso(0, `Baixando a versão ${versao}…`);
  });
}

function mostrarProgresso(porcento, mensagem) {
  if (!avisoDeAtualizacao || avisoDeAtualizacao.isDestroyed()) return;
  const largura = `${Math.max(0, Math.min(100, Math.round(porcento)))}%`;
  const texto = mensagem ? `document.getElementById('mensagem').textContent = ${JSON.stringify(mensagem)};` : '';
  avisoDeAtualizacao.webContents
    .executeJavaScript(`document.getElementById('progresso').style.width = '${largura}'; ${texto}`)
    .catch(() => {});
}

function fecharAvisoDeAtualizacao() {
  if (avisoDeAtualizacao && !avisoDeAtualizacao.isDestroyed()) avisoDeAtualizacao.destroy();
  avisoDeAtualizacao = null;
}

// ===== Início do app =====

// Um Ozamigos aberto por vez: abrir de novo só traz a janela para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Abrir de novo (atalho, ou um convite ozamigos://) traz a janela para a frente, inclusive da bandeja.
  app.on('second-instance', (_evento, argumentos) => {
    mostrarJanela();
    const link = linkDosArgumentos(argumentos);
    if (link) abrirLink(link);
  });

  app.setAppUserModelId('dev.ozamigos.share'); // necessário para as notificações do Windows
  nativeTheme.themeSource = 'dark';

  app.whenReady().then(async () => {
    // Conferir a versão nova leva ~0,5–1 s (GitHub); a interface carrega ao mesmo tempo, com a janela escondida.
    // Havendo versão nova, a janela nunca aparece: o instalador fecha e reabre o app já atualizado.
    const atualizando = atualizarSeHouver();
    await limparCacheSeAtualizou();
    configurarMenu();
    configurarSessao();
    criarJanela(atualizando);
    criarBandeja();
    honrarRelogioFino();
    registrarConvites();
    if (!(await atualizando)) fecharAvisoDeAtualizacao(); // se o download falhou no meio; só depois da janela, senão o app fecharia
  });

  app.on('window-all-closed', () => app.quit());
  // Sair de verdade (menu da bandeja, atualização, desligar o Windows): a janela fecha em vez de ir para a bandeja.
  app.on('before-quit', () => {
    saindo = true;
  });
  app.on('will-quit', () => {
    desligarAuxiliarDeSom();
    desligarCapturaDeVideo();
  });
}
