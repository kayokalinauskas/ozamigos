// Bancada da captura (veja "Captura própria" no AGENTS.md). Rodar de desktop/: node_modules/.bin/electron captura/bancada/jogo.js
// O "jogo", num processo só dele: tela cheia, sem limite de fps. Grava o fps em jogo.log a cada segundo;
// trava a carga quando aparece travar.flag e fecha quando aparece sair.flag.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const log = path.join(__dirname, 'jogo.log');
fs.writeFileSync(log, '');
app.whenReady().then(async () => {
  const tela = screen.getPrimaryDisplay();
  const j = new BrowserWindow({ ...tela.bounds, frame: false, fullscreen: true, webPreferences: { backgroundThrottling: false } });
  await j.loadFile(path.join(__dirname, 'jogo.html'));
  setInterval(async () => {
    if (fs.existsSync(path.join(__dirname, 'sair.flag'))) { app.quit(); return; }
    if (fs.existsSync(path.join(__dirname, 'travar.flag'))) await j.webContents.executeJavaScript('window.travado = true');
    const [fps, voltas] = await j.webContents.executeJavaScript('[window.fpsDoJogo, window.voltas]');
    fs.appendFileSync(log, JSON.stringify({ t: Date.now(), fps, voltas }) + '\n');
  }, 1000);
});
