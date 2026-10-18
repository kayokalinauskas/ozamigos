// A vazão do caminho processo principal → página: quantos quadros NV12 por segundo chegam, e com quanto atraso, por
// três caminhos. Cada quadro só sai com a página tendo confirmado o anterior (no máximo 2 no caminho), como no app.
//   ipc:      webContents.send + ipcRenderer.on no preload (o caminho do app 1.2.18)
//   porta:    um MessagePort do principal entregue à página (o preload repassa a porta para o mundo da página)
//   trabalho: a mesma porta, entregue a um Worker da página, que monta o VideoFrame fora da thread principal
// Rodar de desktop/: node_modules/.bin/electron captura/bancada/vazao.js
const { app, BrowserWindow, MessageChannelMain, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SEGUNDOS = 6;
const TAMANHOS = [
  [1280, 720],
  [1920, 1080],
];

const PRELOAD = `
const { ipcRenderer } = require('electron');
ipcRenderer.on('quadro', (_e, dados) => { window.postMessage({ tipo: 'ipc', dados }, '*'); });
ipcRenderer.on('porta', (e) => { window.postMessage({ tipo: 'porta' }, '*', [e.ports[0]]); });
`;

const PAGINA = `<!doctype html><body><script>
let recebidos = 0, atrasos = [];
const gerador = new MediaStreamTrackGenerator({ kind: 'video' });
const escritor = gerador.writable.getWriter();
function quadro(bytes, confirmar) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, 24);
  atrasos.push(Date.now() - v.getFloat64(16, true));
  const f = new VideoFrame(bytes.subarray(24), { format: 'NV12', codedWidth: v.getUint16(4, true), codedHeight: v.getUint16(6, true), timestamp: recebidos * 16666 });
  escritor.write(f).catch(() => f.close());
  recebidos++;
  confirmar();
}
window.addEventListener('message', (m) => {
  if (m.data?.tipo === 'ipc') quadro(m.data.dados, () => window.postMessage({ tipo: 'ok' }, '*'));
  if (m.data?.tipo === 'porta') {
    const porta = m.ports[0];
    if (location.hash === '#trabalho') {
      const w = new Worker(URL.createObjectURL(new Blob([\`
        onmessage = (m) => { const porta = m.ports[0]; porta.onmessage = (e) => {
          const bytes = new Uint8Array(e.data); const v = new DataView(bytes.buffer, 0, 24);
          const f = new VideoFrame(bytes.subarray(24), { format: 'NV12', codedWidth: v.getUint16(4, true), codedHeight: v.getUint16(6, true), timestamp: Date.now() * 1000 });
          postMessage({ f, capturado: v.getFloat64(16, true) }, [f]); porta.postMessage('ok'); }; porta.start(); };\`], { type: 'text/javascript' })));
      w.onmessage = (e) => { atrasos.push(Date.now() - e.data.capturado); escritor.write(e.data.f).catch(() => e.data.f.close()); recebidos++; };
      w.postMessage(null, [porta]);
    } else {
      porta.onmessage = (e) => quadro(new Uint8Array(e.data), () => porta.postMessage('ok'));
      porta.start();
    }
  }
});
window.medir = () => { const r = { recebidos, atrasoMedio: atrasos.reduce((a, b) => a + b, 0) / (atrasos.length || 1), atrasoMax: Math.max(0, ...atrasos) }; recebidos = 0; atrasos = []; return r; };
</script></body>`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ozamigos-vazao-'));
  fs.writeFileSync(path.join(dir, 'preload.js'), PRELOAD);
  fs.writeFileSync(path.join(dir, 'pagina.html'), PAGINA);
  for (const caminho of ['ipc', 'porta', 'trabalho']) {
    for (const [L, A] of TAMANHOS) {
      const janela = new BrowserWindow({ show: false, webPreferences: { preload: path.join(dir, 'preload.js'), sandbox: true, contextIsolation: false, backgroundThrottling: false } });
      await janela.loadFile(path.join(dir, 'pagina.html'), { hash: caminho });
      let emVoo = 0, enviados = 0, descartados = 0, porta = null;
      if (caminho === 'ipc') {
        ipcMain.removeAllListeners('ok');
        // o preload de teste não repassa o "ok": a página manda pelo postMessage, e o preload não escuta. Usa o executeJavaScript abaixo.
      } else {
        const { port1, port2 } = new MessageChannelMain();
        porta = port1;
        porta.on('message', () => emVoo--);
        porta.start();
        janela.webContents.postMessage('porta', null, [port2]);
      }
      if (caminho === 'ipc') {
        await janela.webContents.executeJavaScript(`window.addEventListener('message', (m) => { if (m.data?.tipo === 'ok') document.title = String(Number(document.title || 0) + 1); });`);
      }
      let confirmadosIpc = 0;
      const tamanho = 24 + (L * A * 3) / 2;
      const molde = Buffer.alloc(tamanho, 128);
      molde.write('OZQ1', 0, 'latin1');
      molde.writeUInt16LE(L, 4);
      molde.writeUInt16LE(A, 6);
      // 60 por segundo: o relógio do processo principal acorda a cada ~1–16 ms, então manda os que já passaram da hora.
      let proximo = performance.now();
      const relogio = setInterval(() => {
        if (caminho === 'ipc') {
          const ok = Number(janela.webContents.getTitle()) || 0;
          emVoo -= ok - confirmadosIpc;
          confirmadosIpc = ok;
        }
        const agora = performance.now();
        if (agora - proximo > 50) proximo = agora; // atrasou muito: sem rajada
        while (agora >= proximo) {
          proximo += 1000 / 60;
          if (emVoo >= 2) {
            descartados++;
            continue;
          }
          const q = Buffer.from(molde);
          q.writeDoubleLE(Date.now(), 16);
          emVoo++;
          enviados++;
          if (caminho === 'ipc') janela.webContents.send('quadro', q);
          else porta.postMessage(q.buffer.slice(q.byteOffset, q.byteOffset + q.length));
        }
      }, 1);
      await new Promise((r) => setTimeout(r, 1000));
      await janela.webContents.executeJavaScript('window.medir()');
      const cpu0 = process.cpuUsage();
      await new Promise((r) => setTimeout(r, SEGUNDOS * 1000));
      const r = await janela.webContents.executeJavaScript('window.medir()');
      const cpu = process.cpuUsage(cpu0);
      clearInterval(relogio);
      const pagina = app.getAppMetrics().find((m) => m.pid === janela.webContents.getOSProcessId());
      console.log(
        `${caminho.padEnd(8)} ${L}x${A}: ${(r.recebidos / SEGUNDOS).toFixed(1)} quadros/s na página, atraso ${r.atrasoMedio.toFixed(1)} ms (máx. ${r.atrasoMax}), ` +
          `descartados no principal ${descartados}, principal ${((cpu.user + cpu.system) / 1e4 / SEGUNDOS).toFixed(0)}% de um núcleo, página ${pagina?.cpu.percentCPUUsage.toFixed(1)}% do processador`,
      );
      porta?.close();
      janela.destroy();
    }
  }
  app.quit();
});
