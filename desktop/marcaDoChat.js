// A marca das mensagens não lidas do chat: uma bolinha verde com o número (1 a 9, e "9+"), desenhada em pixels (BGRA,
// a ordem do nativeImage no Windows), sem arquivos de imagem. Vai em dois lugares (main.js, "nao-lidas"):
// - sobre o ícone da barra de tarefas (setOverlayIcon): o Windows a põe sempre no canto de baixo à direita;
// - no ícone da bandeja, no canto de cima à direita, desenhada por cima do próprio ícone.
// Verde com o número escuro, como o resto da marca (texto em cima do verde é escuro; o vermelho é só do "ao vivo").

const VERDE = [0x4a, 0xf2, 0xb6]; // --destaque, em BGR
const ESCURO = [0x0a, 0x0e, 0x0b]; // --fundo, em BGR

// Algarismos de 3×5 pixels: nos tamanhos de ícone (16 e 32 px), uma fonte de verdade borraria.
const FONTE = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

/** O que vai escrito: de 1 a 9, e "9+" daí para cima. */
function textoDaMarca(quantas) {
  return quantas > 9 ? '9+' : String(Math.max(1, Math.floor(quantas)));
}

/** Pinta um pixel com a cor e a opacidade dadas, por cima do que já estava (o ícone, ou nada). */
function pintar(pixels, lado, x, y, [b, g, r], opacidade) {
  if (x < 0 || y < 0 || x >= lado || y >= lado || opacidade <= 0) return;
  const i = (y * lado + x) * 4;
  const a = Math.min(1, opacidade);
  const fundo = pixels[i + 3] / 255;
  const alfa = a + fundo * (1 - a);
  const misturar = (c, antes) => Math.round((c * a + antes * fundo * (1 - a)) / (alfa || 1));
  pixels[i] = misturar(b, pixels[i]);
  pixels[i + 1] = misturar(g, pixels[i + 1]);
  pixels[i + 2] = misturar(r, pixels[i + 2]);
  pixels[i + 3] = Math.round(alfa * 255);
}

/**
 * A bolinha com o número, de centro (cx, cy) e raio `raio`, com uma borda escura fina para aparecer em qualquer fundo.
 * Com `esticar`, vira uma pílula: a bolinha se alarga tanto para cada lado (o "9+" num ícone de 16 px não cabia nela).
 */
function bolinha(pixels, lado, cx, cy, raio, texto, esticar = 0) {
  for (let y = Math.floor(cy - raio - 1); y <= Math.ceil(cy + raio + 1); y++) {
    for (let x = Math.floor(cx - raio - esticar - 1); x <= Math.ceil(cx + raio + esticar + 1); x++) {
      const px = x + 0.5;
      const distancia = Math.hypot(px - Math.max(cx - esticar, Math.min(cx + esticar, px)), y + 0.5 - cy);
      pintar(pixels, lado, x, y, ESCURO, raio + 1 - distancia); // a borda, suave por fora
      pintar(pixels, lado, x, y, VERDE, raio - distancia); // o verde, suave na borda
    }
  }
  // O maior tamanho de letra que cabe: o texto ocupa até ~1,4 vez o raio (mais o que a pílula esticou) de largura.
  const colunas = texto.length * 4 - 1; // 3 por algarismo, mais 1 de espaço entre eles
  const escala = Math.max(1, Math.min(Math.floor((raio * 1.4 + esticar * 2) / colunas), Math.floor((raio * 1.3) / 5)));
  const x0 = Math.round(cx - (colunas * escala) / 2);
  const y0 = Math.round(cy - (5 * escala) / 2);
  [...texto].forEach((caractere, n) => {
    FONTE[caractere].forEach((linha, ly) => {
      [...linha].forEach((aceso, lx) => {
        if (aceso !== '1') return;
        for (let dy = 0; dy < escala; dy++) {
          for (let dx = 0; dx < escala; dx++) pintar(pixels, lado, x0 + (n * 4 + lx) * escala + dx, y0 + ly * escala + dy, ESCURO, 1);
        }
      });
    });
  });
}

/** A marca sozinha (para a barra de tarefas): a bolinha ocupando o quadrado inteiro. */
function marcaSozinha(quantas, lado) {
  const pixels = Buffer.alloc(lado * lado * 4);
  bolinha(pixels, lado, lado / 2, lado / 2, lado / 2 - 1, textoDaMarca(quantas));
  return pixels;
}

/**
 * O ícone (para a bandeja) com a marca no canto de cima à direita, com ~60% do lado de altura. Se o texto não cabe na
 * bolinha (o "9+" em 16 px), ela vira uma pílula encostada na direita.
 */
function iconeComMarca(icone, lado, quantas) {
  const pixels = Buffer.from(icone);
  const texto = textoDaMarca(quantas);
  const raio = (lado * 0.6) / 2 - 0.5;
  const largura = texto.length * 4 - 1 + 2; // o texto na escala mínima, mais um pixel de folga de cada lado
  const esticar = Math.max(0, (largura - raio * 1.4) / 2);
  bolinha(pixels, lado, lado - raio - esticar - 1, raio + 1, raio, texto, esticar);
  return pixels;
}

module.exports = { textoDaMarca, marcaSozinha, iconeComMarca };
