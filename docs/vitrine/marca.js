// Gera em docs/imagens:
// - logo-tema-escuro.png e logo-tema-claro.png: o logotipo com fundo transparente (2x), um para cada tema do GitHub;
// - social.png (1280x640): a prévia de link, enviada à mão em Settings → Social preview.
// A social.png usa a docs/imagens/sala-grade.png: rode captura.js antes, se a interface mudou.
// Uso, a partir da raiz: desktop\node_modules\.bin\electron docs\vitrine\marca.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});

const IMAGENS = path.join(__dirname, '..', 'imagens');

async function abrir(modo, largura, altura, escala) {
  const w = new BrowserWindow({
    width: largura * escala,
    height: altura * escala,
    useContentSize: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  await w.loadFile(path.join(__dirname, 'marca.html'), { query: { modo } });
  w.webContents.setZoomFactor(escala);
  await w.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))');
  return w;
}

async function logo(modo, arquivo) {
  const escala = 2;
  const w = await abrir(modo, 900, 200, escala);
  // Recorta só o logotipo: a imagem fica do tamanho exato dele.
  const r = await w.webContents.executeJavaScript(
    'JSON.parse(JSON.stringify(document.getElementById("logo").getBoundingClientRect()))',
  );
  const img = await w.webContents.capturePage({
    x: Math.floor(r.x * escala),
    y: Math.floor(r.y * escala),
    width: Math.ceil(r.width * escala),
    height: Math.ceil(r.height * escala),
  });
  fs.writeFileSync(path.join(IMAGENS, arquivo), img.toPNG());
  console.log(arquivo, img.getSize());
  w.destroy();
}

async function social() {
  const w = await abrir('social', 1280, 640, 1);
  const img = await w.webContents.capturePage();
  fs.writeFileSync(path.join(IMAGENS, 'social.png'), img.toPNG());
  console.log('social.png', img.getSize());
  w.destroy();
}

app.whenReady().then(async () => {
  await logo('tema-escuro', 'logo-tema-escuro.png');
  await logo('tema-claro', 'logo-tema-claro.png');
  await social();
  app.quit();
});
