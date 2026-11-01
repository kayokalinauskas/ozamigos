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
 * a negociação cai sozinha no H.264. recusados: os codecs que ficam de fora, porque o codificador da placa não soltou
 * quadros neles (VigiaDoCodificador), ou que travaram duas vezes no decodificador de quem assiste (VigiaDoDecodificador:
 * aí, a resposta dele os tira), ou, o H.265, em 1080p (aceitaHevc). Com o H.265 e o H.264 recusados, vai o VP8, que
 * codifica no processador: no PC de 31/10/2026 (RX 7900 XT, Windows 26300), a captura entregava a imagem e o codificador
 * da placa não soltava nada nos dois, nem sem HDR, nem em 1080p a 100%, e a tela de quem assistia ficava preta. A gravação
 * do Adrenalin, que usa a placa sem passar pelo Media Foundation do Windows (o caminho do Chromium), funcionava.
 */
export function preferirCodecs(transceptor: RTCRtpTransceiver, recusados: ReadonlySet<string> = new Set()) {
  if (!transceptor.setCodecPreferences) return;
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
  const ordem = ['video/H265', 'video/H264', 'video/VP8'].filter((tipo) => !recusados.has(tipo));
  const preferidos = ordem.flatMap((tipo) => codecs.filter((c) => c.mimeType === tipo));
  if (preferidos.length === 0) return;
  const resto = codecs.filter((c) => !ordem.includes(c.mimeType) && !recusados.has(c.mimeType));
  transceptor.setCodecPreferences([...preferidos, ...resto]);
}

/** O próximo codec quando o codificador de um deles não solta quadros: do H.265 ao H.264 da placa, e dele ao VP8 do processador. */
export const CODEC_SEGUINTE: Readonly<Record<string, string>> = { 'video/H265': 'video/H264', 'video/H264': 'video/VP8' };

/** Conectada há tanto tempo, com a captura entregando, e nenhum quadro codificado: o codificador da placa não funciona. */
export const PRAZO_SEM_QUADROS = 5_000;
// A captura precisa ter entregado ao menos tantos quadros nesse prazo para a culpa ser do codificador. Com a imagem
// parada, a do app repete o último a cada 100 ms e a do Chromium tem o piso de 10 fps (FPS_MINIMO_DA_CAPTURA): dá 50.
const CAPTURADOS_NO_PRAZO = 10;

/** Uma leitura do getStats de uma conexão de envio (lerCodificador). capturados: os quadros da captura até agora, quando o navegador diz. */
export type LeituraDoCodificador = { conectada: boolean; codec: string; codificados: number; capturados?: number };

/**
 * Vigia uma conexão de envio desde a oferta, uma leitura por segundo, até o primeiro quadro codificado.
 * esperar: leia de novo; trocar: refaça a conexão no CODEC_SEGUINTE; funciona e sem-saida (já no VP8): pare.
 * O prazo só conta com a conexão conectada: antes disso, nenhum codificador solta quadros.
 */
export class VigiaDoCodificador {
  private conectadaDesde: number | null = null;
  private capturadosAoConectar = 0;

  ler(leitura: LeituraDoCodificador, agora: number): 'esperar' | 'trocar' | 'funciona' | 'sem-saida' {
    if (leitura.codificados > 0) return 'funciona';
    if (!leitura.codec) return 'esperar'; // ainda sem codec negociado
    if (!(leitura.codec in CODEC_SEGUINTE)) return 'sem-saida';
    if (!leitura.conectada) {
      this.conectadaDesde = null;
      return 'esperar';
    }
    if (this.conectadaDesde === null) {
      this.conectadaDesde = agora;
      this.capturadosAoConectar = leitura.capturados ?? 0;
      return 'esperar';
    }
    if (agora - this.conectadaDesde < PRAZO_SEM_QUADROS) return 'esperar';
    // Sem a contagem da captura, vale só o prazo; com ela, tela sem quadros novos não é culpa do codificador.
    if (leitura.capturados !== undefined && leitura.capturados - this.capturadosAoConectar < CAPTURADOS_NO_PRAZO) return 'esperar';
    return 'trocar';
  }
}

/** Tanto tempo chegando quadros e nenhum decodificado: o decodificador travou (a imagem fica branca ou parada). */
export const PRAZO_SEM_IMAGEM = 5_000;
// Quantos quadros precisam ter chegado nesse prazo para a culpa ser do decodificador, e não de quem parou de mandar. Quem
// transmite manda ao menos 10 por segundo, mesmo com a tela parada (FPS_MINIMO_DA_CAPTURA): dá 50.
const RECEBIDOS_NO_PRAZO = 10;

/** Uma leitura do inbound-rtp de vídeo de uma conexão de recebimento: framesReceived e framesDecoded. */
export type LeituraDoDecodificador = { recebidos: number; decodificados: number };

/**
 * Vigia a imagem que chega durante toda a conexão de recebimento, uma leitura por segundo. refazer: os quadros chegam e
 * nenhum vira imagem há PRAZO_SEM_IMAGEM. Visto em 01/11/2026: H.265 a 2,6 Mbps chegando, 0 fps, mais de mil quadros
 * descartados e a tela branca, até a pessoa sair e entrar de novo (o que refaz a conexão, com decodificador e
 * codificador novos).
 */
export class VigiaDoDecodificador {
  private base: (LeituraDoDecodificador & { momento: number }) | null = null;

  ler(leitura: LeituraDoDecodificador, agora: number): 'esperar' | 'refazer' {
    const base = this.base;
    // Decodificou algo (ou as contagens recomeçaram): o prazo recomeça daqui.
    if (!base || leitura.decodificados !== base.decodificados || leitura.recebidos < base.recebidos) {
      this.base = { ...leitura, momento: agora };
      return 'esperar';
    }
    if (agora - base.momento < PRAZO_SEM_IMAGEM || leitura.recebidos - base.recebidos < RECEBIDOS_NO_PRAZO) return 'esperar';
    this.base = { ...leitura, momento: agora };
    return 'refazer';
  }

  /** Sem leitura que valha (a página escondida não decodifica vídeo): o prazo recomeça na próxima. */
  esquecer() {
    this.base = null;
  }
}

/** Codec, quadros codificados e capturados do vídeo de uma conexão de envio; null sem o vídeo nas estatísticas ainda. */
export async function lerCodificador(pc: RTCPeerConnection): Promise<LeituraDoCodificador | null> {
  const relatorio = await pc.getStats().catch(() => null);
  if (!relatorio) return null;
  let leitura: LeituraDoCodificador | null = null;
  relatorio.forEach((r) => {
    if (r.type !== 'outbound-rtp' || r.kind !== 'video') return;
    leitura = {
      conectada: pc.connectionState === 'connected',
      codec: relatorio.get(r.codecId)?.mimeType ?? '',
      codificados: r.framesEncoded ?? 0,
      capturados: relatorio.get(r.mediaSourceId)?.frames,
    };
  });
  if (!leitura) return null;
  const lida: LeituraDoCodificador = leitura;
  // Sem o codec nas estatísticas (nenhum pacote saiu ainda, em algumas versões), vale o primeiro negociado, o que o envio usa.
  if (!lida.codec) {
    try {
      lida.codec = pc.getSenders().find((s) => s.track?.kind === 'video')?.getParameters().codecs?.[0]?.mimeType ?? '';
    } catch {
      // sem os parâmetros, espera a próxima leitura
    }
  }
  return lida;
}
