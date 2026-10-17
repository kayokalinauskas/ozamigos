// A captura de vídeo do app para Windows (1.2.18 em diante): o auxiliar do app (OzamigosCaptura.exe) captura a janela
// ou a tela pelo Windows, reduz e converte na placa de vídeo, e manda os quadros prontos (NV12) para cá. Aqui eles
// viram a trilha de vídeo da transmissão, como o som do PC em somDoApp.ts. Com o jogo pesado, a captura do Chromium
// ficava em ~21 fps; esta, em 28–30 (Path of Exile, 17/10/2026).
//
// A captura antiga (a do Chromium) continua a um atalho escondido (Ctrl+Shift+N na sala), para comparar as duas com
// os amigos; a escolha fica no localStorage.

import { lembrado, lembrar } from './armazenamento';
import { ponte, type TamanhoDaCaptura } from './ponte';
import { QUALIDADES, type Qualidade } from './qualidade';

const CHAVE = 'ozamigos-captura'; // 'navegador': a captura antiga

// Só existe na janela (não no worker) neste Chromium; o VideoTrackGenerator do padrão ainda não.
declare class MediaStreamTrackGenerator extends MediaStreamTrack {
  constructor(opcoes: { kind: 'video' });
  readonly writable: WritableStream<VideoFrame>;
}

let trilha: MediaStreamTrackGenerator | null = null;
let escritor: WritableStreamDefaultWriter<VideoFrame> | null = null;
// A captura do app parou sozinha nesta sessão: até recarregar a página, vai a do Chromium.
let falhou = false;

/** O app sabe capturar e a página sabe montar a trilha. */
export function capturaDoAppExiste(): boolean {
  return Boolean(ponte?.video) && 'MediaStreamTrackGenerator' in window && 'VideoFrame' in window;
}

/** A próxima transmissão vai pela captura do app? */
export function usarCapturaDoApp(): boolean {
  return capturaDoAppExiste() && !falhou && lembrado(CHAVE) !== 'navegador';
}

/** Troca entre a captura do app e a antiga (do Chromium); vale a partir da próxima escolha do que transmitir. */
export function alternarCaptura(): 'app' | 'navegador' {
  const nova = lembrado(CHAVE) === 'navegador' ? 'app' : 'navegador';
  lembrar(CHAVE, nova === 'navegador' ? 'navegador' : '');
  falhou = false;
  return nova;
}

/**
 * Monta a trilha (se ainda não houver) antes de responder ao seletor: o primeiro quadro chega junto com a resposta.
 * Devolve o tamanho e o fps a pedir ao app: os mesmos da captura do Chromium (o tamanho máximo, sem mudar a proporção).
 */
export function prepararVideoDoApp(qualidade: Qualidade): TamanhoDaCaptura {
  if (!trilha) {
    trilha = new MediaStreamTrackGenerator({ kind: 'video' });
    escritor = trilha.writable.getWriter();
    ponte?.video?.aoReceberQuadro(escrever);
  }
  const { altura, fps } = QUALIDADES[qualidade];
  return { largura: Math.round((altura * 16) / 9), altura, fps };
}

/** A trilha com os quadros do app; a mesma ao trocar de fonte (como o som do PC). */
export function trilhaDoVideoDoApp(): MediaStreamTrack | null {
  return trilha;
}

export function ehVideoDoApp(video: MediaStreamTrack | undefined): boolean {
  return video !== undefined && video === trilha;
}

function escrever(dados: Uint8Array) {
  if (!escritor) return;
  // A página ficou para trás (uma trava da thread principal): pula o quadro em vez de acumular atraso.
  if ((escritor.desiredSize ?? 1) <= 0) return;
  const cabecalho = new DataView(dados.buffer, dados.byteOffset, 24);
  const quadro = new VideoFrame(dados.subarray(24), {
    format: 'NV12',
    codedWidth: cabecalho.getUint16(4, true),
    codedHeight: cabecalho.getUint16(6, true),
    timestamp: Math.round(cabecalho.getFloat64(16, true) * 1000), // em µs, do momento da captura
    // O app converte para BT.709 de faixa limitada (Conversor.cs).
    colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
  });
  escritor.write(quadro).catch(() => quadro.close());
}

/** Desliga a captura do app e a trilha (parou de transmitir, ou trocou para a captura do Chromium). */
export function pararVideoDoApp() {
  ponte?.video?.parar();
  if (!trilha) return;
  ponte?.video?.aoReceberQuadro(() => undefined);
  escritor?.close().catch(() => undefined);
  trilha.stop();
  trilha = null;
  escritor = null;
}

/** A captura do app parou sozinha. motivo 'falhou': as próximas vão pela do Chromium até recarregar. */
export function aoPararVideoDoApp(ouvinte: (aviso: { motivo: 'fechou' | 'falhou'; fonte: string }) => void) {
  ponte?.video?.aoParar((aviso) => {
    if (aviso.motivo === 'falhou') falhou = true;
    ouvinte(aviso);
  });
}
