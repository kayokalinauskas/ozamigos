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

// As letras "o" e "z" da Sora, peso 700, já em coordenadas do quadro de 96x96 (tamanho 50, centradas na tecla).
// São os mesmos caminhos do icone.svg. Para refazer: contornos da fonte com o fontTools.
const LETRA_O = 'M35.94 59.98Q32.32 59.98 29.52 58.85Q26.72 57.73 24.79 55.77Q22.85 53.81 21.85 51.29Q20.85 48.76 20.85 45.95V44.83Q20.85 41.94 21.89 39.37Q22.94 36.8 24.9 34.84Q26.86 32.89 29.66 31.77Q32.46 30.65 35.94 30.65Q39.45 30.65 42.23 31.77Q45.01 32.89 46.98 34.84Q48.94 36.8 49.98 39.37Q51.02 41.94 51.02 44.83V45.95Q51.02 48.76 50.02 51.29Q49.02 53.81 47.09 55.77Q45.15 57.73 42.35 58.85Q39.55 59.98 35.94 59.98ZM35.94 53.2Q38.26 53.2 39.83 52.19Q41.39 51.19 42.19 49.41Q43 47.62 43 45.39Q43 43.06 42.17 41.28Q41.34 39.5 39.76 38.46Q38.17 37.42 35.94 37.42Q33.71 37.42 32.12 38.46Q30.54 39.5 29.71 41.28Q28.88 43.06 28.88 45.39Q28.88 47.62 29.68 49.41Q30.49 51.19 32.07 52.19Q33.65 53.2 35.94 53.2Z';
const LETRA_Z = 'M53.83 59V53.42L66.65 38V38.8L65.47 37.3L66.39 37.75H53.85V31.62H75.4V37.2L62.58 52.62V51.85L63.78 53.36L62.85 52.88H75.83V59Z';

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
  [retanguloArredondado(4, 5, 88, 87, 20), hex('#b6f24a')], // lateral da tecla
  [retanguloArredondado(9, 8, 78, 70, 16), hex('#2a3326')], // topo da tecla
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
