// Gera build/icone.png (256x256), o mesmo desenho de web/public/icone.svg: a tecla "OZ".
// Fundo grafite, uma tecla com a lateral verde-limão, o "O" claro e o "z" verde no canto.
// O electron-builder transforma este PNG no .ico do instalador. Rode com: npm run icone
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const LADO = 256;
const AMOSTRAS = 4; // 4x4 amostras por pixel para as bordas ficarem suaves
const escala = LADO / 96; // o SVG original tem 96x96

const hex = (cor) => [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));

const retanguloArredondado = (x0, y0, largura, altura, raio) => (x, y) => {
  if (x < x0 || y < y0 || x > x0 + largura || y > y0 + altura) return false;
  const cx = Math.min(Math.max(x, x0 + raio), x0 + largura - raio);
  const cy = Math.min(Math.max(y, y0 + raio), y0 + altura - raio);
  return (x - cx) ** 2 + (y - cy) ** 2 <= raio * raio;
};

const dentroDaElipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
// Contorno de elipse com espessura constante: dentro da elipse de fora e fora da de dentro.
const anelEliptico = (cx, cy, rx, ry, espessura) => (x, y) =>
  dentroDaElipse(x, y, cx, cy, rx + espessura / 2, ry + espessura / 2) &&
  !dentroDaElipse(x, y, cx, cy, rx - espessura / 2, ry - espessura / 2);

const distanciaAoSegmento = (x, y, [ax, ay], [bx, by]) => {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
};
// Linha com pontas e cantos redondos passando pelos pontos (o "z").
const traco = (pontos, espessura) => (x, y) =>
  pontos.slice(1).some((ponto, i) => distanciaAoSegmento(x, y, pontos[i], ponto) <= espessura / 2);

// Camadas de baixo para cima; a cor de cada amostra é a da camada mais alta que a cobre.
const CAMADAS = [
  [retanguloArredondado(0, 0, 96, 96, 22), hex('#0f130e')], // fundo
  [retanguloArredondado(14, 16, 68, 66, 15), hex('#b6f24a')], // lateral da tecla
  [retanguloArredondado(18, 18, 60, 54, 12), hex('#2a3326')], // topo da tecla
  [anelEliptico(40, 44, 11.5, 13.5, 6.5), hex('#eef9dc')], // "O"
  [traco([[58, 52], [70, 52], [58, 63], [70, 63]], 3.6), hex('#b6f24a')], // "z"
];

const linhas = [];
for (let py = 0; py < LADO; py++) {
  const linha = Buffer.alloc(1 + LADO * 4); // 1 byte de filtro + RGBA
  for (let px = 0; px < LADO; px++) {
    const soma = [0, 0, 0];
    let cobertas = 0;
    for (let sy = 0; sy < AMOSTRAS; sy++) {
      for (let sx = 0; sx < AMOSTRAS; sx++) {
        const x = (px + (sx + 0.5) / AMOSTRAS) / escala;
        const y = (py + (sy + 0.5) / AMOSTRAS) / escala;
        let cor = null;
        for (const [dentro, corDaCamada] of CAMADAS) if (dentro(x, y)) cor = corDaCamada;
        if (!cor) continue;
        cobertas++;
        cor.forEach((canal, i) => (soma[i] += canal));
      }
    }
    const i = 1 + px * 4;
    for (let c = 0; c < 3; c++) linha[i + c] = cobertas ? Math.round(soma[c] / cobertas) : 0;
    linha[i + 3] = Math.round((255 * cobertas) / (AMOSTRAS * AMOSTRAS));
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
