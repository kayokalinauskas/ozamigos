// Gera as telas e o GIF do README: cinco amigos fictícios numa sala do servidor local (porta 8090,
// senha "teste"), cada um com um "jogo" desenhado por código (jogo-falso.js) e um microfone falso.
// Na voz, a Ana está falando (anel verde) e o Caio está com o microfone desligado.
// Uso, a partir da raiz do repositório, com o servidor rodando e o ffmpeg no PATH:
//   desktop\node_modules\.bin\electron docs\vitrine\captura.js
// As imagens saem em docs/imagens. Depois, para o logo e a prévia de link: desktop\node_modules\.bin\electron docs\vitrine\marca.js
const { app, BrowserWindow, session } = require('electron');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AQUI = __dirname;
const SAIDA = path.join(AQUI, '..', 'imagens');
const QUADROS = path.join(os.tmpdir(), 'ozamigos-quadros');
const SALA = `${process.env.OZAMIGOS_SERVIDOR ?? 'http://localhost:8090'}/?sala=Ozamigos26`;

// O microfone falso de todos toca um zumbido grave. A sensibilidade automática não o confunde com voz, então só
// abre o microfone de quem tem a sensibilidade manual no mínimo (a Ana): é ela que aparece falando.
const ZUMBIDO = path.join(os.tmpdir(), 'ozamigos-zumbido.wav');
{
  const amostras = 48000 * 4;
  const b = Buffer.alloc(44 + amostras * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + amostras * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(amostras * 2, 40);
  for (let i = 0; i < amostras; i++) {
    const t = i / 48000;
    b.writeInt16LE(Math.round((Math.sin(2 * Math.PI * 150 * t) * 0.15 + Math.sin(2 * Math.PI * 300 * t) * 0.08) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(ZUMBIDO, b);
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', ZUMBIDO);
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

async function abrir(w, ajustesDeVoz) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await w.loadURL(SALA);
      if (ajustesDeVoz) {
        // Os ajustes de voz são lidos quando a página abre: grava e abre de novo.
        await w.webContents.executeJavaScript(`localStorage.setItem('ozamigos-voz', ${JSON.stringify(JSON.stringify(ajustesDeVoz))})`);
        await w.loadURL(SALA);
      }
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
    // 720p a 30 fps: é o que as fotos mostram, e quatro codificações em 1080p num PC só engasgam a bancada.
    const qualidade = document.querySelector('.controles select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(qualidade, 'leve');
    qualidade.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.menu-transmitir > button').click();
    await new Promise((r) => setTimeout(r, 200));
    document.querySelectorAll('.menu button')[1].click();
    await new Promise((r) => setTimeout(r, 800));`);
}

const assistirPeloCodigo = (w, nome) => js(w, `document.querySelector('[aria-label="Assistir ${nome}"]')?.click();`);

// Espera o elemento aparecer (até 6 s): com o PC ocupado, o aviso de "começou a transmitir" pode demorar.
async function centro(w, seletor) {
  for (let tentativa = 0; tentativa < 30; tentativa++) {
    const r = await js(w, `const e = document.querySelector(${JSON.stringify(seletor)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, w: b.width };`);
    if (r) return r;
    await espera(200);
  }
  throw new Error('não achei ' + seletor);
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

// A bancada roda cinco PCs num só e às vezes engasga: a foto espera todas as transmissões saudáveis (até 1 min).
async function esperarSaude(w) {
  for (let i = 0; i < 60; i++) {
    const ok = await js(w, `const s = [...document.querySelectorAll('.saude')].map((e) => e.textContent); return s.length > 0 && s.every((t) => !t.includes('instável') && +(t.match(/(\\d+) fps/) || [0, 0])[1] >= 24);`);
    if (ok) return;
    await espera(1000);
  }
  console.log('aviso: as transmissões não ficaram todas saudáveis; foto assim mesmo');
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
      // Cinco capturas de microfone num PC só pesam: quem não é fotografado usa a voz no modo mais leve.
      const leve = { supressao: 'nenhuma', cancelarEco: false, ganhoAutomatico: false };
      await abrir(w, nome === 'Ana' ? { ...leve, sensibilidadeAutomatica: false, limiarDb: -100 } : leve);
      await entrar(w, nome);
    }
    await js(caio, `document.querySelector('[aria-label="Desligar o microfone"]').click()`);
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
    await espera(15000); // a folga de rede e a qualidade se acertam antes da foto
    await esperarSaude(duda);
    await foto(duda, 'sala-grade.png', 1600);
    await js(duda, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Estatísticas')).click();`);
    await espera(300);
    await mover(duda, await centro(duda, '[aria-label="Transmissão de Ana"]'), 50);
    await clicar(duda, await centro(duda, '[aria-label="Destacar Ana"]'));
    await mover(duda, { x: 1910, y: 1075 }, 50);
    await duda.webContents.executeJavaScript(`window.__cursor(-200, -200)`);
    await espera(15000);
    await esperarSaude(duda);
    await foto(duda, 'sala-destaque.png', 1600);

    // 6. A engrenagem da voz, só a caixa, em 2x (para o site): sala em 1440x900, ampliada.
    await js(duda, `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Estatísticas')).click();`);
    duda.setContentSize(2880, 1800);
    duda.webContents.setZoomFactor(2);
    await espera(500);
    await js(duda, `document.querySelector('[aria-label="Configurações de voz e áudio"]').click();`);
    await espera(2500); // o medidor anda com o microfone falso
    const caixa = await js(duda, `const b = document.querySelector('dialog.configuracoes').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height };`);
    const voz = await duda.webContents.capturePage({ x: Math.round(caixa.x * 2), y: Math.round(caixa.y * 2), width: Math.round(caixa.width * 2), height: Math.round(caixa.height * 2) });
    fs.writeFileSync(path.join(SAIDA, 'voz.png'), voz.toPNG());
    console.log('foto voz.png', voz.getSize());
  } catch (erro) {
    console.error('falhou:', erro);
  }
  app.quit();
});
