// A captura da tela de quem transmite e o que se pede ao codificador, conforme a qualidade escolhida.

import { QUALIDADES, type Qualidade } from '../qualidade';
import { preferirH264 } from './webrtc';

export type Fonte = 'aplicativo' | 'tela' | 'escolher';

// Com a tela parada, a captura do Chromium só entrega quadro quando algo muda (até 1 fps). Quem assiste via
// isso como congelamento (51 num relatório real, mostrando o Explorer). Com um piso, o Chromium repete o último
// quadro quando nenhum chega em 100 ms. É baixo de propósito: cada repetição é uma captura a mais, e o jogo
// que já sai a ~21 fps (um quadro a cada ~47 ms) nunca chega a pedir uma.
export const FPS_MINIMO_DA_CAPTURA = 10;

/**
 * A captura já sai no tamanho e no fps da qualidade (o navegador reduz a imagem uma vez só, na placa
 * de vídeo). Antes, cada amigo assistindo tinha o seu codificador reduzindo a mesma imagem, e a escala
 * ficava errada se a janela do jogo mudasse de tamanho no meio da transmissão.
 * comPiso: o getDisplayMedia não aceita "min"; o piso entra depois, por applyConstraints.
 */
export function tamanhoDaCaptura(qualidade: Qualidade, comPiso = false): MediaTrackConstraints {
  const { altura, fps } = QUALIDADES[qualidade];
  return {
    width: { max: Math.round((altura * 16) / 9) },
    height: { max: altura },
    frameRate: comPiso ? { min: FPS_MINIMO_DA_CAPTURA, ideal: fps, max: fps } : { ideal: fps, max: fps },
  };
}

/**
 * Os parâmetros do codificador para a qualidade (o tamanho vem da captura, sem escala aqui).
 * `fracao` do bitrate: as conexões novas começam com menos (BITRATE_INICIAL em cliente.ts).
 */
export function codificacao(qualidade: Qualidade, fracao = 1): RTCRtpEncodingParameters {
  const { bitrate, fps } = QUALIDADES[qualidade];
  return { maxBitrate: Math.round(bitrate * fracao), maxFramerate: fps, scaleResolutionDownBy: 1 };
}

/** Abre o seletor do navegador (ou o do app, no Windows). null se a pessoa cancelou. */
export async function capturarDoNavegador(fonte: Fonte, qualidade: Qualidade): Promise<MediaStream | null> {
  const superficie = fonte === 'aplicativo' ? 'window' : fonte === 'tela' ? 'monitor' : undefined;
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: {
        ...(superficie ? { displaySurface: superficie } : {}), // abre o seletor já na aba certa
        ...tamanhoDaCaptura(qualidade),
      },
      // Som de jogo é música, não voz: nada de cancelar eco, tirar ruído ou mexer no volume.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Opções que só o Chrome e o Edge conhecem (os outros ignoram):
      ...{
        monitorTypeSurfaces: fonte === 'aplicativo' ? 'exclude' : 'include',
        selfBrowserSurface: 'exclude', // não oferecer a própria aba do Ozamigos
        systemAudio: 'include',
      },
    } as DisplayMediaStreamOptions);
  } catch {
    return null; // a pessoa cancelou o seletor
  }
}

/** "Um aplicativo, com som": o que está sendo transmitido, para a tela e para o relatório. */
export function descreverFonte(tela: MediaStream): string {
  const { displaySurface } = tela.getVideoTracks()[0].getSettings() as MediaTrackSettings & { displaySurface?: string };
  const nomes: Record<string, string> = { window: 'Um aplicativo', monitor: 'A tela inteira', browser: 'Uma aba' };
  const audio = tela.getAudioTracks().length > 0 ? 'com som' : 'sem som';
  return `${nomes[displaySurface ?? ''] ?? 'Sua tela'}, ${audio}`;
}

/** Vídeo e som da tela numa conexão de envio, com a qualidade de agora (e uma fração do bitrate, se pedida). */
export function montarEnvio(tela: MediaStream, qualidade: Qualidade, pc: RTCPeerConnection, fracaoDoBitrate = 1) {
  const [video] = tela.getVideoTracks();
  const transceptor = pc.addTransceiver(video, {
    direction: 'sendonly',
    streams: [tela],
    sendEncodings: [codificacao(qualidade, fracaoDoBitrate)],
  });
  preferirH264(transceptor);
  // Sempre cria o canal de áudio, mesmo sem áudio agora: assim a troca de fonte não precisa renegociar.
  // O som vai sem MediaStream (outro que o do vídeo) de propósito: na mesma, quem assiste sincroniza os dois, e a imagem
  // esperava o som. No celular, com a saída de áudio lenta do Android, isso deixava a imagem ~0,6 s atrasada (relatório
  // real de 14/10/2026: buffer de vídeo de 550 a 850 ms com a folga pedindo no máximo 250). Separados, a imagem sai
  // assim que chega; o som pode ficar uma fração de segundo atrás dela no celular.
  const [audio] = tela.getAudioTracks();
  pc.addTransceiver(audio ?? 'audio', { direction: 'sendonly' });
}
