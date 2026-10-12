// Gera docs/imagens/capa.png (1280x400 em 2x, cantos transparentes) e docs/imagens/social.png
// (1280x640, a prévia de link do GitHub). A capa usa a docs/imagens/sala-grade.png: rode captura.js antes.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});

async function gerar(modo, largura, altura, escala, arquivo) {
  const w = new BrowserWindow({
    width: largura * escala,
    height: altura * escala,
    useContentSize: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  await w.loadFile(path.join(__dirname, 'capa.html'), { search: modo });
  w.webContents.setZoomFactor(escala);
  await w.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))');
  const img = await w.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', 'imagens', arquivo), img.toPNG());
  console.log(arquivo, img.getSize());
  w.destroy();
}

app.whenReady().then(async () => {
  await gerar('capa', 1280, 400, 2, 'capa.png');
  await gerar('social', 1280, 640, 1, 'social.png');
  app.quit();
});
