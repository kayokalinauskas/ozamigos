// Gera o ícone do app, o mesmo desenho de web/public/icone.svg: a tecla "oz".
// Uma tecla com a lateral verde-limão ocupando o ícone todo e "oz" na fonte Sora (peso 700): o "o" claro e o "z" verde.
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

// As letras "o" e "z" da Sora, peso 700, já em coordenadas do quadro de 96x96 (tamanho 66, centradas no topo da tecla).
// São os mesmos caminhos do icone.svg. Para refazer: contornos da fonte com o fontTools.
const LETRA_O = 'M32.32 62.35Q27.55 62.35 23.85 60.87Q20.16 59.38 17.6 56.8Q15.04 54.22 13.72 50.89Q12.4 47.55 12.4 43.84V42.36Q12.4 38.55 13.78 35.15Q15.16 31.76 17.75 29.18Q20.34 26.6 24.03 25.12Q27.73 23.65 32.32 23.65Q36.95 23.65 40.63 25.12Q44.3 26.6 46.89 29.18Q49.48 31.76 50.86 35.15Q52.23 38.55 52.23 42.36V43.84Q52.23 47.55 50.91 50.89Q49.59 54.22 47.04 56.8Q44.48 59.38 40.78 60.87Q37.09 62.35 32.32 62.35ZM32.32 53.41Q35.39 53.41 37.45 52.08Q39.51 50.76 40.58 48.4Q41.64 46.05 41.64 43.1Q41.64 40.03 40.54 37.68Q39.45 35.33 37.36 33.96Q35.27 32.59 32.32 32.59Q29.38 32.59 27.28 33.96Q25.19 35.33 24.09 37.68Q22.99 40.03 22.99 43.1Q22.99 46.05 24.06 48.4Q25.12 50.76 27.21 52.08Q29.3 53.41 32.32 53.41Z';
const LETRA_Z = 'M55.45 61.07V53.71L72.38 33.35V34.4L70.83 32.42L72.03 33.02H55.48V24.93H83.93V32.29L67 52.65V51.63L68.58 53.63L67.36 52.98H84.49V61.07Z';

/** Transforma um caminho SVG (só M, L, H, V, Q e Z absolutos) em polígonos, com as curvas em retas curtas. */
function poligonos(caminho) {
  const lista = [];
  let atual = null;
  let [x, y] = [0, 0];
  for (const [, comando, numeros] of caminho.matchAll(/([MLHVQZ])([^MLHVQZ]*)/g)) {
    const n = numeros.trim() ? numeros.trim().split(/[\s,]+/).map(Number) : [];
    if (comando === 'M') lista.push((atual = [[(x = n[0]), (y = n[1])]]));
    else if (comando === 'L') atual.push([(x = n[0]), (y = n[1])]);
    else if (comando === 'H') atual.push([(x = n[0]), y]);
    else if (comando === 'V') atual.push([x, (y = n[0])]);
    else if (comando === 'Q') {
      for (let t = 1; t <= 8; t++) {
        const u = t / 8;
        atual.push([(1 - u) ** 2 * x + 2 * (1 - u) * u * n[0] + u * u * n[2], (1 - u) ** 2 * y + 2 * (1 - u) * u * n[1] + u * u * n[3]]);
      }
      [x, y] = [n[2], n[3]];
    }
  }
  return lista;
}

// Preenchimento "nonzero", como o do SVG: o furo do "o" tem o sentido contrário e fica de fora.
const preenchido = (caminho) => {
  const lista = poligonos(caminho);
  return (px, py) => {
    let voltas = 0;
    for (const p of lista) {
      for (let i = 0; i < p.length; i++) {
        const [ax, ay] = p[i];
        const [bx, by] = p[(i + 1) % p.length];
        if ((ay <= py) !== (by <= py)) {
          const xCruza = ax + ((py - ay) / (by - ay)) * (bx - ax);
          if (xCruza > px) voltas += by > ay ? 1 : -1;
        }
      }
    }
    return voltas !== 0;
  };
};

// Camadas de baixo para cima; a cor de cada amostra é a da camada mais alta que a cobre.
// A tecla ocupa o ícone inteiro, sem placa de fundo: na barra de tarefas ela fica do tamanho dos outros ícones.
const CAMADAS = [
  [retanguloArredondado(1, 1, 94, 94, 21), hex('#b6f24a')], // lateral da tecla
  [retanguloArredondado(5, 4, 86, 78, 17), hex('#2a3326')], // topo da tecla
  [preenchido(LETRA_O), hex('#eef9dc')], // "o"
  [preenchido(LETRA_Z), hex('#b6f24a')], // "z"
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
