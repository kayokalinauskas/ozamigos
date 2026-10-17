// Rodar de desktop/: NODE_PATH=node_modules node captura/bancada/codecs.js <print.png> [segundos] [codecs] [mbps] (servidor local na 8090).
// Bancada de codecs dentro do app Electron: duas RTCPeerConnection na mesma página (1 para 1 sem rede), uma imagem de
// jogo rolando como câmera, 720p a 30 fps e 4 Mbps. Para cada codec: placa ou processador, fps, tempo de codificação,
// atraso de ponta a ponta e PSNR (o quadro recebido comparado com o enviado, achado por um código de barras no canto).
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const PRINT = process.argv[2];
const SEGUNDOS = Number(process.argv[3] || 20);
const CODECS = (process.argv[4] || 'video/H264,video/H265,video/AV1,video/VP9').split(',');
const MBPS = Number(process.argv[5] || 4);

(async () => {
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'ozamigos-bancada-'));
  fs.writeFileSync(path.join(dados, 'configuracao.json'), JSON.stringify({ avisouDaBandeja: true, posicao: { width: 1400, height: 900 } }));
  const app = await electron.launch({
    args: [path.join(process.cwd(), 'teste', 'embrulho.js')],
    env: { ...process.env, OZAMIGOS_SERVIDOR: 'http://localhost:8090', OZAMIGOS_TESTE_DADOS: dados },
  });
  const j = await app.firstWindow();
  await j.waitForLoadState('load');
  const imagem = 'data:image/png;base64,' + fs.readFileSync(PRINT).toString('base64');
  const resultados = [];
  for (const codec of CODECS) {
    const r = await j.evaluate(rodar, { imagem, codec, segundos: SEGUNDOS, mbps: MBPS });
    resultados.push(r);
    console.log(JSON.stringify(r));
  }
  await app.close();
  fs.rmSync(dados, { recursive: true, force: true });
})();

async function rodar({ imagem, codec, segundos, mbps }) {
  // Com um microfone em uso, o Chromium mostra o nome do codificador (sem isso, esconde).
  const microfone = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  const L = 1280, A = 720, BITS = 16, BLOCO = 16, FAIXA = BLOCO + 4;
  const img = new Image();
  img.src = imagem;
  await img.decode();
  // A imagem do jogo um pouco maior que a tela, para a "câmera" andar por ela.
  const escala = Math.max(L * 1.6 / img.width, A * 1.25 / img.height);
  const IW = img.width * escala, IH = img.height * escala;

  function desenhar(g, i) {
    const x = (i * 9) % Math.max(1, IW - L);
    const y = (Math.sin(i / 40) * 0.5 + 0.5) * (IH - A);
    g.drawImage(img, -x, -y, IW, IH);
    // Código de barras com o número do quadro (faixa de cima, fora do PSNR).
    g.fillStyle = '#808080';
    g.fillRect(0, 0, BITS * BLOCO + 8, FAIXA);
    for (let b = 0; b < BITS; b++) {
      g.fillStyle = (i >> b) & 1 ? '#ffffff' : '#000000';
      g.fillRect(4 + b * BLOCO, 2, BLOCO, BLOCO);
    }
  }

  const fonte = document.createElement('canvas');
  fonte.width = L; fonte.height = A;
  const gf = fonte.getContext('2d');
  const enviados = new Map();
  let i = 0;
  desenhar(gf, i);
  const relogio = setInterval(() => {
    i++;
    desenhar(gf, i);
    enviados.set(i & 0xffff, performance.now());
  }, 1000 / 30);
  const stream = fonte.captureStream(30);
  const trilha = stream.getVideoTracks()[0];
  trilha.contentHint = 'motion';

  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
  const t = a.addTransceiver(trilha, { direction: 'sendonly' });
  const caps = RTCRtpSender.getCapabilities('video').codecs;
  const escolhidos = caps.filter((c) => c.mimeType === codec);
  if (!escolhidos.length) return { codec, erro: 'não disponível' };
  t.setCodecPreferences([...escolhidos, ...caps.filter((c) => /rtx|red|ulpfec/i.test(c.mimeType))]);
  const video = document.createElement('video');
  video.muted = true; video.autoplay = true; video.playsInline = true;
  video.style.cssText = 'position:fixed;right:0;bottom:0;width:320px;height:180px;z-index:99999';
  document.body.appendChild(video);
  b.ontrack = (e) => { video.srcObject = new MediaStream([e.track]); };
  await a.setLocalDescription();
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription();
  await a.setRemoteDescription(b.localDescription);
  const p = t.sender.getParameters();
  p.encodings = p.encodings?.length ? p.encodings : [{}];
  p.encodings[0].maxBitrate = mbps * 1_000_000;
  p.encodings[0].maxFramerate = 30;
  p.degradationPreference = 'maintain-resolution';
  await t.sender.setParameters(p);

  // Quem recebe: lê o código de barras, refaz o quadro original e compara (luma, de 2 em 2 pixels).
  const tela = document.createElement('canvas'); tela.width = L; tela.height = A;
  const gt = tela.getContext('2d', { willReadFrequently: true });
  const ref = document.createElement('canvas'); ref.width = L; ref.height = A;
  const gr = ref.getContext('2d', { willReadFrequently: true });
  const psnrs = [], atrasos = [];
  let medir = false, contados = 0;
  const luma = (d, k) => 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
  function aoQuadro(agora) {
    if (medir && video.videoWidth === L) {
      contados++;
      gt.drawImage(video, 0, 0, L, A);
      const barras = gt.getImageData(0, 0, BITS * BLOCO + 8, FAIXA).data;
      let n = 0;
      for (let k = 0; k < BITS; k++) {
        const px = ((2 + BLOCO / 2) * (BITS * BLOCO + 8) + 4 + k * BLOCO + BLOCO / 2) * 4;
        if (luma(barras, px) > 128) n |= 1 << k;
      }
      const enviado = enviados.get(n);
      if (enviado) atrasos.push(agora - enviado);
      if (contados % 5 === 0) {
        desenhar(gr, n);
        const x = gt.getImageData(0, FAIXA, L, A - FAIXA).data, y = gr.getImageData(0, FAIXA, L, A - FAIXA).data;
        let erro = 0, pontos = 0;
        for (let k = 0; k < x.length; k += 8) {
          const d = luma(x, k) - luma(y, k);
          erro += d * d; pontos++;
        }
        const mse = erro / pontos;
        psnrs.push(mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse));
      }
    }
    video.requestVideoFrameCallback(aoQuadro);
  }
  video.requestVideoFrameCallback(aoQuadro);

  const estat = async () => {
    const s = {};
    (await a.getStats()).forEach((r) => { if (r.type === 'outbound-rtp' && r.kind === 'video') s.envio = r; if (r.type === 'media-source' && r.kind === 'video') s.fonte = r; });
    (await b.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') s.chegada = r; if (r.type === 'codec') s.codec = s.codec || r.mimeType; });
    return s;
  };
  await new Promise((r) => setTimeout(r, 15000)); // o controle de banda sobe até o alvo
  const antes = await estat();
  medir = true;
  await new Promise((r) => setTimeout(r, segundos * 1000));
  medir = false;
  const depois = await estat();
  clearInterval(relogio);
  const e0 = antes.envio, e1 = depois.envio, c0 = antes.chegada, c1 = depois.chegada;
  const dt = (e1.timestamp - e0.timestamp) / 1000;
  const media = (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : null);
  const ordenados = [...atrasos].sort((x, y) => x - y);
  const resultado = {
    codec,
    alvoMbps: mbps,
    negociado: depois.codec,
    codificador: e1.encoderImplementation,
    naPlaca: e1.powerEfficientEncoder,
    decodificador: c1.decoderImplementation,
    resolucao: `${e1.frameWidth}x${e1.frameHeight}`,
    fpsEnviado: +((e1.framesEncoded - e0.framesEncoded) / dt).toFixed(1),
    fpsRecebido: +((c1.framesDecoded - c0.framesDecoded) / dt).toFixed(1),
    msPorQuadro: +(((e1.totalEncodeTime - e0.totalEncodeTime) / (e1.framesEncoded - e0.framesEncoded)) * 1000).toFixed(2),
    mbps: +((((e1.bytesSent - e0.bytesSent) * 8) / dt) / 1e6).toFixed(2),
    limitacao: e1.qualityLimitationReason,
    congelamentos: (c1.freezeCount ?? 0) - (c0.freezeCount ?? 0),
    psnr: +media(psnrs)?.toFixed(2),
    psnrPior: +Math.min(...psnrs).toFixed(2),
    atrasoMs: +media(atrasos)?.toFixed(1),
    atrasoP95: ordenados.length ? +ordenados[Math.floor(ordenados.length * 0.95)].toFixed(1) : null,
  };
  a.close(); b.close(); video.remove(); trilha.stop(); microfone?.getTracks().forEach((m) => m.stop());
  return resultado;
}
