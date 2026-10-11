// Gera build/icone.png (256x256), o mesmo desenho de web/public/icone.svg:
// quadrado arredondado em degradê laranja-rosa, dois anéis e um traço brancos.
// O electron-builder transforma este PNG no .ico do instalador. Rode com: npm run icone
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const LADO = 256;
const AMOSTRAS = 4; // 4x4 amostras por pixel para as bordas ficarem suaves
const escala = LADO / 64; // o SVG original tem 64x64

const dentroDoQuadrado = (x, y) => {
  const r = 16;
  const cx = Math.min(Math.max(x, r), 64 - r);
  const cy = Math.min(Math.max(y, r), 64 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const noAnel = (x, y, cx, cy) => Math.abs(Math.hypot(x - cx, y - cy) - 9) <= 2.5;
const noTraco = (x, y) => {
  const px = Math.min(Math.max(x, 18), 46);
  return Math.hypot(x - px, y - 46) <= 2.5;
};

const cor = (t) => [255, Math.round(138 + (77 - 138) * t), Math.round(61 + (109 - 61) * t)]; // #ff8a3d -> #ff4d6d

const linhas = [];
for (let py = 0; py < LADO; py++) {
  const linha = Buffer.alloc(1 + LADO * 4); // 1 byte de filtro + RGBA
  for (let px = 0; px < LADO; px++) {
    let fundo = 0;
    let branco = 0;
    for (let sy = 0; sy < AMOSTRAS; sy++) {
      for (let sx = 0; sx < AMOSTRAS; sx++) {
        const x = (px + (sx + 0.5) / AMOSTRAS) / escala;
        const y = (py + (sy + 0.5) / AMOSTRAS) / escala;
        if (!dentroDoQuadrado(x, y)) continue;
        fundo++;
        if (noAnel(x, y, 24, 30) || noAnel(x, y, 40, 30) || noTraco(x, y)) branco++;
      }
    }
    const total = AMOSTRAS * AMOSTRAS;
    const [r, g, b] = cor((px + py) / (2 * LADO));
    const mistura = fundo ? branco / fundo : 0;
    const i = 1 + px * 4;
    linha[i] = Math.round(r + (255 - r) * mistura);
    linha[i + 1] = Math.round(g + (255 - g) * mistura);
    linha[i + 2] = Math.round(b + (255 - b) * mistura);
    linha[i + 3] = Math.round((255 * fundo) / total);
  }
  linhas.push(linha);
}

function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

const cabecalho = Buffer.alloc(13);
cabecalho.writeUInt32BE(LADO, 0);
cabecalho.writeUInt32BE(LADO, 4);
cabecalho[8] = 8; // 8 bits por canal
cabecalho[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  bloco('IHDR', cabecalho),
  bloco('IDAT', zlib.deflateSync(Buffer.concat(linhas))),
  bloco('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, 'icone.png'), png);
console.log('build/icone.png gerado');
