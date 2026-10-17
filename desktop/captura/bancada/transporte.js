// Fase 2, a medição do transporte: o auxiliar (OzamigosCaptura, a tela principal) captura e reduz na placa, o processo principal
// lê os quadros NV12 da saída dele e repassa à página por IPC, e a página monta uma trilha de vídeo (VideoFrame +
// MediaStreamTrackGenerator) e a envia em H.265 numa conexão WebRTC interna. Mede o fps em cada ponto, quanto o
// quadro leva da captura até a página, o processador de cada processo e o codificador.
// Rodar de desktop/: node_modules/.bin/electron captura/bancada/transporte.js
const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const AUXILIAR = path.join(__dirname, '..', 'publicado', 'OzamigosCaptura.exe'); // npm run captura, em desktop/
const SEGUNDOS = 25;
const L = 1280, A = 720, TAMANHO = 24 + (L * A * 3) / 2; // a tela principal em 16:9

const PAGINA = `<!doctype html><body style="margin:0;background:#111;color:#eee;font:14px sans-serif">
<video id=v autoplay muted playsinline style="width:640px;height:360px"></video><pre id=t></pre><script>
const atrasos = []; let recebidos = 0;
const gerador = new MediaStreamTrackGenerator({ kind: 'video' });
const escritor = gerador.writable.getWriter();
// Só depois do carregamento: um <video> ligado a uma trilha ainda sem quadros segurava o "load" da página para sempre.
addEventListener('load', () => { document.getElementById('v').srcObject = new MediaStream([gerador]); });
window.ponteDeTeste.aoReceberQuadro((dados) => {
  const bytes = new Uint8Array(dados.buffer, dados.byteOffset, dados.byteLength);
  const visao = new DataView(bytes.buffer, bytes.byteOffset, 24);
  const numero = visao.getUint32(8, true), capturado = visao.getFloat64(16, true);
  atrasos.push(performance.timeOrigin + performance.now() - capturado);
  recebidos++;
  const quadro = new VideoFrame(bytes.subarray(24), { format: 'NV12', codedWidth: ${L}, codedHeight: ${A}, timestamp: numero * 33333 });
  escritor.write(quadro);
});
window.medir = async (segundos) => {
  const microfone = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null); // mostra o nome do codificador
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
  const t = a.addTransceiver(gerador, { direction: 'sendonly' });
  const caps = RTCRtpSender.getCapabilities('video').codecs;
  t.setCodecPreferences([...caps.filter((c) => c.mimeType === 'video/H265'), ...caps.filter((c) => /rtx|red|ulpfec/i.test(c.mimeType))]);
  await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
  const p = t.sender.getParameters(); p.encodings[0].maxBitrate = 4e6; p.encodings[0].maxFramerate = 30; p.degradationPreference = 'maintain-resolution';
  await t.sender.setParameters(p);
  const est = async () => { const s = {}; (await a.getStats()).forEach((r) => { if (r.type === 'outbound-rtp' && r.kind === 'video') s.e = r; }); (await b.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') s.c = r; }); return s; };
  await new Promise((r) => setTimeout(r, 6000));
  const x = await est(); const r0 = recebidos; atrasos.length = 0;
  await new Promise((r) => setTimeout(r, segundos * 1000));
  const y = await est(); const dt = (y.e.timestamp - x.e.timestamp) / 1000;
  const ord = [...atrasos].sort((m, n) => m - n);
  microfone?.getTracks().forEach((m) => m.stop());
  return {
    fpsNaPagina: +((recebidos - r0) / dt).toFixed(1),
    atrasoAtePaginaMs: +(atrasos.reduce((m, n) => m + n, 0) / atrasos.length).toFixed(1),
    atrasoP95: +ord[Math.floor(ord.length * 0.95)].toFixed(1),
    codificador: y.e.encoderImplementation,
    fpsCodificado: +((y.e.framesEncoded - x.e.framesEncoded) / dt).toFixed(1),
    fpsRecebido: +((y.c.framesDecoded - x.c.framesDecoded) / dt).toFixed(1),
    msPorQuadro: +(((y.e.totalEncodeTime - x.e.totalEncodeTime) / (y.e.framesEncoded - x.e.framesEncoded)) * 1000).toFixed(2),
    mbps: +((((y.e.bytesSent - x.e.bytesSent) * 8) / dt) / 1e6).toFixed(2),
    limitacao: y.e.qualityLimitationReason,
  };
};
</script></body>`;

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_w, _p, ok) => ok(true));
  // Como no app: página isolada e um preload que só repassa os quadros (como o som do PC, em aoReceberSom).
  const preload = path.join(__dirname, 'transporte-preload.js');
  const janela = new BrowserWindow({ width: 680, height: 520, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  janela.webContents.on('console-message', (e) => console.log('[página]', e.message ?? e));
  janela.webContents.on('render-process-gone', (_e, d) => console.log('[página caiu]', JSON.stringify(d)));
  janela.webContents.on('did-fail-load', (_e, c, d, u) => console.log('[falhou]', c, d, u));
  const arquivo = path.join(require('node:os').tmpdir(), 'ozamigos-transporte.html');
  require('node:fs').writeFileSync(arquivo, PAGINA);
  await janela.loadFile(arquivo).catch((e) => console.log('[loadFile]', e.message));

  const auxiliar = spawn(AUXILIAR, ['--tela', '1,1', '--segundos', String(SEGUNDOS + 15)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const medidasDoAuxiliar = [];
  auxiliar.stderr.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => { try { medidasDoAuxiliar.push(JSON.parse(l)); } catch {} }));
  let pedacos = [], acumulado = 0, noPrincipal = 0;
  auxiliar.stdout.on('data', (d) => {
    pedacos.push(d); acumulado += d.length;
    if (acumulado < TAMANHO) return;
    let tudo = Buffer.concat(pedacos, acumulado);
    while (tudo.length >= TAMANHO) {
      janela.webContents.send('quadro', tudo.subarray(0, TAMANHO));
      noPrincipal++;
      tudo = tudo.subarray(TAMANHO);
    }
    pedacos = tudo.length ? [Buffer.from(tudo)] : []; acumulado = tudo.length;
  });

  // O processador de cada processo do Electron, de segundo a segundo (o percentCPUUsage já é do processador inteiro).
  const cpu = [];
  const amostra = setInterval(() => cpu.push(Object.fromEntries(app.getAppMetrics().map((m) => [m.type, +m.cpu.percentCPUUsage.toFixed(1)]))), 1000);
  const resultado = await janela.webContents.executeJavaScript(`window.medir(${SEGUNDOS - 8})`);
  clearInterval(amostra);
  const media = (k) => +(cpu.slice(8).reduce((s, x) => s + (x[k] || 0), 0) / cpu.slice(8).length).toFixed(1);
  const aux = medidasDoAuxiliar.slice(8);
  const cpuAux = aux.length > 1 ? +(((aux[aux.length - 1].processadorMs - aux[0].processadorMs) / (aux.length - 1)) / 10 / require('node:os').cpus().length).toFixed(1) : null;
  console.log(JSON.stringify({ ...resultado,
    conversaoNoAuxiliarMs: +(aux.reduce((s, x) => s + x.msConversao, 0) / aux.length).toFixed(2),
    processadorPct: { auxiliar: cpuAux, principal: media('Browser'), pagina: media('Tab'), gpu: media('GPU') } }, null, 1));
  auxiliar.kill();
  app.quit();
});
