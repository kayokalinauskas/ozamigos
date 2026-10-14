// O app para Windows. Ele abre a interface que o servidor do Ozamigos já serve (a mesma do navegador)
// e acrescenta o que só um app consegue: o seletor de janelas e telas, o som do PC sem o Discord
// e sem o próprio app, notificações do Windows, e não ser freado quando fica atrás do jogo.

const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, nativeTheme, session, shell } = require('electron');
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
const PERMISSOES = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);

let janela = null;
let pedidoDeFonte = null; // { responder, fontes } enquanto o seletor está aberto
let auxiliarDeSom = null; // o OzamigosSom.exe, enquanto alguém transmite com som
let ligandoAuxiliar = null; // Promise enquanto o auxiliar está abrindo
let avisoDeAtualizacao = null; // a janelinha "Baixando a versão nova", enquanto baixa

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

function abrirServidorOuInicio(erro) {
  if (!erro && origemDoServidor()) {
    // Sempre pergunta ao servidor pela página: um deploy novo aparece na hora, nunca a cópia guardada.
    janela.loadURL(`${origemDoServidor()}/`, { extraHeaders: 'pragma: no-cache\ncache-control: no-cache\n' });
  } else {
    janela.loadFile(INICIO, { query: erro ? { erro } : {} });
  }
}

// Os botões da janela (minimizar, maximizar, fechar) desenhados pelo Windows, por cima da página.
const BARRA_DA_JANELA = { color: '#0b0e0a', symbolColor: '#c9d4bb', height: 32 };

/** atualizando: resolve true se o app vai fechar para instalar uma versão nova (a janela nem aparece). */
function criarJanela(atualizando) {
  const { posicao = {} } = lerConfiguracao();
  janela = new BrowserWindow({
    width: posicao.width ?? 1600,
    height: posicao.height ?? 940,
    x: posicao.x,
    y: posicao.y,
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
  janela.on('close', () => {
    salvarConfiguracao({ posicao: { ...janela.getNormalBounds(), maximizada: janela.isMaximized() } });
  });

  const conteudo = janela.webContents;
  // Dentro do evento, isFullScreen() ainda pode responder o estado antigo: cada evento manda o seu.
  janela.on('enter-full-screen', () => conteudo.send('tela-cheia', true));
  janela.on('leave-full-screen', () => conteudo.send('tela-cheia', false));
  conteudo.on('did-finish-load', () => conteudo.send('tela-cheia', janela.isFullScreen()));
  // Recarregou no meio de um teste de desempenho: os contadores do Windows param junto.
  conteudo.on('did-start-navigation', (detalhes) => {
    if (detalhes.isMainFrame && !detalhes.isSameDocument) desligarContadores();
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
        // JPEG: 10 vezes mais rápido de gerar e um terço do tamanho do PNG (medido: 5 ms e 205 KB contra 55 ms e 700 KB).
        miniatura: `data:image/jpeg;base64,${fonte.thumbnail.toJPEG(80).toString('base64')}`,
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
  janela?.loadFile(INICIO);
}

const vindoDaPagina = (evento) => origemDe(evento.senderFrame?.url) === origemDoServidor();

// ===== Estatísticas da sala (Ctrl+Shift+G na sala): salvas sozinhas em Documentos\Ozamigos\Estatísticas =====

const pastaDasEstatisticas = () => path.join(app.getPath('documents'), 'Ozamigos', 'Estatísticas');
// Só um nome, nunca um caminho: a página não escolhe onde gravar no disco.
const nomeSeguro = (texto) => typeof texto === 'string' && /^[^\\/:*?"<>|\x00-\x1f]{1,120}$/.test(texto) && !/^[. ]|[. ]$/.test(texto);

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
  app.on('second-instance', () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.focus();
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
    if (!(await atualizando)) fecharAvisoDeAtualizacao(); // se o download falhou no meio; só depois da janela, senão o app fecharia
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', desligarAuxiliarDeSom);
}
