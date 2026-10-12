// Gera o ícone do app, o mesmo desenho de web/public/icone.svg: a tecla "OZ".
// Uma tecla com a lateral verde-limão ocupando o ícone todo, o "O" claro e o "z" verde no canto.
// - build/icone.png (256x256): imagem de referência.
// - build/icone.ico: cada tamanho que o Windows usa desenhado direto naquele tamanho. Encolher o PNG
//   de 256 para os 16 pixels da barra de título deixava o desenho torto.
// Rode com: npm run icone
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const AMOSTRAS = 8; // 8x8 amostras por pixel para as bordas ficarem suaves
const TAMANHOS_DO_ICO = [16, 20, 24, 32, 40, 48, 64, 128, 256];

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
// A tecla ocupa o ícone inteiro, sem placa de fundo: na barra de tarefas ela fica do tamanho dos outros ícones.
const CAMADAS = [
  [retanguloArredondado(4, 5, 88, 87, 20), hex('#b6f24a')], // lateral da tecla
  [retanguloArredondado(9, 8, 78, 70, 16), hex('#2a3326')], // topo da tecla
  [anelEliptico(37.6, 41.7, 15, 17.5, 8.5), hex('#eef9dc')], // "O"
  [traco([[61, 52], [76.6, 52], [61, 66.4], [76.6, 66.4]], 4.7), hex('#b6f24a')], // "z"
];

function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

/** Desenha o ícone com lado x lado pixels: RGBA, linha a linha, de cima para baixo. */
function desenhar(lado) {
  const escala = lado / 96; // o SVG original tem 96x96
  const rgba = Buffer.alloc(lado * lado * 4);
  for (let py = 0; py < lado; py++) {
    for (let px = 0; px < lado; px++) {
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
      const i = (py * lado + px) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = cobertas ? Math.round(soma[c] / cobertas) : 0;
      rgba[i + 3] = Math.round((255 * cobertas) / (AMOSTRAS * AMOSTRAS));
    }
  }
  return rgba;
}

function png(lado, rgba) {
  const linhas = [];
  for (let y = 0; y < lado; y++) {
    linhas.push(Buffer.from([0]), rgba.subarray(y * lado * 4, (y + 1) * lado * 4)); // filtro 0 + a linha
  }
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(lado, 0);
  cabecalho.writeUInt32BE(lado, 4);
  cabecalho[8] = 8; // 8 bits por canal
  cabecalho[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', cabecalho),
    bloco('IDAT', zlib.deflateSync(Buffer.concat(linhas))),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A imagem de um tamanho dentro do .ico, no formato BMP clássico (BGRA, de baixo para cima, mais a
 * máscara de 1 bit zerada): é o que todo o Windows lê. O 256 vai em PNG, como o Windows espera.
 */
function bmp(lado, rgba) {
  const cabecalho = Buffer.alloc(40);
  cabecalho.writeUInt32LE(40, 0);
  cabecalho.writeInt32LE(lado, 4);
  cabecalho.writeInt32LE(lado * 2, 8); // a altura conta a imagem e a máscara
  cabecalho.writeUInt16LE(1, 12); // planos
  cabecalho.writeUInt16LE(32, 14); // bits por pixel
  const pixels = Buffer.alloc(lado * lado * 4);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const de = (y * lado + x) * 4;
      const para = ((lado - 1 - y) * lado + x) * 4;
      pixels[para] = rgba[de + 2];
      pixels[para + 1] = rgba[de + 1];
      pixels[para + 2] = rgba[de];
      pixels[para + 3] = rgba[de + 3];
    }
  }
  const mascara = Buffer.alloc(Math.ceil(lado / 32) * 4 * lado);
  return Buffer.concat([cabecalho, pixels, mascara]);
}

function ico(imagens) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(1, 2); // tipo: ícone
  cabecalho.writeUInt16LE(imagens.length, 4);
  let posicao = 6 + 16 * imagens.length;
  const entradas = imagens.map(([lado, dados]) => {
    const entrada = Buffer.alloc(16);
    entrada[0] = lado % 256; // 0 quer dizer 256
    entrada[1] = lado % 256;
    entrada.writeUInt16LE(1, 4); // planos
    entrada.writeUInt16LE(32, 6); // bits por pixel
    entrada.writeUInt32LE(dados.length, 8);
    entrada.writeUInt32LE(posicao, 12);
    posicao += dados.length;
    return entrada;
  });
  return Buffer.concat([cabecalho, ...entradas, ...imagens.map(([, dados]) => dados)]);
}

const imagens = TAMANHOS_DO_ICO.map((lado) => {
  const rgba = desenhar(lado);
  return [lado, lado === 256 ? png(lado, rgba) : bmp(lado, rgba)];
});
fs.writeFileSync(path.join(__dirname, 'icone.png'), imagens.at(-1)[1]);
fs.writeFileSync(path.join(__dirname, 'icone.ico'), ico(imagens));
console.log('build/icone.png e build/icone.ico gerados');
