// As regras das imagens do chat, sem DOM: o tamanho final, os limites e a leitura do cabeçalho do WebP.
// Quem manda (o compressor) e quem recebe (protocolo.ts) usam as mesmas, para os dois lados concordarem.

/** A área máxima: uma tela 2560×1440. Um print 1440p chega intacto; um 4K vira 2560×1440. */
export const AREA_MAXIMA = 2560 * 1440;
/** O lado maior, mesmo com a área dentro: um print ultrawide 3440×1440 vira ~2970×1240, e não uma faixa estreita. */
export const LADO_MAXIMO = 3840;
/**
 * O teto de bytes de uma imagem pronta. Medido em 17/10/2026 com prints reais (2560×1440, Path of Exile e Factorio):
 * na qualidade 85 com sharp YUV, os de jogo deram de 0,9 a 1,4 MB e os de texto ~0,2 MB. Acima do teto, a qualidade
 * desce (QUALIDADES): pedir ao libwebp um tamanho (target_size) levava ~2,3 s, contra ~0,5 s de uma tentativa.
 */
export const TETO_DE_BYTES = 1_500_000;
export const QUALIDADES = [85, 75, 65] as const;
/** Quem recebe recusa acima disso: o teto mais a folga de uma imagem que, na última qualidade, ainda passou um pouco. */
export const MAXIMO_RECEBIDO = 2_000_000;
/** O arquivo escolhido ou colado: acima disso nem tenta abrir (um PNG de 2560×1440 tem até ~9 MB). */
export const MAXIMO_DE_ENTRADA = 50 * 1024 * 1024;
export const IMAGENS_POR_ENVIO = 4;
/** A miniatura borrada que chega antes da imagem: o lado maior dela, e o tamanho máximo aceito. */
export const LADO_DA_MINIATURA = 32;
export const MAXIMO_DA_MINIATURA = 4_000; // em caracteres de base64

/** O tamanho em que a imagem vai: dentro da área e do lado máximos, sem esticar a pequena. */
export function tamanhoFinal(largura: number, altura: number): { largura: number; altura: number } {
  const escala = Math.min(1, Math.sqrt(AREA_MAXIMA / (largura * altura)), LADO_MAXIMO / Math.max(largura, altura));
  return { largura: Math.max(1, Math.floor(largura * escala)), altura: Math.max(1, Math.floor(altura * escala)) };
}

/** Uma imagem com esse tamanho pode ter saído de tamanhoFinal (o que quem recebe confere antes de decodificar). */
export function tamanhoAceito(largura: number, altura: number): boolean {
  return (
    Number.isInteger(largura) &&
    Number.isInteger(altura) &&
    largura >= 1 &&
    altura >= 1 &&
    largura * altura <= AREA_MAXIMA &&
    Math.max(largura, altura) <= LADO_MAXIMO
  );
}

/** A miniatura, no mesmo formato da imagem, com o lado maior em LADO_DA_MINIATURA. */
export function tamanhoDaMiniatura(largura: number, altura: number): { largura: number; altura: number } {
  const escala = LADO_DA_MINIATURA / Math.max(largura, altura);
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) };
}

/**
 * Vale também tentar sem perda? Só em print simples (área de trabalho, texto): o PNG dele tem poucos bytes por pixel.
 * Medido: num print de texto, sem perda deu 177 KB contra 214 KB com perda; num de jogo, 5 a 7 MB e 2 a 3 s.
 */
export function valeTentarSemPerda(tipo: string, bytes: number, largura: number, altura: number): boolean {
  return tipo === 'image/png' && bytes / (largura * altura) < 0.2;
}

const texto = (b: Uint8Array, inicio: number) => String.fromCharCode(b[inicio], b[inicio + 1], b[inicio + 2], b[inicio + 3]);

/**
 * A largura e a altura escritas no cabeçalho de um WebP (VP8, VP8L ou VP8X), ou null se não for um WebP.
 * Quem recebe confere isso antes de mostrar: um arquivo que diz 2560×1440 e decodifica em 16000×16000 travaria a página.
 */
export function tamanhoDoWebp(b: Uint8Array): { largura: number; altura: number } | null {
  if (b.length < 30 || texto(b, 0) !== 'RIFF' || texto(b, 8) !== 'WEBP') return null;
  const tipo = texto(b, 12);
  if (tipo === 'VP8 ') {
    // Quadro-chave: 3 bytes de marca, o código 9d 01 2a, e os 14 bits de cada lado.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { largura: (b[26] | (b[27] << 8)) & 0x3fff, altura: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (tipo === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { largura: (bits & 0x3fff) + 1, altura: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (tipo === 'VP8X') {
    return { largura: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, altura: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
  }
  return null;
}
