// Leva as telas de docs/imagens para o site (site/imagens), em WebP e nas larguras do srcset.
// Uso, a partir da raiz, depois do captura.js e do marca.js, com o ffmpeg no PATH: node docs\vitrine\site.js
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const IMAGENS = path.join(__dirname, '..', 'imagens');
const SITE = path.join(__dirname, '..', '..', 'site', 'imagens');

const LARGURAS = {
  'sala-destaque': [640, 800, 1200, 1600],
  'sala-grade': [640, 800, 1200, 1600],
  voz: [640, 800, 1200],
};

for (const [nome, larguras] of Object.entries(LARGURAS)) {
  for (const largura of larguras) {
    const saida = path.join(SITE, `${nome}-${largura}.webp`);
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(IMAGENS, `${nome}.png`), '-vf', `scale=${largura}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '86', '-compression_level', '6', saida], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`ffmpeg falhou em ${nome}-${largura} (está no PATH?)`);
    console.log(path.basename(saida), Math.round(fs.statSync(saida).size / 1024), 'KB');
  }
}
fs.copyFileSync(path.join(IMAGENS, 'social.png'), path.join(SITE, 'social.png'));
console.log('social.png copiada');
