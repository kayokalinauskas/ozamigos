// Ajustes e remendos do WebRTC usados pelo vídeo (cliente.ts) e pela voz (voz/voz.ts).

// STUN: servidores públicos que dizem ao navegador qual é o seu endereço visto da internet.
// Dois de empresas diferentes: se uma rede bloquear um, o outro responde.
export const SERVIDORES_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];

/** Para que é a conexão: a da voz (que leva também as imagens do chat) ou a de uma transmissão. */
export type UsoDaConexao = 'voz' | 'video';

/**
 * A retransmissão (TURN), que o servidor manda no `bem-vindo` e renova (`retransmissao`): o caminho de reserva para
 * quem não conecta direto. Com ela na lista, o navegador ainda prefere o caminho direto; só usa a retransmissão quando
 * ele falha. Uma credencial para cada uso (Retransmissao.java): o servidor corta só o vídeo de quem gasta muito, e a
 * voz continua. Vazia: o servidor não deu (desligada, ou um limite de consumo).
 */
const retransmissao: Record<UsoDaConexao, RTCIceServer[]> = { voz: [], video: [] };
const abertas = new Map<RTCPeerConnection, UsoDaConexao>();

/** Troca a retransmissão das conexões novas, e também das abertas (vale nas próximas buscas de caminho delas). */
export function definirRetransmissao(uso: UsoDaConexao, servidores: RTCIceServer[]) {
  if (JSON.stringify(servidores) === JSON.stringify(retransmissao[uso])) return; // sem ela (desligada no servidor), nada muda
  retransmissao[uso] = servidores;
  for (const [pc, usoDela] of abertas) {
    if (pc.signalingState === 'closed') {
      abertas.delete(pc);
      continue;
    }
    if (usoDela !== uso) continue;
    try {
      pc.setConfiguration({ ...pc.getConfiguration(), iceServers: [...SERVIDORES_ICE, ...servidores] });
    } catch (erro) {
      console.warn('A conexão não aceitou a retransmissão nova', erro);
    }
  }
}

/** As conexões abertas de um uso (para saber se alguma passa pela retransmissão). */
export function conexoesAbertas(uso: UsoDaConexao): RTCPeerConnection[] {
  for (const pc of abertas.keys()) if (pc.signalingState === 'closed') abertas.delete(pc);
  return [...abertas].filter(([, u]) => u === uso).map(([pc]) => pc);
}

/** Uma conexão nova, com vídeo e som pelo mesmo caminho de rede (max-bundle: menos candidatos, conecta mais rápido). */
export function novaPeerConnection(uso: UsoDaConexao): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: [...SERVIDORES_ICE, ...retransmissao[uso]], bundlePolicy: 'max-bundle' });
  abertas.set(pc, uso);
  return pc;
}

/** Por onde uma conexão conectada passa: direto, ou pela retransmissão (para o relatório). */
export async function caminhoDaConexao(pc: RTCPeerConnection): Promise<'direto' | 'retransmitido' | null> {
  try {
    const relatorio = await pc.getStats();
    let par: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
    relatorio.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) par = relatorio.get(r.selectedCandidatePairId);
    });
    if (!par) return null;
    const tipos = [par.localCandidateId, par.remoteCandidateId].map((id) => (id ? relatorio.get(id)?.candidateType : undefined));
    return tipos.includes('relay') ? 'retransmitido' : 'direto';
  } catch {
    return null;
  }
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

/**
 * H.265 (HEVC) quando os dois lados conseguem, e o H.264 de reserva. Medido no app (17/10/2026, AMD RX 7800 XT, os dois
 * na placa de vídeo, 720p a 30 fps, um jogo rolando): o H.265 a 4 Mbps deu 32,7 dB de PSNR usando 3,9 Mbps, e o H.264
 * 31,0 dB passando do alvo (4,6 Mbps); o H.265 a 4 Mbps ficou melhor que o H.264 a 6,5 Mbps, por ~1 ms a mais de
 * codificação por quadro. O AV1 e o VP9 deste Chromium codificam no processador (o dobro do tempo): ficam de fora.
 * O Chromium só oferece o H.265 com a placa de vídeo codificando (quem transmite) e decodificando (quem assiste): sem isso,
 * a negociação cai sozinha no H.264. hevcRecusado: o codificador H.265 desta placa não soltou quadros (cliente.ts).
 */
export function preferirCodecs(transceptor: RTCRtpTransceiver, hevcRecusado = false) {
  if (!transceptor.setCodecPreferences) return;
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
  const ordem = hevcRecusado ? ['video/H264'] : ['video/H265', 'video/H264'];
  const preferidos = ordem.flatMap((tipo) => codecs.filter((c) => c.mimeType === tipo));
  if (preferidos.length === 0) return;
  const resto = codecs.filter((c) => !ordem.includes(c.mimeType) && !(hevcRecusado && c.mimeType === 'video/H265'));
  transceptor.setCodecPreferences([...preferidos, ...resto]);
}
