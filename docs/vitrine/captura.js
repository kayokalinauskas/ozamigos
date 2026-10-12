// Gera as telas e o GIF do README: cinco amigos fictícios numa sala do servidor local (porta 8090,
// senha "teste"), cada um com um "jogo" desenhado por código (jogo-falso.js).
// Uso, a partir da raiz do repositório, com o servidor rodando e o ffmpeg no PATH:
//   desktop\node_modules\.bin\electron docs\vitrine\captura.js
// As imagens saem em docs/imagens. Depois, para a capa: desktop\node_modules\.bin\electron docs\vitrine\capa.js
const { app, BrowserWindow, session } = require('electron');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const AQUI = __dirname;
const SAIDA = path.join(AQUI, '..', 'imagens');
const QUADROS = path.join(os.tmpdir(), 'ozamigos-quadros');
const SALA = 'http://localhost:8090/?sala=Ozamigos26';
const JOGO = fs.readFileSync(path.join(AQUI, 'jogo-falso.js'), 'utf8');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR = `(() => {
  if (window.__cursor) return;
  const c = document.createElement('div');
  c.innerHTML = '<svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7.2 1.4L9.6 20z" fill="#fff" stroke="#0f130e" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' });
  document.body.appendChild(c);
  window.__cursor = (x, y) => { c.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px)'; };
  window.__clique = (x, y) => {
    const o = document.createElement('div');
    Object.assign(o.style, { position: 'fixed', left: (x - 22) + 'px', top: (y - 22) + 'px', width: '44px', height: '44px', borderRadius: '50%', border: '3px solid #b6f24a', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s, opacity .45s' });
    document.body.appendChild(o);
    requestAnimationFrame(() => { o.style.transform = 'scale(1.6)'; o.style.opacity = '0'; });
    setTimeout(() => o.remove(), 600);
  };
})()`;

function janela(nome, largura, altura) {
  const sessao = session.fromPartition('demo-' + nome + '-' + Date.now());
  // Nada de notificação de verdade na área de trabalho de quem roda o script.
  sessao.setPermissionRequestHandler((_wc, permissao, ok) => ok(permissao !== 'notifications'));
  sessao.setPermissionCheckHandler((_wc, permissao) => permissao !== 'notifications');
  const w = new BrowserWindow({
    width: largura,
    height: altura,
    useContentSize: true,
    show: false,
    webPreferences: { offscreen: true, session: sessao, backgroundThrottling: false },
  });
  w.webContents.setAudioMuted(true);
  w.webContents.setFrameRate(30);
  return w;
}

const js = (w, codigo) => w.webContents.executeJavaScript(`(async () => { ${codigo} })()`, true);

async function abrir(w) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await w.loadURL(SALA);
      break;
    } catch (erro) {
      console.log('carregar falhou, tentativa', tentativa, erro.code);
      if (tentativa === 4) throw erro;
      await espera(700);
    }
  }
  await w.webContents.executeJavaScript(JOGO);
}

async function entrar(w, nome) {
  await js(w, `
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const [n, p] = document.querySelectorAll('.cartao-entrada input');
    s.call(n, ${JSON.stringify(nome)}); n.dispatchEvent(new Event('input', { bubbles: true }));
    s.call(p, 'teste'); p.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    document.querySelector('.cartao-entrada button[type=submit]').click();
    await new Promise((r) => setTimeout(r, 1200));`);
}

async function transmitir(w, estilo) {
  await js(w, `
    window.__prepararJogo(${JSON.stringify(estilo)});
    document.querySelector('.menu-transmitir > button').click();
    await new Promise((r) => setTimeout(r, 200));
    document.querySelectorAll('.menu button')[1].click();
    await new Promise((r) => setTimeout(r, 800));`);
}

const assistirPeloCodigo = (w, nome) => js(w, `document.querySelector('[aria-label="Assistir ${nome}"]')?.click();`);

async function centro(w, seletor) {
  const r = await js(w, `const e = document.querySelector(${JSON.stringify(seletor)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, w: b.width };`);
  if (!r) throw new Error('não achei ' + seletor);
  return r;
}

// Mouse de verdade (para :hover funcionar) e o cursor desenhado por cima, para o GIF.
let posicao = { x: 720, y: 450 };
async function mover(w, alvo, ms = 550) {
  const passos = Math.max(1, Math.round(ms / 30));
  const de = { ...posicao };
  for (let i = 1; i <= passos; i++) {
    const t = i / passos;
    const s = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const x = Math.round(de.x + (alvo.x - de.x) * s);
    const y = Math.round(de.y + (alvo.y - de.y) * s);
    w.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await w.webContents.executeJavaScript(`window.__cursor(${x}, ${y})`);
    await espera(30);
  }
  posicao = { ...alvo };
}

async function clicar(w, alvo) {
  await mover(w, alvo);
  await espera(120);
  w.webContents.sendInputEvent({ type: 'mouseDown', x: alvo.x, y: alvo.y, button: 'left', clickCount: 1 });
  w.webContents.sendInputEvent({ type: 'mouseUp', x: alvo.x, y: alvo.y, button: 'left', clickCount: 1 });
  await w.webContents.executeJavaScript(`window.__clique(${alvo.x}, ${alvo.y})`);
}

async function arrastar(w, de, para, ms = 900) {
  await mover(w, de);
  w.webContents.sendInputEvent({ type: 'mouseDown', x: de.x, y: de.y, button: 'left', clickCount: 1 });
  await mover(w, para, ms);
  w.webContents.sendInputEvent({ type: 'mouseUp', x: para.x, y: para.y, button: 'left', clickCount: 1 });
}

async function foto(w, arquivo, largura) {
  let img = await w.webContents.capturePage();
  if (largura) img = img.resize({ width: largura, quality: 'best' });
  fs.writeFileSync(path.join(SAIDA, arquivo), img.toPNG());
  console.log('foto', arquivo, img.getSize());
}

// Quadros -> GIF de 960 px com paleta própria (cerca de 4,5 MB para 18 s).
function gerarGif() {
  const filtro =
    'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];' +
    '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-vf', filtro, '-loop', '0', path.join(SAIDA, 'demo.gif')], { cwd: QUADROS, stdio: 'inherit' });
  console.log(r.status === 0 ? 'demo.gif gerado' : 'ffmpeg falhou (está no PATH?)');
}

let gravando = false;
async function gravar(w) {
  fs.rmSync(QUADROS, { recursive: true, force: true });
  fs.mkdirSync(QUADROS, { recursive: true });
  let i = 0;
  const momentos = [];
  const inicio = Date.now();
  while (gravando) {
    const t0 = Date.now();
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(QUADROS, `q${String(i++).padStart(4, '0')}.jpg`), img.toJPEG(94));
    momentos.push(Date.now() - inicio);
    await espera(Math.max(0, 80 - (Date.now() - t0)));
  }
  const segundos = (Date.now() - inicio) / 1000;
  // Duração real de cada quadro, para o GIF andar no tempo certo mesmo se a captura oscilar.
  const nome = (k) => `q${String(k).padStart(4, '0')}.jpg`;
  const linhas = momentos.map((m, k) => `file '${nome(k)}'\nduration ${(((momentos[k + 1] ?? m + 80) - m) / 1000).toFixed(3)}`);
  fs.writeFileSync(path.join(QUADROS, 'lista.txt'), `${linhas.join('\n')}\nfile '${nome(i - 1)}'\n`);
  console.log('gravados', i, 'quadros em', segundos.toFixed(1), 's');
}

app.on('window-all-closed', () => {}); // sem isso, fechar a janela da entrada encerraria o script

app.whenReady().then(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  try {
    // 1. Tela de entrada, com o nome já preenchido.
    const entrada = janela('entrada', 1440, 900);
    await abrir(entrada);
    await js(entrada, `
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const [n, p] = document.querySelectorAll('.cartao-entrada input');
      s.call(n, 'Duda'); n.dispatchEvent(new Event('input', { bubbles: true }));
      s.call(p, 'senhadogrupo'); p.dispatchEvent(new Event('input', { bubbles: true }));
      document.activeElement?.blur();`);
    await espera(800);
    await foto(entrada, 'entrada.png');
    entrada.destroy();

    // 2. Os amigos: Ana e Beto já transmitem; Caio está na sala, ainda sem transmitir.
    const ana = janela('ana', 960, 600);
    const beto = janela('beto', 960, 600);
    const caio = janela('caio', 960, 600);
    const eli = janela('eli', 960, 600);
    for (const [w, nome] of [[ana, 'Ana'], [beto, 'Beto'], [caio, 'Caio'], [eli, 'Eli']]) {
      w.webContents.setFrameRate(4); // ninguém fotografa essas janelas: menos trabalho para a placa de vídeo
      await abrir(w);
      await entrar(w, nome);
    }
    await transmitir(ana, 'corrida');
    await transmitir(beto, 'espaco');
    await transmitir(eli, 'estrategia');

    // 3. Duda, a janela que vira GIF e prints, em 1920x1080.
    const duda = janela('duda', 1440, 810);
    await abrir(duda);
    await entrar(duda, 'Duda');
    await duda.webContents.executeJavaScript(CURSOR);
    await assistirPeloCodigo(duda, 'Ana');
    await espera(4000);

    // 4. GIF: Caio começa a transmitir, Duda assiste pelo aviso, assiste o Beto, baixa o volume dele e destaca o Caio.
    gravando = true;
    const gravacao = gravar(duda);
    await espera(600);
    await mover(duda, { x: 860, y: 520 }, 500);
    await transmitir(caio, 'plataforma');
    await espera(700);
    await clicar(duda, await centro(duda, '.avisos .botao-primario'));
    await espera(2200);
    await clicar(duda, await centro(duda, '[aria-label="Assistir Beto"]'));
    await espera(2400);
    const volume = await centro(duda, 'input[aria-label="Volume de Beto"]');
    await mover(duda, { x: volume.x, y: volume.y - 160 }, 400); // passa por cima do vídeo: os controles aparecem
    await espera(250);
    await arrastar(duda, { x: Math.round(volume.l + volume.w - 6), y: volume.y }, { x: Math.round(volume.l + volume.w * 0.3), y: volume.y }, 900);
    await espera(900);
    const caioVideo = await centro(duda, '[aria-label="Transmissão de Caio"]');
    await mover(duda, caioVideo, 500);
    await espera(250);
    await clicar(duda, await centro(duda, '[aria-label="Destacar Caio"]'));
    await espera(2600);
    gravando = false;
    await gravacao;
    gerarGif();

    // 5. Prints: grade com as três transmissões, e destaque com as estatísticas abertas.
    duda.setContentSize(1920, 1080);
    await mover(duda, { x: 1890, y: 1060 }, 200);
    await duda.webContents.executeJavaScript(`window.__cursor(-200, -200)`);
    await assistirPeloCodigo(duda, 'Eli');
    await js(duda, `document.querySelector('.segmentado button[title="Grade"]').click();`);
    await espera(6000);
    await foto(duda, 'sala-grade.png', 1600);
    await js(duda, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Estatísticas')).click();`);
    await espera(300);
    await mover(duda, await centro(duda, '[aria-label="Transmissão de Ana"]'), 50);
    await clicar(duda, await centro(duda, '[aria-label="Destacar Ana"]'));
    await mover(duda, { x: 1910, y: 1075 }, 50);
    await duda.webContents.executeJavaScript(`window.__cursor(-200, -200)`);
    await espera(8000);
    await foto(duda, 'sala-destaque.png', 1600);
  } catch (erro) {
    console.error('falhou:', erro);
  }
  app.quit();
});
