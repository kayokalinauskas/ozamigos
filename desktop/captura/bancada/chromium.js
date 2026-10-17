// Bancada da captura: o fps da captura do Chromium (o caminho do app) por 15 s. Rodar de desktop/ com o jogo.js aberto:
// node_modules\.bin\electron capturaancada\chromium.js (FPS=60 para pedir 60 fps).
// Só a captura do Chromium (a DesktopCaptureDevice do getDisplayMedia do app), por N segundos.
const { app, BrowserWindow, desktopCapturer } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const SEGUNDOS = 15;
const CAPTURA = `<!doctype html><script>
window.medir = async (id, segundos, fps) => {
  const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 1280, maxHeight: 720, maxFrameRate: fps, minFrameRate: 10 } } });
  const trilha = s.getVideoTracks()[0];
  const leitor = new MediaStreamTrackProcessor({ track: trilha }).readable.getReader();
  const porSegundo = []; let n = 0, inicio = performance.now(); const fim = inicio + segundos * 1000;
  while (performance.now() < fim) { const { value } = await leitor.read(); value?.close(); n++;
    if (performance.now() - inicio >= 1000) { porSegundo.push(n); n = 0; inicio = performance.now(); } }
  trilha.stop(); return porSegundo;
};</script>`;
app.whenReady().then(async () => {
  const [fonte] = await desktopCapturer.getSources({ types: ['screen'] });
  const w = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  w.webContents.session.setPermissionRequestHandler((_w, _p, ok) => ok(true));
  const arq = path.join(__dirname, 'captura.html'); fs.writeFileSync(arq, CAPTURA);
  await w.loadFile(arq);
  const r = await w.webContents.executeJavaScript(`window.medir(${JSON.stringify(fonte.id)}, ${SEGUNDOS}, ${Number(process.env.FPS || 30)})`);
  console.log(JSON.stringify({ chromiumFpsPorSegundo: r }));
  app.quit();
});
