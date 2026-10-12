// O app para Windows. Ele abre a interface que o servidor do Ozamigos já serve (a mesma do navegador)
// e acrescenta o que só um app consegue: o seletor de janelas e telas, o som do PC sem o Discord
// e sem o próprio app, notificações do Windows, e não ser freado quando fica atrás do jogo.

const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, nativeTheme, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// O app se chamava "Ozamigos Share". Com o nome novo, o Electron guardaria tudo numa pasta nova
// e cada um perderia o servidor, o nome, a senha e os volumes: por isso a pasta continua a antiga.
app.setPath('userData', path.join(app.getPath('appData'), 'Ozamigos Share'));

const SERVIDOR_PADRAO = process.env.OZAMIGOS_SERVIDOR || require('./package.json').ozamigos.servidor || '';
// Endereços oficiais que já foram desligados. Quem os tiver guardado volta sozinho para o padrão.
const SERVIDORES_APOSENTADOS = new Set(['https://ozamigos-share-app.onrender.com']);
const ARQUIVO_DE_CONFIGURACAO = path.join(app.getPath('userData'), 'configuracao.json');
const PERMISSOES = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);

let janela = null;
let pedidoDeFonte = null; // { responder, fontes } enquanto o seletor está aberto
let auxiliarDeSom = null; // o OzamigosSom.exe, enquanto alguém transmite com som
let ligandoAuxiliar = null; // Promise enquanto o auxiliar está abrindo

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

function abrirServidorOuInicio(erro) {
  if (!erro && origemDoServidor()) {
    // Sempre pergunta ao servidor pela página: um deploy novo aparece na hora, nunca a cópia guardada.
    janela.loadURL(`${origemDoServidor()}/`, { extraHeaders: 'pragma: no-cache\ncache-control: no-cache\n' });
  } else {
    janela.loadFile(path.join(__dirname, 'inicio.html'), { query: erro ? { erro } : {} });
  }
}

function criarJanela() {
  const { posicao = {} } = lerConfiguracao();
  janela = new BrowserWindow({
    width: posicao.width ?? 1600,
    height: posicao.height ?? 940,
    x: posicao.x,
    y: posicao.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true, // o menu aparece com Alt
    title: 'Ozamigos',
    icon: path.join(__dirname, 'build', 'icone.png'),
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
  janela.once('ready-to-show', () => janela.show());

  // Lembra o tamanho e a posição para a próxima vez.
  janela.on('close', () => {
    salvarConfiguracao({ posicao: { ...janela.getNormalBounds(), maximizada: janela.isMaximized() } });
  });

  const conteudo = janela.webContents;
  // A janela só navega dentro do servidor; qualquer outro link abre no navegador de verdade.
  conteudo.on('will-navigate', (evento, url) => {
    if (url.startsWith('file:') || origemDe(url) === origemDoServidor()) return;
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

  abrirServidorOuInicio();
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
        miniatura: fonte.thumbnail.toDataURL(),
        icone: fonte.appIcon && !fonte.appIcon.isEmpty() ? fonte.appIcon.toDataURL() : null,
      })),
    );
  });

  // Devolve { somDoApp: true } quando o som vem do auxiliar: a página então junta essa faixa ao vídeo.
  ipcMain.handle('fonte-escolhida', async (evento, escolha) => {
    if (!pedidoDeFonte || origemDe(evento.senderFrame?.url) !== origemDoServidor()) return { somDoApp: false };
    const { responder, fontes } = pedidoDeFonte;
    pedidoDeFonte = null;
    const fonte = escolha && fontes.find((f) => f.id === escolha.id);
    if (!fonte) {
      responder(null); // a pessoa cancelou
      return { somDoApp: false };
    }
    if (!escolha.audio) {
      responder({ video: fonte });
      return { somDoApp: false };
    }
    const somDoApp = await ligarAuxiliarDeSom();
    // Se o auxiliar não rodar (Windows antigo demais), vai o som do Windows inteiro, como no navegador.
    responder(somDoApp ? { video: fonte } : { video: fonte, audio: 'loopback' });
    return { somDoApp };
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
      if (inteiros > 0) janela.webContents.send('som', tudo.subarray(0, inteiros));
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

// ===== Tela de início (escolher o servidor) =====

function vindoDoInicio(evento) {
  return Boolean(evento.senderFrame?.url?.startsWith('file:'));
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

ipcMain.on('trocar-servidor', (evento) => {
  if (origemDe(evento.senderFrame?.url) === origemDoServidor()) trocarServidor();
});

function trocarServidor() {
  janela?.loadFile(path.join(__dirname, 'inicio.html'));
}

// ===== Menu (escondido; aparece com Alt) =====

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

// ===== Início do app =====

// Um Ozamigos aberto por vez: abrir de novo só traz a janela para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  });

  app.setAppUserModelId('dev.ozamigos.share'); // necessário para as notificações do Windows
  nativeTheme.themeSource = 'dark';

  app.whenReady().then(async () => {
    await limparCacheSeAtualizou();
    configurarMenu();
    configurarSessao();
    criarJanela();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', desligarAuxiliarDeSom);
}
