// A captura de vídeo do app para Windows (1.2.18 em diante): o auxiliar do app (OzamigosCaptura.exe) captura a janela
// ou a tela pelo Windows, reduz e converte na placa de vídeo, e manda os quadros prontos (NV12) para cá. Aqui eles
// viram a trilha de vídeo da transmissão, como o som do PC em somDoApp.ts. Com o jogo pesado, a captura do Chromium
// ficava em ~21 fps; esta, em 28–30 (Path of Exile, 17/10/2026).
//
// A captura antiga (a do Chromium) continua a um atalho escondido (Ctrl+Shift+N na sala), para comparar as duas com
// os amigos; a escolha fica no localStorage.

import { lembrado, lembrar } from './armazenamento';
import type { Mensagem } from './videoDoApp.worker';
import { ponte, type TamanhoDaCaptura } from './ponte';
import { QUALIDADES, type Qualidade } from './qualidade';

const CHAVE = 'ozamigos-captura'; // 'navegador': a captura antiga

// Só existe na janela (não no worker) neste Chromium; o VideoTrackGenerator do padrão ainda não.
declare class MediaStreamTrackGenerator extends MediaStreamTrack {
  constructor(opcoes: { kind: 'video' });
  readonly writable: WritableStream<VideoFrame>;
}

let trilha: MediaStreamTrackGenerator | null = null;
let trabalhador: Worker | null = null;
let portaEsperando: MessagePort | null = null;
// Para a gravação das estatísticas: o que chegou à página desde a última leitura (medidasDaPagina).
let chegaram = 0;
let pulados = 0;
let somaDoAtraso = 0;
let escritor: WritableStreamDefaultWriter<VideoFrame> | null = null;
// A captura do app parou sozinha nesta sessão: até recarregar a página, vai a do Chromium.
let falhou = false;

/**
 * O app (1.2.19 em diante) manda os quadros por um canal direto a um worker, com controle de fluxo. No 1.2.18, eles
 * chegam pela thread da página, que não aguenta 720p a 60 nem 1080p (o atraso crescia sem parar): só o 720p · 30.
 */
export function canalDireto(): boolean {
  return Boolean(ponte?.video?.canalDireto) && capturaDoAppExiste();
}

// A porta do canal direto chega do preload por um postMessage da própria janela (é assim que um MessagePort passa do
// preload para a página no Electron). Só vale a mensagem da própria janela e da mesma origem.
if (ponte?.video?.canalDireto) {
  addEventListener('message', (evento) => {
    if (evento.source !== window || evento.origin !== location.origin || evento.data !== 'ozamigos-porta-do-video') return;
    const [porta] = evento.ports;
    if (!porta) return;
    if (trabalhador) trabalhador.postMessage(null, [porta]);
    else portaEsperando = porta;
  });
}

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
    if (canalDireto()) {
      if (!trabalhador) {
        trabalhador = new Worker(new URL('./videoDoApp.worker.ts', import.meta.url), { type: 'module' });
        trabalhador.onmessage = ({ data }: MessageEvent<Mensagem>) => entregar(data.quadro, data.capturado, data.chegou);
        if (portaEsperando) trabalhador.postMessage(null, [portaEsperando]);
        portaEsperando = null;
      }
    } else {
      ponte?.video?.aoReceberQuadro(escrever);
    }
  }
  const { altura, fps } = QUALIDADES[qualidade];
  return { largura: Math.round((altura * 16) / 9), altura, fps, canal: canalDireto() };
}

/** A trilha com os quadros do app; a mesma ao trocar de fonte (como o som do PC). */
export function trilhaDoVideoDoApp(): MediaStreamTrack | null {
  return trilha;
}

export function ehVideoDoApp(video: MediaStreamTrack | undefined): boolean {
  return video !== undefined && video === trilha;
}

/** Um quadro pronto (do worker ou do caminho antigo) vai para a trilha, se a página não estiver atrasada. */
function entregar(quadro: VideoFrame, capturado: number, chegou: number) {
  if (!escritor) {
    quadro.close(); // parou de transmitir: os que estavam no caminho não servem mais
    return;
  }
  chegaram++;
  somaDoAtraso += chegou - capturado;
  // A página ficou para trás (uma trava da thread principal): pula o quadro em vez de acumular atraso.
  if ((escritor.desiredSize ?? 1) <= 0) {
    pulados++;
    quadro.close();
    return;
  }
  escritor.write(quadro).catch(() => quadro.close());
}

/** O caminho do app 1.2.18: o quadro chega pela thread da página (ipcRenderer). */
function escrever(dados: Uint8Array) {
  if (!escritor) return;
  const cabecalho = new DataView(dados.buffer, dados.byteOffset, 24);
  const chegou = performance.timeOrigin + performance.now();
  const quadro = new VideoFrame(dados.subarray(24), {
    format: 'NV12',
    codedWidth: cabecalho.getUint16(4, true),
    codedHeight: cabecalho.getUint16(6, true),
    timestamp: Math.round(cabecalho.getFloat64(16, true) * 1000), // em µs, do momento da captura
    // O app converte para BT.709 de faixa limitada (Conversor.cs).
    colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
  });
  entregar(quadro, cabecalho.getFloat64(16, true), chegou);
}

/**
 * Desde a última leitura: quantos quadros chegaram à página, quantos ela pulou (estava travada) e quanto, em média,
 * cada um levou da captura até chegar aqui. null sem quadros.
 */
export function medidasDaPagina(): { quadros: number; pulados: number; msAtePagina: number } | null {
  const medidas = chegaram > 0 ? { quadros: chegaram, pulados, msAtePagina: Math.round((somaDoAtraso / chegaram) * 10) / 10 } : null;
  chegaram = pulados = somaDoAtraso = 0;
  return medidas;
}

/** Desliga a captura do app e a trilha (parou de transmitir, ou trocou para a captura do Chromium). */
export function pararVideoDoApp() {
  ponte?.video?.parar();
  if (!trilha) return;
  ponte?.video?.aoReceberQuadro(() => undefined);
  // Fechar a escrita encerra a trilha com o evento "ended", que é o "parar de transmitir" de quem a usa (usarTela). Na
  // troca da captura do app para a do Chromium, isso encerrava a transmissão inteira: o aviso sai antes.
  trilha.onended = null;
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
