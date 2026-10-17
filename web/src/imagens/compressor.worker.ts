// Prepara uma imagem para o chat fora da thread da página: abre, reduz se precisar e comprime em WebP.
// Comprimir um print 2560×1440 leva ~0,5 s; na página, isso travaria a transmissão e o som de quem manda.
//
// O codificador é o libwebp completo (jSquash), e não o WebP do canvas do navegador, por dois motivos medidos:
// - use_sharp_yuv: o WebP guarda a cor em meia resolução, e linhas finas coloridas (o vermelho de um ícone, texto
//   colorido de jogo) desbotavam no do navegador. Com o sharp YUV, ficam iguais ao original;
// - o Safari não gera WebP pelo canvas (devolve PNG sem avisar).
import codificar, { init as iniciarCodificador } from '@jsquash/webp/encode';
import urlDoCodificador from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import urlDoCodificadorSimd from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';
import { MAXIMO_DE_ENTRADA, QUALIDADES, TETO_DE_BYTES, tamanhoDaMiniatura, tamanhoFinal, valeTentarSemPerda } from './regras';

export type PedidoDeCompressao = { pedido: number; arquivo: Blob };
export type ImagemComprimida = { bytes: Uint8Array; largura: number; altura: number; miniatura: string };
export type ResultadoDaCompressao = ({ ok: true } & ImagemComprimida) | { ok: false; motivo: 'nao-e-imagem' | 'grande-demais' | 'sem-codificador' };
export type RespostaDaCompressao = ResultadoDaCompressao & { pedido: number };

const escopo = globalThis as unknown as {
  onmessage: ((evento: MessageEvent<PedidoDeCompressao>) => void) | null;
  postMessage(resposta: RespostaDaCompressao, transferir?: Transferable[]): void;
};

/** O codificador carrega uma vez, na primeira imagem (~340 KB). A versão com SIMD é mais rápida, quando o navegador tem. */
let codificador: Promise<boolean> | null = null;
function carregar(): Promise<boolean> {
  codificador ??= (async () => {
    try {
      const simd = await fetch(urlDoCodificadorSimd).then((r) => r.arrayBuffer());
      const binario = WebAssembly.validate(simd) ? simd : await fetch(urlDoCodificador).then((r) => r.arrayBuffer());
      await iniciarCodificador(await WebAssembly.compile(binario));
      return true;
    } catch {
      return false; // sem WebAssembly: fica com o WebP do canvas, se o navegador tiver
    }
  })();
  return codificador;
}

const OPCOES = { method: 4, use_sharp_yuv: 1 };

async function comLibwebp(dados: ImageData, opcoes: Record<string, number>): Promise<Uint8Array> {
  return new Uint8Array(await codificar(dados, { ...OPCOES, ...opcoes }));
}

async function comCanvas(tela: OffscreenCanvas, qualidade: number): Promise<Uint8Array | null> {
  const blob = await tela.convertToBlob({ type: 'image/webp', quality: qualidade / 100 });
  return blob.type === 'image/webp' ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** A melhor qualidade que cabe no teto; em print simples, também sem perda, e fica o menor. */
async function nesteTamanho(tela: OffscreenCanvas, dados: ImageData, semPerda: boolean): Promise<Uint8Array | null> {
  const libwebp = await carregar();
  let melhor: Uint8Array | null = null;
  for (const qualidade of QUALIDADES) {
    melhor = libwebp ? await comLibwebp(dados, { quality: qualidade }) : await comCanvas(tela, qualidade);
    if (!melhor || melhor.length <= TETO_DE_BYTES) break;
  }
  if (libwebp && semPerda) {
    const exata = await comLibwebp(dados, { lossless: 1, quality: 50, method: 3 });
    if (!melhor || exata.length < melhor.length) melhor = exata;
  }
  return melhor;
}

async function miniaturaDe(imagem: ImageBitmap): Promise<string> {
  const { largura, altura } = tamanhoDaMiniatura(imagem.width, imagem.height);
  const tela = new OffscreenCanvas(largura, altura);
  const g = tela.getContext('2d')!;
  g.drawImage(imagem, 0, 0, largura, altura);
  const bytes = (await carregar()) ? await comLibwebp(g.getImageData(0, 0, largura, altura), { quality: 40, method: 4 }) : await comCanvas(tela, 40);
  if (!bytes) return '';
  let texto = '';
  for (const byte of bytes) texto += String.fromCharCode(byte);
  return btoa(texto);
}

async function preparar(arquivo: Blob): Promise<ResultadoDaCompressao> {
  if (arquivo.size > MAXIMO_DE_ENTRADA) return { ok: false, motivo: 'grande-demais' };
  let original: ImageBitmap;
  try {
    // Do jeito que a foto foi tirada (a rotação do celular); de um GIF animado, só o primeiro quadro.
    original = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, motivo: 'nao-e-imagem' };
  }
  const semPerda = valeTentarSemPerda(arquivo.type, arquivo.size, original.width, original.height);
  const [pronta, miniatura] = await Promise.all([comprimir(original, semPerda), miniaturaDe(original)]);
  original.close();
  if (!pronta) return { ok: false, motivo: 'sem-codificador' };
  return { ok: true, ...pronta, miniatura };
}

/**
 * No tamanho da regra; se nem a menor qualidade couber no teto (uma imagem só de ruído, que quase não comprime),
 * a imagem diminui até caber. Nada sai acima do teto: quem recebe recusaria.
 */
async function comprimir(original: ImageBitmap, semPerda: boolean): Promise<{ bytes: Uint8Array; largura: number; altura: number } | null> {
  let { largura, altura } = tamanhoFinal(original.width, original.height);
  for (;;) {
    const tela = new OffscreenCanvas(largura, altura);
    const g = tela.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(original, 0, 0, largura, altura); // redesenhada: os dados escondidos do arquivo (GPS da foto) ficam para trás
    const bytes = await nesteTamanho(tela, g.getImageData(0, 0, largura, altura), semPerda);
    if (!bytes || bytes.length <= TETO_DE_BYTES || largura * altura <= 64 * 64) return bytes && { bytes, largura, altura };
    largura = Math.max(1, Math.floor(largura * 0.8));
    altura = Math.max(1, Math.floor(altura * 0.8));
  }
}

escopo.onmessage = async ({ data: { pedido, arquivo } }) => {
  const resposta: RespostaDaCompressao = { ...(await preparar(arquivo)), pedido };
  escopo.postMessage(resposta, resposta.ok ? [resposta.bytes.buffer as ArrayBuffer] : []);
};
