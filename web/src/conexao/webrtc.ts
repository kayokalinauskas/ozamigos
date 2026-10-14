// Ajustes e remendos do WebRTC usados pelo vídeo (cliente.ts) e pela voz (voz/voz.ts).

// STUN: servidores públicos que dizem ao navegador qual é o seu endereço visto da internet.
// Dois de empresas diferentes: se uma rede bloquear um, o outro responde.
export const SERVIDORES_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];

/** Uma conexão nova, com vídeo e som pelo mesmo caminho de rede (max-bundle: menos candidatos, conecta mais rápido). */
export function novaPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: SERVIDORES_ICE, bundlePolicy: 'max-bundle' });
}

/**
 * Muda os parâmetros do Opus no SDP: o WebRTC manda mono a 32 kbps, a menos que as duas pontas peçam outra coisa.
 * `marca` é um parâmetro que só existe depois da mudança: com ele já na linha, o SDP volta como estava.
 */
function ajustarOpus(sdp: string, marca: string, extras: string): string {
  const tipo = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp)?.[1];
  if (!tipo) return sdp;
  return sdp.replace(new RegExp(`(a=fmtp:${tipo} [^\\r\\n]*)`), (linha) => (linha.includes(marca) ? linha : `${linha};${extras}`));
}

/** Som de jogo tem esquerda e direita: estéreo e até 128 kbps. */
export function opusEstereo(sdp: string): string {
  return ajustarOpus(sdp, 'stereo=1', 'stereo=1;sprop-stereo=1;maxaveragebitrate=128000');
}

/** Voz em Opus mono, como no Discord: 64 kbps, correção de perda (FEC) e quase nada enviado no silêncio (DTX). */
export function opusDeVoz(sdp: string): string {
  return ajustarOpus(sdp, 'usedtx', 'useinbandfec=1;usedtx=1;maxaveragebitrate=64000');
}

/**
 * Um caminho de rede que o navegador recusa (de uma rede que ele não usa, ou que chegou com a conexão já
 * fechada) só fica de fora. Antes, a recusa interrompia a resposta à oferta, e o vídeo nunca chegava.
 */
export async function adicionarCandidato(pc: RTCPeerConnection, candidato: RTCIceCandidateInit) {
  try {
    await pc.addIceCandidate(candidato);
  } catch (erro) {
    console.warn('Candidato ICE recusado', erro);
  }
}

/** Quanto quem assiste segura de imagem antes de mostrar (folga.ts). */
export function definirFolga(receptor: RTCRtpReceiver, ms: number) {
  try {
    (receptor as RTCRtpReceiver & { jitterBufferTarget: number | null }).jitterBufferTarget = ms;
  } catch (erro) {
    console.warn('O navegador não aceitou a folga de rede', erro);
  }
}

/**
 * O primeiro uso do WebRTC na página pergunta à placa de vídeo quais codecs ela tem, e isso trava a
 * página por até 1,6 s (medido numa Radeon RX 7800 XT). Sem isto, a trava caía na hora em que o
 * primeiro amigo clicava em Assistir: a interface congelava e o som do PC picotava logo no começo.
 * Feito logo depois de entrar na sala, ninguém percebe, e as conexões seguintes já saem prontas.
 */
export function aquecerWebRtc() {
  setTimeout(() => {
    try {
      RTCRtpReceiver.getCapabilities('video');
    } catch {
      // navegador sem WebRTC completo: a conexão de verdade mostra o erro
    }
  }, 300);
}

/** H.264 é o codec que quase toda placa de vídeo codifica em hardware. */
export function preferirH264(transceptor: RTCRtpTransceiver) {
  if (!transceptor.setCodecPreferences) return;
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
  const h264 = codecs.filter((c) => c.mimeType === 'video/H264');
  if (h264.length === 0) return;
  transceptor.setCodecPreferences([...h264, ...codecs.filter((c) => c.mimeType !== 'video/H264')]);
}
