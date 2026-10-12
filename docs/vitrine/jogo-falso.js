// Injetado nas janelas de demonstração: troca getDisplayMedia por um "jogo" desenhado por código.
// Três estilos: corrida, espaco, plataforma. Nada de imagem de jogo real.
(() => {
  const worker = `
    const L = 1280, A = 720;
    const c = new OffscreenCanvas(L, A), x = c.getContext('2d');
    let estilo = 'corrida', n = 0;
    const estrelas = Array.from({ length: 140 }, () => [Math.random() * L, Math.random() * A, Math.random() * 2.5 + 0.5]);
    const inimigos = Array.from({ length: 6 }, (_, i) => [200 + i * 170, 120 + (i % 3) * 70]);
    onmessage = (e) => { estilo = e.data; };
    function hud(textoEsq, textoDir) {
      x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(24, A - 78, 300, 54); x.fillRect(L - 324, A - 78, 300, 54);
      x.fillStyle = '#fff'; x.font = 'bold 30px Segoe UI, sans-serif';
      x.textAlign = 'left'; x.fillText(textoEsq, 42, A - 40);
      x.textAlign = 'right'; x.fillText(textoDir, L - 42, A - 40); x.textAlign = 'left';
    }
    function corrida() {
      const ceu = x.createLinearGradient(0, 0, 0, A * 0.55);
      ceu.addColorStop(0, '#2b1055'); ceu.addColorStop(1, '#f7797d');
      x.fillStyle = ceu; x.fillRect(0, 0, L, A);
      x.fillStyle = '#ffcf6b'; x.beginPath(); x.arc(L / 2, A * 0.5, 90, Math.PI, 0); x.fill();
      x.fillStyle = '#3a1c5c';
      for (let i = 0; i < 8; i++) { const bx = ((i * 190 - n * 1.5) % (L + 200) + L + 200) % (L + 200) - 100; x.fillRect(bx, A * 0.32, 70, A * 0.23); }
      x.fillStyle = '#1b2a1b'; x.fillRect(0, A * 0.55, L, A);
      x.fillStyle = '#3b3b48'; x.beginPath(); x.moveTo(L / 2 - 40, A * 0.55); x.lineTo(L / 2 + 40, A * 0.55); x.lineTo(L * 0.95, A); x.lineTo(L * 0.05, A); x.fill();
      x.fillStyle = '#f2f2f2';
      for (let i = 0; i < 9; i++) { const t = ((i / 9 + n * 0.012) % 1); const y = A * 0.55 + t * t * A * 0.45; const w = 4 + t * 14; x.fillRect(L / 2 - w / 2, y, w, 8 + t * 40); }
      const cx = L / 2 + Math.sin(n / 25) * 120;
      x.fillStyle = '#e63946'; x.fillRect(cx - 80, A - 150, 160, 70); x.fillStyle = '#ff6b6b'; x.fillRect(cx - 55, A - 185, 110, 40);
      x.fillStyle = '#111'; x.fillRect(cx - 90, A - 95, 40, 30); x.fillRect(cx + 50, A - 95, 40, 30);
      hud('VOLTA 2/3', (138 + Math.round(Math.sin(n / 20) * 9)) + ' km/h');
    }
    function espaco() {
      x.fillStyle = '#070a1a'; x.fillRect(0, 0, L, A);
      for (const e of estrelas) { e[1] = (e[1] + e[2] * 2) % A; x.fillStyle = 'rgba(255,255,255,' + (0.3 + e[2] / 4) + ')'; x.fillRect(e[0], e[1], e[2], e[2] * 2); }
      x.fillStyle = 'rgba(120,80,255,0.25)'; x.beginPath(); x.arc(1000, 200, 160, 0, 7); x.fill();
      inimigos.forEach(([ix, iy], i) => { const px = ix + Math.sin(n / 30 + i) * 40; x.fillStyle = i % 2 ? '#ff5c8a' : '#ffb347'; x.beginPath(); x.arc(px, iy, 26, 0, 7); x.fill(); x.fillStyle = '#070a1a'; x.fillRect(px - 12, iy - 4, 8, 8); x.fillRect(px + 4, iy - 4, 8, 8); });
      const nx = L / 2 + Math.sin(n / 35) * 300;
      x.fillStyle = '#4cc9f0'; x.beginPath(); x.moveTo(nx, A - 170); x.lineTo(nx - 45, A - 90); x.lineTo(nx + 45, A - 90); x.fill();
      x.fillStyle = '#ffd166'; for (let i = 0; i < 4; i++) { x.fillRect(nx - 3, A - 200 - ((n * 14 + i * 120) % 420), 6, 26); }
      hud('SCORE ' + String(4210 + n * 5).padStart(6, '0'), 'FASE 7');
    }
    function plataforma() {
      const ceu = x.createLinearGradient(0, 0, 0, A); ceu.addColorStop(0, '#5ec8ff'); ceu.addColorStop(1, '#bfe9ff');
      x.fillStyle = ceu; x.fillRect(0, 0, L, A);
      x.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) { const nx = ((i * 330 - n * 0.8) % (L + 300) + L + 300) % (L + 300) - 150; x.beginPath(); x.arc(nx, 110 + (i % 2) * 60, 40, 0, 7); x.arc(nx + 45, 100 + (i % 2) * 60, 50, 0, 7); x.arc(nx + 95, 115 + (i % 2) * 60, 36, 0, 7); x.fill(); }
      x.fillStyle = '#5b8c2a'; for (let i = 0; i < 6; i++) { const hx = ((i * 260 - n * 1.6) % (L + 260) + L + 260) % (L + 260) - 130; x.beginPath(); x.arc(hx, A - 120, 120, Math.PI, 0); x.fill(); }
      for (let i = 0; i < 22; i++) { const tx = ((i * 64 - n * 4) % (L + 64) + L + 64) % (L + 64) - 64; x.fillStyle = '#c47a3a'; x.fillRect(tx, A - 120, 62, 120); x.fillStyle = '#6fbf3b'; x.fillRect(tx, A - 120, 62, 22); }
      x.fillStyle = '#c47a3a'; const px = ((700 - n * 4) % (L + 400) + L + 400) % (L + 400) - 200; x.fillRect(px, A - 300, 240, 34); x.fillStyle = '#6fbf3b'; x.fillRect(px, A - 300, 240, 10);
      x.fillStyle = '#ffd43b'; for (let i = 0; i < 4; i++) { x.beginPath(); x.ellipse(px + 40 + i * 55, A - 340 + Math.sin(n / 8 + i) * 6, 12, 16, 0, 0, 7); x.fill(); }
      const salto = Math.abs(Math.sin(n / 14)) * 150;
      x.fillStyle = '#e63946'; x.fillRect(300, A - 190 - salto, 56, 70); x.fillStyle = '#fff'; x.fillRect(330, A - 175 - salto, 14, 14); x.fillStyle = '#111'; x.fillRect(336, A - 171 - salto, 6, 6);
      hud('MOEDAS x ' + (12 + Math.floor(n / 40)), 'MUNDO 3-2');
    }
    const unidades = Array.from({ length: 14 }, (_, i) => [180 + (i % 7) * 120, 200 + Math.floor(i / 7) * 220, i % 3]);
    function estrategia() {
      x.fillStyle = '#3f7d3a'; x.fillRect(0, 0, L, A);
      x.strokeStyle = 'rgba(0,0,0,0.12)'; x.lineWidth = 2;
      for (let gx = 0; gx < L; gx += 64) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, A); x.stroke(); }
      for (let gy = 0; gy < A; gy += 64) { x.beginPath(); x.moveTo(0, gy); x.lineTo(L, gy); x.stroke(); }
      x.fillStyle = '#3a8fd6'; x.beginPath(); x.ellipse(1020, 520, 200, 120, 0.3, 0, 7); x.fill();
      x.fillStyle = '#2e5e2b'; for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(120 + i * 60, 600 - (i % 2) * 30, 34, 0, 7); x.fill(); }
      x.fillStyle = '#c9a66b'; x.fillRect(560, 300, 150, 110); x.fillStyle = '#8a5a2b'; x.beginPath(); x.moveTo(545, 300); x.lineTo(635, 240); x.lineTo(725, 300); x.fill();
      unidades.forEach(([ux, uy, t], i) => { const px = ux + Math.sin(n / 40 + i) * 50, py = uy + Math.cos(n / 50 + i) * 30; x.fillStyle = ['#ffd166', '#ef476f', '#ffffff'][t]; x.beginPath(); x.arc(px, py, 13, 0, 7); x.fill(); x.strokeStyle = '#1b1b1b'; x.lineWidth = 3; x.stroke(); });
      x.strokeStyle = '#b6f24a'; x.lineWidth = 3; x.strokeRect(150 + Math.sin(n / 60) * 30, 170, 300, 260);
      hud('MADEIRA 1.240', 'POP 38/60');
    }
    setInterval(() => {
      n++;
      ({ espaco, plataforma, estrategia }[estilo] ?? corrida)();
      const q = new VideoFrame(c, { timestamp: n * 33333 });
      postMessage(q, [q]);
    }, 33);
  `;
  window.__prepararJogo = (estilo) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const gerador = new MediaStreamTrackGenerator({ kind: 'video' });
      const escritor = gerador.writable.getWriter();
      const w = new Worker(URL.createObjectURL(new Blob([worker], { type: 'text/javascript' })));
      w.postMessage(estilo);
      w.onmessage = (e) => escritor.write(e.data).catch(() => e.data.close());
      const audio = new AudioContext();
      const ganho = audio.createGain();
      ganho.gain.value = 0.0001; // só para a transmissão aparecer "com som"
      const osc = audio.createOscillator();
      const destino = audio.createMediaStreamDestination();
      osc.connect(ganho).connect(destino);
      osc.start();
      return new MediaStream([gerador, destino.stream.getAudioTracks()[0]]);
    };
    return 'ok';
  };
})();
