// Quem mede o quê, uma vez por segundo. Cada amostrador guarda a leitura anterior do getStats e devolve
// a diferença: os contadores do WebRTC são totais desde o começo da conexão.

import { cliente } from '../cliente';
import { ponte } from '../ponte';
import { medidasDaPagina } from '../videoDoApp';
import { FAIXAS, type AmostraCaptura, type AmostraEnvio, type AmostraPc, type AmostraRecepcao, type Ritmo } from './tipos';

type Relatorio = Map<string, any>;

const arredondar = (valor: number, casas = 1) => Math.round(valor * 10 ** casas) / 10 ** casas;
const porQuadro = (ms: number, quadros: number) => (quadros > 0 ? arredondar(ms / quadros) : null);

async function estatisticas(pc: RTCPeerConnection): Promise<Relatorio | null> {
  if (pc.connectionState === 'closed') return null;
  try {
    return (await pc.getStats()) as unknown as Relatorio;
  } catch {
    return null; // fechou durante a leitura
  }
}

/** O par de candidatos em uso: ida e volta, banda estimada e o tipo de caminho. */
function parEscolhido(relatorio: Relatorio) {
  let par: any = null;
  relatorio.forEach((r) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) par = relatorio.get(r.selectedCandidatePairId) ?? par;
    if (!par && r.type === 'candidate-pair' && r.selected) par = r;
  });
  if (!par) return { rttMs: null, bandaMbps: null, rede: null };
  return {
    rttMs: par.currentRoundTripTime != null ? Math.round(par.currentRoundTripTime * 1000) : null,
    bandaMbps: par.availableOutgoingBitrate ? arredondar(par.availableOutgoingBitrate / 1e6, 2) : null,
    rede: relatorio.get(par.remoteCandidateId)?.candidateType ?? null,
  };
}

/** A espera média no jitter buffer entre duas leituras (ms), ou null se nada saiu dele. */
function esperaNoBuffer(r: any, a: any): number | null {
  const emitidos = (r.jitterBufferEmittedCount ?? 0) - (a.jitterBufferEmittedCount ?? 0);
  return emitidos > 0 ? arredondar((((r.jitterBufferDelay ?? 0) - (a.jitterBufferDelay ?? 0)) * 1000) / emitidos) : null;
}

function somRecebidoDe(relatorio: Relatorio) {
  let achado: any = null;
  relatorio.forEach((r) => {
    if (r.type === 'inbound-rtp' && r.kind === 'audio') achado = r;
  });
  return achado;
}

function videoDe(relatorio: Relatorio, tipo: 'outbound-rtp' | 'inbound-rtp') {
  let achado: any = null;
  relatorio.forEach((r) => {
    if (r.type === tipo && r.kind === 'video') achado = r;
  });
  return achado;
}

export class AmostradorEnvio {
  private anterior: any = null;

  constructor(
    readonly pc: RTCPeerConnection,
    readonly espectador: string,
    readonly simulado: boolean,
  ) {}

  async amostrar(t: number): Promise<{ envio: AmostraEnvio; captura: AmostraCaptura } | null> {
    const relatorio = await estatisticas(this.pc);
    if (!relatorio) return null;
    const r = videoDe(relatorio, 'outbound-rtp');
    if (!r) return null;
    const a = this.anterior;
    this.anterior = r;
    const fonte = relatorio.get(r.mediaSourceId);
    const captura: AmostraCaptura = { t, fps: fonte?.framesPerSecond ?? null, largura: fonte?.width ?? null, altura: fonte?.height ?? null };
    if (!a) return null; // a primeira leitura só serve de base para a próxima
    const segundos = (r.timestamp - a.timestamp) / 1000 || 1;
    const delta = (campo: string) => Math.max(0, (r[campo] ?? 0) - (a[campo] ?? 0));
    const codificados = delta('framesEncoded');
    const pacotes = delta('packetsSent');
    return {
      captura,
      envio: {
        t,
        espectador: this.espectador,
        simulado: this.simulado,
        largura: r.frameWidth ?? null,
        altura: r.frameHeight ?? null,
        fpsCodificados: arredondar(codificados / segundos),
        fpsEnviados: arredondar(delta('framesSent') / segundos),
        mbps: arredondar((delta('bytesSent') * 8) / segundos / 1e6, 2),
        alvoMbps: r.targetBitrate ? arredondar(r.targetBitrate / 1e6, 2) : null,
        msCodificacao: porQuadro(delta('totalEncodeTime') * 1000, codificados),
        qp: codificados > 0 && r.qpSum != null ? arredondar(delta('qpSum') / codificados) : null,
        quadrosChave: delta('keyFramesEncoded'),
        limite: r.qualityLimitationReason ?? null,
        msFilaDeEnvio: pacotes > 0 ? arredondar((delta('totalPacketSendDelay') * 1000) / pacotes) : null,
        nacks: delta('nackCount'),
        plis: delta('pliCount'),
        retransmitidosKbps: arredondar((delta('retransmittedBytesSent') * 8) / segundos / 1000),
        ...parEscolhido(relatorio),
        codec: relatorio.get(r.codecId)?.mimeType?.replace('video/', '') ?? null,
        codificador: r.encoderImplementation ?? null,
        codificadorDaPlaca: r.powerEfficientEncoder ?? null,
      },
    };
  }
}

/**
 * O ritmo em que os quadros aparecem na tela, quadro a quadro (requestVideoFrameCallback).
 * É o que a pessoa sente: 60 fps com um quadro de 80 ms no meio é um engasgo, mesmo com a média boa.
 */
export class MedidorDeRitmo {
  private video: HTMLVideoElement | null = null;
  private pedido = 0;
  private ultimaExibicao: number | null = null;
  private ultimosApresentados = 0;
  private intervalos: number[] = [];
  private exibidos = 0;
  private recebidoAteTela: number[] = [];
  private capturaAteTela: number[] = [];
  /** Os últimos 600 intervalos (uns 10 s a 60 fps), para o gráfico ao vivo. */
  readonly historico: number[] = [];

  vincular(video: HTMLVideoElement | null) {
    if (video === this.video) return;
    this.desvincular();
    this.video = video;
    if (video && 'requestVideoFrameCallback' in video) this.pedido = video.requestVideoFrameCallback(this.aoExibir);
  }

  desvincular() {
    if (this.video && this.pedido) this.video.cancelVideoFrameCallback(this.pedido);
    this.video = null;
    this.pedido = 0;
    this.ultimaExibicao = null;
  }

  private aoExibir = (_agora: number, meta: VideoFrameCallbackMetadata) => {
    const video = this.video;
    if (!video) return;
    const exibicao = meta.expectedDisplayTime;
    const novos = this.ultimaExibicao === null ? 1 : Math.max(1, meta.presentedFrames - this.ultimosApresentados);
    if (this.ultimaExibicao !== null) {
      // Quadros apresentados sem chamada (a página estava ocupada) dividem o intervalo entre eles.
      const intervalo = (exibicao - this.ultimaExibicao) / novos;
      for (let i = 0; i < novos; i++) {
        this.intervalos.push(intervalo);
        this.historico.push(intervalo);
      }
      if (this.historico.length > 600) this.historico.splice(0, this.historico.length - 600);
    }
    this.exibidos += novos;
    this.ultimaExibicao = exibicao;
    this.ultimosApresentados = meta.presentedFrames;
    const extras = meta as VideoFrameCallbackMetadata & { receiveTime?: number; captureTime?: number };
    if (extras.receiveTime) this.recebidoAteTela.push(exibicao - extras.receiveTime);
    if (extras.captureTime) this.capturaAteTela.push(exibicao - extras.captureTime);
    this.pedido = video.requestVideoFrameCallback(this.aoExibir);
  };

  /** O resumo do último segundo, e zera para o próximo. null se nada foi exibido. */
  colher(): { exibidos: number; ritmo: Ritmo | null } {
    const intervalos = this.intervalos.sort((x, y) => x - y);
    const exibidos = this.exibidos;
    const media = (lista: number[]) => (lista.length ? arredondar(lista.reduce((s, v) => s + v, 0) / lista.length) : null);
    const percentil = (p: number) => arredondar(intervalos[Math.min(intervalos.length - 1, Math.floor(p * intervalos.length))]);
    const ritmo: Ritmo | null = intervalos.length
      ? {
          quadros: intervalos.length,
          mediaMs: media(intervalos) ?? 0,
          p95Ms: percentil(0.95),
          p99Ms: percentil(0.99),
          maxMs: arredondar(intervalos[intervalos.length - 1]),
          faixas: contarFaixas(intervalos),
          msRecebidoAteTela: media(this.recebidoAteTela.filter((v) => v >= 0 && v < 5000)),
          msCapturaAteTela: media(this.capturaAteTela.filter((v) => v >= 0 && v < 5000)),
        }
      : null;
    this.intervalos = [];
    this.recebidoAteTela = [];
    this.capturaAteTela = [];
    this.exibidos = 0;
    return { exibidos, ritmo };
  }
}

export function contarFaixas(intervalos: number[]): number[] {
  const faixas = FAIXAS.map(() => 0);
  for (const valor of intervalos) faixas[FAIXAS.findIndex((limite) => valor <= limite)]++;
  return faixas;
}

export class AmostradorRecepcao {
  private anterior: any = null;
  private anteriorDoSom: any = null;
  readonly ritmo = new MedidorDeRitmo();

  constructor(
    readonly pc: RTCPeerConnection,
    readonly espectador: string,
    readonly simulado: boolean,
    private readonly acharVideo: () => HTMLVideoElement | null,
  ) {}

  async amostrar(t: number, pagina: { tarefasLongas: number; msTarefaMaior: number }): Promise<AmostraRecepcao | null> {
    this.ritmo.vincular(this.acharVideo()); // o vídeo pode ter mudado de lugar na tela
    const relatorio = await estatisticas(this.pc);
    const { exibidos, ritmo } = this.ritmo.colher();
    if (!relatorio) return null;
    const r = videoDe(relatorio, 'inbound-rtp');
    if (!r) return null;
    const som = somRecebidoDe(relatorio);
    const aDoSom = this.anteriorDoSom;
    this.anteriorDoSom = som;
    const a = this.anterior;
    this.anterior = r;
    if (!a) return null;
    const receptorDeVideo = this.pc.getReceivers().find((x) => x.track.kind === 'video') as
      | (RTCRtpReceiver & { jitterBufferTarget?: number | null })
      | undefined;
    const segundos = (r.timestamp - a.timestamp) / 1000 || 1;
    const delta = (campo: string) => Math.max(0, (r[campo] ?? 0) - (a[campo] ?? 0));
    const decodificados = delta('framesDecoded');
    const emitidos = delta('jitterBufferEmittedCount');
    const somaIntervalos = delta('totalInterFrameDelay');
    const somaQuadrados = delta('totalSquaredInterFrameDelay');
    const mediaIntervalo = decodificados > 0 ? somaIntervalos / decodificados : null;
    const perdidos = delta('packetsLost');
    const recebidos = delta('packetsReceived');
    const janelaVisivel = document.visibilityState === 'visible';
    return {
      t,
      espectador: this.espectador,
      simulado: this.simulado,
      largura: r.frameWidth ?? null,
      altura: r.frameHeight ?? null,
      fpsRecebidos: arredondar(delta('framesReceived') / segundos),
      fpsDecodificados: arredondar(decodificados / segundos),
      fpsExibidos: janelaVisivel && this.acharVideo() ? arredondar(exibidos / segundos) : null,
      mbps: arredondar((delta('bytesReceived') * 8) / segundos / 1e6, 2),
      msDecodificacao: porQuadro(delta('totalDecodeTime') * 1000, decodificados),
      msBuffer: emitidos > 0 ? arredondar((delta('jitterBufferDelay') * 1000) / emitidos) : null,
      msBufferSom: som && aDoSom ? esperaNoBuffer(som, aDoSom) : null,
      folgaMs: receptorDeVideo?.jitterBufferTarget ?? null,
      intervaloMedioMs: mediaIntervalo !== null ? arredondar(mediaIntervalo * 1000) : null,
      intervaloDesvioMs:
        mediaIntervalo !== null ? arredondar(Math.sqrt(Math.max(0, somaQuadrados / decodificados - mediaIntervalo ** 2)) * 1000) : null,
      congelamentos: delta('freezeCount'),
      msCongelado: Math.round(delta('totalFreezesDuration') * 1000),
      descartados: delta('framesDropped'),
      pacotesPerdidos: perdidos,
      perdaPct: perdidos + recebidos > 0 ? arredondar((perdidos / (perdidos + recebidos)) * 100, 2) : 0,
      jitterMs: r.jitter != null ? arredondar(r.jitter * 1000) : null,
      ...(({ rttMs, rede }) => ({ rttMs, rede }))(parEscolhido(relatorio)),
      decodificador: r.decoderImplementation ?? null,
      decodificadorDaPlaca: r.powerEfficientDecoder ?? null,
      ritmo: janelaVisivel ? ritmo : null,
      janelaVisivel,
      tarefasLongas: pagina.tarefasLongas,
      msTarefaMaior: pagina.msTarefaMaior,
    };
  }

  parar() {
    this.ritmo.desvincular();
  }
}

/** Travadas da página: toda tarefa acima de 50 ms (o navegador não desenha nada enquanto ela roda). */
export class MedidorDaPagina {
  private observador: PerformanceObserver | null = null;
  private quantas = 0;
  private maior = 0;
  private usuarios = 0;

  ligar() {
    if (this.usuarios++ > 0) return;
    try {
      this.observador = new PerformanceObserver((lista) => {
        for (const tarefa of lista.getEntries()) {
          this.quantas++;
          this.maior = Math.max(this.maior, tarefa.duration);
        }
      });
      this.observador.observe({ type: 'longtask', buffered: false });
    } catch {
      this.observador = null; // navegador sem longtask: as colunas ficam em zero
    }
  }

  desligar() {
    if (--this.usuarios > 0) return;
    this.usuarios = 0;
    this.observador?.disconnect();
    this.observador = null;
  }

  colher() {
    const resultado = { tarefasLongas: this.quantas, msTarefaMaior: Math.round(this.maior) };
    this.quantas = 0;
    this.maior = 0;
    return resultado;
  }
}

export const medidorDaPagina = new MedidorDaPagina();

/**
 * Os contadores do Windows (processador do PC e placa de vídeo), no app. O teste e a gravação da sala podem
 * estar ligados ao mesmo tempo: só desliga quando o último parar.
 */
class ContadoresDoPc {
  private usuarios = 0;

  ligar() {
    if (this.usuarios++ === 0) void ponte?.desempenho?.ligar(true).catch(() => false);
  }

  desligar() {
    if (this.usuarios === 0) return;
    if (--this.usuarios === 0) void ponte?.desempenho?.ligar(false).catch(() => false);
  }

  /** Um segundo do PC, ou null no navegador (ou num app antes do 1.2.10). */
  async amostrar(t: number): Promise<AmostraPc | null> {
    const bruta = await ponte?.desempenho?.amostra().catch(() => null);
    if (!bruta) return null;
    const soma = (registro: Record<string, number>) => Object.values(registro).reduce((a, b) => a + b, 0);
    const deVideo = (motores: Record<string, number> | undefined) => {
      if (!motores) return null;
      const valores = Object.entries(motores)
        .filter(([nome]) => /video/i.test(nome) && !/jpeg/i.test(nome))
        .map(([, uso]) => uso);
      return valores.length ? Math.max(...valores) : 0;
    };
    const placa = bruta.placa;
    const cpuPorProcesso = Object.fromEntries(Object.entries(bruta.processos).map(([k, v]) => [k, v.cpu]));
    return {
      t,
      cpuApp: Math.round(soma(cpuPorProcesso) * 10) / 10,
      cpuPorProcesso,
      memoriaAppMB: soma(Object.fromEntries(Object.entries(bruta.processos).map(([k, v]) => [k, v.memoriaMB]))),
      cpuPc: bruta.cpuDoPc,
      placa3dTotal: placa?.total['3D'] ?? null,
      placaVideoTotal: deVideo(placa?.total),
      placa3dApp: placa ? (placa.doApp['3D'] ?? 0) : null,
      placaVideoApp: placa ? deVideo(placa.doApp) : null,
      placa3dOutros: placa ? (placa.outros['3D'] ?? 0) : null,
      motores: placa?.total ?? null,
      memoriaPlacaMB: placa?.memoriaMB ?? null,
    };
  }
}

export const contadoresDoPc = new ContadoresDoPc();

/** O <video> que mostra este stream na tela, se houver. */
export function videoDoStream(stream: MediaStream | undefined | null): HTMLVideoElement | null {
  if (!stream) return null;
  return [...document.querySelectorAll('video')].find((video) => video.srcObject === stream) ?? null;
}

/**
 * Uma vez por segundo, na amostra da captura: de onde ela vem e, sendo a do app, o que o auxiliar e a página mediram.
 * (Uma vez só: as medidas da página zeram a cada leitura.)
 */
export async function completarCaptura(captura: AmostraCaptura): Promise<AmostraCaptura> {
  const origem = cliente.origemDaCaptura();
  const pagina = medidasDaPagina();
  if (origem !== 'app') return { ...captura, origem };
  const auxiliar = (await ponte?.video?.medidas?.().catch(() => null)) ?? null;
  return {
    ...captura,
    origem,
    app: {
      novos: auxiliar?.novos ?? null,
      repetidos: auxiliar?.repetidos ?? null,
      msAuxiliar: auxiliar?.msConversao ?? null,
      quadrosNaPagina: pagina?.quadros ?? 0,
      puladosNaPagina: pagina?.pulados ?? 0,
      msAtePagina: pagina?.msAtePagina ?? null,
    },
  };
}
