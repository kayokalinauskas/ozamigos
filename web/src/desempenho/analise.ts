// Transforma a gravação em conclusões: médias de cada trecho, diagnósticos com as evidências e uma
// recomendação. As regras ficam todas aqui, com os limites explícitos, para que a IA que ler o relatório
// saiba exatamente por que cada conclusão foi tirada (e possa discordar).

import { FOLGA } from '../folga';
import { QUALIDADES, type Qualidade } from '../qualidade';
import { FAIXAS, SEGUNDOS_DESCARTADOS, type AmostraRecepcao, type Gravacao, type Trecho } from './tipos';

export type Resultado = 'otimo' | 'bom' | 'atencao' | 'ruim';

export type ResumoDoTrecho = {
  trecho: Trecho;
  segundos: number; // analisados (sem os descartados)
  alvoFps: number;
  conteudoFps: number; // o que dá para mostrar: o menor entre o alvo e a captura
  captura: {
    fps: number | null;
    altura: number | null;
    /** A captura do app (1.2.18) ou a do Chromium; null nas gravações de antes. */
    origem: 'app' | 'navegador' | null;
    /** Só na captura do app: quadros novos que o Windows entregou ao auxiliar, o tempo dele, o atraso até a página e os pulados nela. */
    novos: number | null;
    msAuxiliar: number | null;
    msAtePagina: number | null;
    puladosNaPagina: number | null;
    deixadosNoApp: number | null;
  };
  envio: {
    fpsCodificados: number | null;
    mbps: number | null; // por espectador
    alvoMbps: number | null;
    msCodificacao: number | null;
    msCodificacaoMax: number | null;
    qp: number | null;
    alturaMaisComum: number | null;
    mudancasDeResolucao: number;
    limites: Record<string, number>; // % do tempo em cada qualityLimitationReason
    quadrosChavePorMin: number | null;
    plisPorMin: number | null;
    msFilaDeEnvio: number | null;
    rttMs: number | null;
    bandaMbps: number | null;
    codificador: string | null;
    codificadorDaPlaca: boolean | null;
    rede: string | null;
  };
  recepcao: {
    fpsRecebidos: number | null;
    fpsDecodificados: number | null;
    fpsExibidos: number | null;
    fluidez: number | null; // % dos quadros exibidos no tempo
    p99Ms: number | null;
    piorMs: number | null;
    engasgos: number; // intervalos acima de 2x o esperado
    congelamentos: number;
    msCongelado: number;
    descartados: number;
    perdaPct: number | null;
    jitterMs: number | null;
    msBuffer: number | null;
    msBufferSom: number | null; // null: transmissão sem som (ou versão antiga, que não mede)
    folgaMs: number | null; // a folga pedida (jitterBufferTarget), média
    msDecodificacao: number | null;
    intervaloDesvioMs: number | null;
    msRecebidoAteTela: number | null;
    msCapturaAteTela: number | null;
    segundosSemTela: number; // sem medir o ritmo: janela escondida/minimizada
    decodificador: string | null;
    porEspectador: { nome: string; fpsExibidos: number | null; fluidez: number | null; congelamentos: number; perdaPct: number | null; rttMs: number | null }[];
  };
  atraso: { codificacao: number; fila: number; rede: number; buffer: number; decodificacao: number; total: number; medido: number | null };
  pc: {
    cpuApp: number | null;
    cpuAppMax: number | null;
    cpuPc: number | null;
    placa3dTotal: number | null;
    placa3dTotalMax: number | null;
    placaVideoTotal: number | null;
    placaVideoTotalMax: number | null;
    placaVideoApp: number | null; // só os processos do Ozamigos: a diferença para o total é de outros programas
    placa3dOutros: number | null;
    memoriaPlacaMB: number | null;
  };
  pagina: { tarefasLongas: number; msTarefaMaior: number; segundosComTarefaLonga: number; engasgosJuntoComTarefaLonga: number; segundosComEngasgo: number };
  resultado: Resultado;
};

export type Diagnostico = {
  gravidade: 'alta' | 'media' | 'baixa' | 'ok';
  codigo: string;
  titulo: string;
  detalhe: string;
  evidencias: string[];
  paraVoce?: string;
  paraOApp?: string;
  /** Onde mexer no código do Ozamigos, para quem for corrigir. */
  ondeNoCodigo?: string[];
};

export type Analise = {
  trechos: ResumoDoTrecho[];
  diagnosticos: Diagnostico[];
  recomendacao: { titulo: string; texto: string };
  principal: { fluidez: number | null; p99Ms: number | null; atraso: number | null; gargalo: string };
};

// ===== Contas =====

const valores = (lista: (number | null | undefined)[]) => lista.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
const media = (lista: (number | null | undefined)[], casas = 1) => {
  const v = valores(lista);
  return v.length ? arred(v.reduce((a, b) => a + b, 0) / v.length, casas) : null;
};
const maximo = (lista: (number | null | undefined)[]) => {
  const v = valores(lista);
  return v.length ? Math.max(...v) : null;
};
const mediana = (lista: (number | null | undefined)[]) => {
  const v = valores(lista).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const soma = (lista: (number | null | undefined)[]) => valores(lista).reduce((a, b) => a + b, 0);
const arred = (v: number, casas = 1) => Math.round(v * 10 ** casas) / 10 ** casas;
const maisComum = <T,>(lista: T[]): T | null => {
  const contagem = new Map<T, number>();
  for (const v of lista) if (v != null) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  let melhor: T | null = null;
  let vezes = 0;
  for (const [v, n] of contagem) if (n > vezes) [melhor, vezes] = [v, n];
  return melhor;
};
const fmt = (v: number | null | undefined, unidade = '', casas = 1) => (v == null ? '?' : `${arred(v, casas).toString().replace('.', ',')}${unidade}`);

/** Soma as faixas de intervalos de várias amostras. */
export function juntarFaixas(amostras: AmostraRecepcao[]): number[] {
  const total = FAIXAS.map(() => 0);
  for (const a of amostras) a.ritmo?.faixas.forEach((n, i) => (total[i] += n));
  return total;
}

/**
 * % dos quadros exibidos "no tempo": intervalo até 1,5x o esperado para o fps do conteúdo.
 * Com a captura a 60 fps, até 25 ms; a 30 fps, até 50 ms. Conta pelas faixas (FAIXAS).
 */
export function fluidez(faixas: number[], conteudoFps: number): number | null {
  const total = faixas.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const limite = (1000 / conteudoFps) * 1.5;
  const noTempo = faixas.reduce((acc, n, i) => acc + (FAIXAS[i] <= limite + 0.5 ? n : 0), 0);
  return arred((noTempo / total) * 100);
}

/** Intervalos acima de 2x o esperado: o engasgo que se sente. */
export function engasgos(faixas: number[], conteudoFps: number): number {
  const limite = (1000 / conteudoFps) * 2;
  return faixas.reduce((acc, n, i) => acc + ((i === 0 ? 0 : FAIXAS[i - 1]) >= limite - 0.5 ? n : 0), 0);
}

/** O percentil p pelas faixas, interpolando dentro da faixa. */
export function percentilDasFaixas(faixas: number[], p: number): number | null {
  const total = faixas.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let acumulado = 0;
  for (let i = 0; i < faixas.length; i++) {
    if (acumulado + faixas[i] >= p * total) {
      const baixo = i === 0 ? 0 : FAIXAS[i - 1];
      const alto = Number.isFinite(FAIXAS[i]) ? FAIXAS[i] : baixo * 2;
      const dentro = faixas[i] ? (p * total - acumulado) / faixas[i] : 0;
      return arred(baixo + (alto - baixo) * dentro);
    }
    acumulado += faixas[i];
  }
  return null;
}

// ===== Trechos =====

export function resumirTrecho(g: Gravacao, trecho: Trecho): ResumoDoTrecho {
  const dentro = <T extends { t: number }>(lista: T[]) => lista.filter((a) => a.t > trecho.descartarAte && a.t <= trecho.fim);
  const envio = dentro(g.envio);
  const recepcao = dentro(g.recepcao);
  const captura = dentro(g.captura);
  const pcs = dentro(g.pcAmostras);
  const pagina = dentro(g.pagina);
  const alvoFps = QUALIDADES[trecho.qualidade].fps;
  const capturaFps = mediana(captura.map((c) => c.fps));
  const conteudoFps = Math.max(1, Math.min(alvoFps, capturaFps ?? alvoFps));
  const segundos = new Set([...envio, ...recepcao].map((a) => a.t)).size;

  const limites: Record<string, number> = {};
  for (const e of envio) if (e.limite) limites[e.limite] = (limites[e.limite] ?? 0) + 1;
  for (const k of Object.keys(limites)) limites[k] = arred((limites[k] / Math.max(1, envio.length)) * 100);
  let mudancas = 0;
  const ultimaAltura = new Map<string, number | null>();
  for (const e of envio) {
    const antes = ultimaAltura.get(e.espectador);
    if (antes && e.altura && antes !== e.altura) mudancas++;
    ultimaAltura.set(e.espectador, e.altura);
  }
  const minutosDeEnvio = envio.length / 60 || 1;

  const faixas = juntarFaixas(recepcao);
  const comRitmo = recepcao.filter((r) => r.ritmo);
  const nomes = [...new Set(recepcao.map((r) => r.espectador))];
  const porEspectador = nomes.map((nome) => {
    const dele = recepcao.filter((r) => r.espectador === nome);
    return {
      nome,
      fpsExibidos: media(dele.map((r) => r.fpsExibidos)),
      fluidez: fluidez(juntarFaixas(dele), conteudoFps),
      congelamentos: soma(dele.map((r) => r.congelamentos)),
      perdaPct: media(dele.map((r) => r.perdaPct), 2),
      rttMs: media(dele.map((r) => r.rttMs), 0),
    };
  });

  // Mediana: quadros-chave e a entrada de espectadores novos dão picos de 100+ ms que distorcem a média.
  const msCodificacao = mediana(envio.map((e) => e.msCodificacao));
  const msFila = media(envio.map((e) => e.msFilaDeEnvio));
  const rtt = media([...envio.map((e) => e.rttMs), ...recepcao.map((r) => r.rttMs)], 0);
  const msBuffer = media(recepcao.map((r) => r.msBuffer));
  const msDecodificacao = media(recepcao.map((r) => r.msDecodificacao));
  const atraso = {
    codificacao: msCodificacao ?? 0,
    fila: msFila ?? 0,
    rede: rtt != null ? arred(rtt / 2) : 0,
    buffer: msBuffer ?? 0,
    decodificacao: msDecodificacao ?? 0,
    total: 0,
    medido: media(comRitmo.map((r) => r.ritmo!.msCapturaAteTela), 0),
  };
  atraso.total = arred(atraso.codificacao + atraso.fila + atraso.rede + atraso.buffer + atraso.decodificacao, 0);

  // Engasgo junto com travada da interface: o mesmo segundo (ou o vizinho) tem tarefa longa na página.
  const segundosComEngasgo = new Set(
    recepcao.filter((r) => r.ritmo && r.ritmo.maxMs > (1000 / conteudoFps) * 2).map((r) => r.t),
  );
  const segundosComTarefa = new Set(pagina.filter((p) => p.tarefasLongas > 0).map((p) => p.t));
  let juntos = 0;
  for (const t of segundosComEngasgo) if (segundosComTarefa.has(t) || segundosComTarefa.has(t - 1)) juntos++;

  const resumo: ResumoDoTrecho = {
    trecho,
    segundos,
    alvoFps,
    conteudoFps: arred(conteudoFps),
    captura: {
      fps: media(captura.map((c) => c.fps)),
      altura: maisComum(captura.map((c) => c.altura)),
      origem: maisComum(captura.map((c) => c.origem ?? null)),
      novos: media(captura.map((c) => c.app?.novos ?? null)),
      msAuxiliar: media(captura.map((c) => c.app?.msAuxiliar ?? null), 2),
      msAtePagina: media(captura.map((c) => c.app?.msAtePagina ?? null)),
      puladosNaPagina: media(captura.map((c) => c.app?.puladosNaPagina ?? null)),
      deixadosNoApp: media(captura.map((c) => c.app?.deixadosNoApp ?? null)),
    },
    envio: {
      fpsCodificados: media(envio.map((e) => e.fpsCodificados)),
      mbps: media(envio.map((e) => e.mbps), 2),
      alvoMbps: media(envio.map((e) => e.alvoMbps), 2),
      msCodificacao,
      msCodificacaoMax: maximo(envio.map((e) => e.msCodificacao)),
      qp: media(envio.map((e) => e.qp)),
      alturaMaisComum: maisComum(envio.map((e) => e.altura)),
      mudancasDeResolucao: mudancas,
      limites,
      quadrosChavePorMin: envio.length ? arred(soma(envio.map((e) => e.quadrosChave)) / minutosDeEnvio) : null,
      plisPorMin: envio.length ? arred(soma(envio.map((e) => e.plis)) / minutosDeEnvio) : null,
      msFilaDeEnvio: msFila,
      rttMs: media(envio.map((e) => e.rttMs), 0),
      bandaMbps: media(envio.map((e) => e.bandaMbps), 2),
      codificador: maisComum(envio.map((e) => e.codificador)),
      codificadorDaPlaca: maisComum(envio.map((e) => e.codificadorDaPlaca)),
      rede: maisComum(envio.map((e) => e.rede)),
    },
    recepcao: {
      fpsRecebidos: media(recepcao.map((r) => r.fpsRecebidos)),
      fpsDecodificados: media(recepcao.map((r) => r.fpsDecodificados)),
      fpsExibidos: media(recepcao.map((r) => r.fpsExibidos)),
      fluidez: fluidez(faixas, conteudoFps),
      p99Ms: percentilDasFaixas(faixas, 0.99),
      piorMs: maximo(comRitmo.map((r) => r.ritmo!.maxMs)),
      engasgos: engasgos(faixas, conteudoFps),
      congelamentos: soma(recepcao.map((r) => r.congelamentos)),
      msCongelado: soma(recepcao.map((r) => r.msCongelado)),
      descartados: soma(recepcao.map((r) => r.descartados)),
      perdaPct: media(recepcao.map((r) => r.perdaPct), 2),
      jitterMs: media(recepcao.map((r) => r.jitterMs)),
      msBuffer,
      msBufferSom: media(recepcao.map((r) => r.msBufferSom ?? null)),
      folgaMs: media(recepcao.map((r) => r.folgaMs ?? null), 0),
      msDecodificacao,
      intervaloDesvioMs: media(recepcao.map((r) => r.intervaloDesvioMs)),
      msRecebidoAteTela: media(comRitmo.map((r) => r.ritmo!.msRecebidoAteTela), 0),
      msCapturaAteTela: atraso.medido,
      segundosSemTela: new Set(recepcao.filter((r) => !r.ritmo).map((r) => r.t)).size,
      decodificador: maisComum(recepcao.map((r) => r.decodificador)),
      porEspectador,
    },
    atraso,
    pc: {
      cpuApp: media(pcs.map((p) => p.cpuApp)),
      cpuAppMax: maximo(pcs.map((p) => p.cpuApp)),
      cpuPc: media(pcs.map((p) => p.cpuPc)),
      placa3dTotal: media(pcs.map((p) => p.placa3dTotal)),
      placa3dTotalMax: maximo(pcs.map((p) => p.placa3dTotal)),
      placaVideoTotal: media(pcs.map((p) => p.placaVideoTotal)),
      placaVideoTotalMax: maximo(pcs.map((p) => p.placaVideoTotal)),
      placaVideoApp: media(pcs.map((p) => p.placaVideoApp)),
      placa3dOutros: media(pcs.map((p) => p.placa3dOutros)),
      memoriaPlacaMB: media(pcs.map((p) => p.memoriaPlacaMB), 0),
    },
    pagina: {
      tarefasLongas: soma(pagina.map((p) => p.tarefasLongas)),
      msTarefaMaior: maximo(pagina.map((p) => p.msTarefaMaior)) ?? 0,
      segundosComTarefaLonga: segundosComTarefa.size,
      engasgosJuntoComTarefaLonga: juntos,
      segundosComEngasgo: segundosComEngasgo.size,
    },
    resultado: 'bom',
  };
  resumo.resultado = classificar(resumo);
  return resumo;
}

/** Ótimo / bom / atenção / ruim. Os limites estão aqui e no glossário do relatório para IA. */
export function classificar(r: ResumoDoTrecho): Resultado {
  const fps = r.recepcao.fpsExibidos ?? r.recepcao.fpsDecodificados ?? r.envio.fpsCodificados;
  const proporcao = fps != null ? fps / r.conteudoFps : 1;
  const fl = r.recepcao.fluidez;
  const limitado = Object.entries(r.envio.limites).some(([motivo, pct]) => motivo !== 'none' && pct > 20);
  if ((fl != null && fl < 90) || proporcao < 0.8 || r.recepcao.congelamentos > 2) return 'ruim';
  if ((fl != null && fl < 97) || proporcao < 0.93 || limitado || r.recepcao.congelamentos > 0) return 'atencao';
  if ((fl != null && fl < 99) || proporcao < 0.97) return 'bom';
  return 'otimo';
}

// ===== Diagnósticos =====

/** Seguidas, tantas leituras sem quadro codificado, com a captura entregando, já são a placa que não codifica. */
const LEITURAS_SEM_QUADROS = 3;
const CODECS_DA_PLACA = ['H264', 'H265'];

export type SemQuadros = { espectador: string; codec: string; codificador: string | null; inicio: number; fim: number; depois: string | null };

/**
 * Os pedaços em que o codificador da placa não soltou nenhum quadro com a captura entregando (um driver quebrado; o
 * VigiaDoCodificador troca de codec em ~5 s). Lê todas as amostras, também as dos segundos descartados dos trechos:
 * a troca acontece justamente no começo. depois: o codec e o codificador que vieram em seguida, já soltando quadros.
 */
export function placaSemQuadros(g: Gravacao): SemQuadros[] {
  const capturaEm = new Map(g.captura.map((c) => [c.t, c.fps]));
  const achados: SemQuadros[] = [];
  for (const espectador of new Set(g.envio.map((e) => e.espectador))) {
    const dele = g.envio.filter((e) => e.espectador === espectador).sort((a, b) => a.t - b.t);
    let aberto: SemQuadros | null = null;
    let leituras = 0;
    for (const e of dele) {
      const semQuadros = e.fpsCodificados === 0 && CODECS_DA_PLACA.includes(e.codec ?? '');
      if (semQuadros && (aberto === null || aberto.codec === e.codec)) {
        if (!((capturaEm.get(e.t) ?? 0) > 0)) continue; // sem saber da captura (ou ela parada), a leitura não conta
        aberto ??= { espectador, codec: e.codec!, codificador: e.codificador, inicio: e.t, fim: e.t, depois: null };
        aberto.fim = e.t;
        leituras++;
        continue;
      }
      if (aberto && leituras >= LEITURAS_SEM_QUADROS) {
        if (e.fpsCodificados > 0) aberto.depois = `${e.codec ?? '?'} (${e.codificador ?? '?'})`;
        achados.push(aberto);
      }
      aberto = null;
      leituras = 0;
      if (semQuadros) {
        // outro codec da placa, também sem quadros (o H.265 que passou para o H.264): começa um pedaço novo
        if ((capturaEm.get(e.t) ?? 0) > 0) {
          aberto = { espectador, codec: e.codec!, codificador: e.codificador, inicio: e.t, fim: e.t, depois: null };
          leituras = 1;
        }
      }
    }
    if (aberto && leituras >= LEITURAS_SEM_QUADROS) achados.push(aberto);
  }
  return achados;
}

const CODIGO = {
  qualidades: 'web/src/qualidade.ts (QUALIDADES: bitrate, fps, altura e degradationPreference de cada opção)',
  captura: 'desktop/captura (o auxiliar da captura do app: Wgc.cs, Conversor.cs, Programa.cs), web/src/videoDoApp.ts, web/src/conexao/captura.ts (tamanhoDaCaptura, FPS_MINIMO_DA_CAPTURA), web/src/cliente.ts (capturar, usarTela) e desktop/main.js (ligarCapturaDeVideo, desktopCapturer, setDisplayMediaRequestHandler)',
  codificador: 'web/src/conexao/captura.ts (montarEnvio, codificacao), web/src/conexao/webrtc.ts (preferirCodecs), web/src/cliente.ts (aplicarQualidade) e desktop/main.js (force-fieldtrials WebRTC-FrameDropper/Disabled)',
  buffer: 'web/src/folga.ts (FolgaAdaptativa: o jitterBufferTarget de quem assiste) e web/src/cliente.ts (ajustarFolga)',
  rede: 'web/src/conexao/webrtc.ts (SERVIDORES_ICE e a retransmissão TURN, que só entra quando o caminho direto falha) e web/src/cliente.ts (refazerVideo)',
  interface: 'web/src/conexao/medidor.ts e web/src/cliente.ts (medir(): getStats de todas as conexões a cada 1 s e mudar() que re-renderiza o React) e web/src/componentes/',
  malha: 'web/src/cliente.ts (enviarOferta: uma RTCPeerConnection e uma codificação por espectador)',
  escolhaDoCodec: 'web/src/conexao/webrtc.ts (preferirCodecs, VigiaDoCodificador, CODEC_SEGUINTE, lerCodificador) e web/src/cliente.ts (vigiarCodificador)',
};

export function diagnosticar(g: Gravacao, trechos: ResumoDoTrecho[]): Diagnostico[] {
  const lista: Diagnostico[] = [];
  const validos = trechos.filter((t) => t.segundos > 0 && !t.trecho.aquecimento);
  if (!validos.length) {
    return [
      {
        gravidade: 'media',
        codigo: 'sem-dados',
        titulo: 'O teste foi curto demais para tirar conclusões',
        detalhe: `Cada trecho descarta os primeiros segundos (o WebRTC ainda está subindo a banda) e não sobrou nenhum segundo medido.`,
        evidencias: [`Duração: ${g.duracao} s; trechos: ${trechos.length}`],
        paraVoce: 'Rode o teste até o fim, ou grave a sala com alguém assistindo por pelo menos 1 minuto.',
      },
    ];
  }

  // Captura
  const capturaBaixa = validos.filter((t) => t.captura.fps != null && t.captura.fps < t.alvoFps * 0.85);
  if (capturaBaixa.length) {
    const pior = capturaBaixa.reduce((a, b) => ((a.captura.fps ?? 99) < (b.captura.fps ?? 99) ? a : b));
    if (pior.captura.origem === 'app') {
      // A captura do app (1.2.18): ela só manda quadro quando a imagem muda, e o auxiliar mede em que ponto ficou.
      const { novos, msAuxiliar, msAtePagina, puladosNaPagina } = pior.captura;
      const auxiliarLento = msAuxiliar != null && msAuxiliar > 1000 / pior.alvoFps / 2;
      const paginaPulou = (puladosNaPagina ?? 0) + (pior.captura.deixadosNoApp ?? 0) >= 1;
      lista.push({
        gravidade: 'alta',
        codigo: 'captura-lenta',
        titulo: `A captura do app entrega só ${fmt(pior.captura.fps, ' fps', 0)} (a qualidade pede ${pior.alvoFps})`,
        detalhe:
          'A captura do app pega do Windows só os quadros com imagem nova (com a imagem parada, repete o último a cada 100 ms). ' +
          (auxiliarLento
            ? `O auxiliar levou ${fmt(msAuxiliar, ' ms', 1)} por quadro (reduzir, converter e ler da placa), mais da metade do intervalo de um quadro: ele é o gargalo. `
            : paginaPulou
              ? `A página não deu conta de ${fmt((puladosNaPagina ?? 0) + (pior.captura.deixadosNoApp ?? 0), '', 1)} quadros por segundo (pulados por ela ou deixados de fora pelo app com ela atrasada): o gargalo é a página de quem transmite (veja as tarefas longas). `
              : `O Windows entregou ${fmt(novos, '', 1)} quadros novos por segundo ao auxiliar, que levou ${fmt(msAuxiliar, ' ms', 1)} por quadro: o limite veio antes dele, do jogo (apresentou menos quadros) ou da montagem da tela com a placa cheia. `) +
          `Da captura até a página, ${fmt(msAtePagina, ' ms', 1)} em média.`,
        evidencias: capturaBaixa.map(
          (t) =>
            `${t.trecho.nome} (${t.trecho.espectadores} esp.): captura ${fmt(t.captura.fps, ' fps')} de ${t.alvoFps}, novos ${fmt(t.captura.novos, '/s')}, auxiliar ${fmt(t.captura.msAuxiliar, ' ms', 1)}, até a página ${fmt(t.captura.msAtePagina, ' ms')}, pulados ${fmt(t.captura.puladosNaPagina, '/s', 1)}, deixados ${fmt(t.captura.deixadosNoApp, '/s', 1)}, placa 3D ${fmt(t.pc.placa3dTotal, '%')} (máx. ${fmt(t.pc.placa3dTotalMax, '%')})`,
        ),
        paraVoce:
          'Se o jogo roda abaixo do fps pedido, a captura acompanha o jogo. Com a placa cheia, limite o fps do jogo (ou ligue o VSync) e prefira transmitir a janela do jogo em vez da tela inteira.',
        paraOApp: auxiliarLento
          ? 'Tirar a leitura da placa do caminho (ler o NV12 de forma assíncrona, com duas texturas de leitura em rodízio) em desktop/captura/Conversor.cs.'
          : paginaPulou
            ? 'Tirar trabalho da thread principal da página de quem transmite enquanto transmite.'
            : 'Comparar com a captura antiga (Ctrl+Shift+N) no mesmo jogo, e a janela contra a tela inteira: se as duas ficam iguais, o limite é o jogo ou a placa.',
        ondeNoCodigo: [CODIGO.captura],
      });
    } else lista.push({
      gravidade: 'alta',
      codigo: 'captura-lenta',
      titulo: `A captura do jogo entrega só ${fmt(pior.captura.fps, ' fps', 0)} (a qualidade pede ${pior.alvoFps})`,
      detalhe:
        'A captura sai mais devagar do que a qualidade pede, antes de qualquer codificação ou rede, e tudo depois herda esse limite. ' +
        'Causa mais comum (medida com o Path of Exile): o jogo sem limite de fps enche a placa de vídeo, a cópia de cada quadro capturado ' +
        'espera na fila dela, e o Chromium espaça as capturas para a cópia não passar de 50% do tempo (com ~24 ms por cópia, ~21 fps). ' +
        'O uso total da placa não mostra isso: a captura fica baixa com a placa a 30% ou a 95%.',
      evidencias: capturaBaixa.map(
        (t) =>
          `${t.trecho.nome} (${t.trecho.espectadores} esp.): captura ${fmt(t.captura.fps, ' fps')} de ${t.alvoFps}, placa 3D ${fmt(t.pc.placa3dTotal, '%')} (máx. ${fmt(t.pc.placa3dTotalMax, '%')})`,
      ),
      paraVoce: 'Limite o fps do jogo a 60 (ou ligue o VSync). Num teste com o Path of Exile, a captura foi de 21 para 29 fps só com isso.',
      paraOApp:
        'Tirar a cópia do caminho. A captura em textura do Chromium (WebRtcAllowWgcUsingTexture + ZeroCopyDesktopCapture) resolve na bancada, mas derrubou a página ao codificar no Electron 44.7.2. A saída é a captura do app (1.2.18, a padrão no app; Ctrl+Shift+N alterna): esta transmissão estava na captura do navegador.',
      ondeNoCodigo: [CODIGO.captura],
    });
  } else {
    lista.push({
      gravidade: 'ok',
      codigo: 'captura-ok',
      titulo: 'A captura do jogo acompanhou a qualidade',
      detalhe: 'O Windows entregou os quadros no ritmo pedido em todos os trechos.',
      evidencias: validos.map((t) => `${t.trecho.nome} (${t.trecho.espectadores} esp.): ${fmt(t.captura.fps, ' fps')} de ${t.alvoFps}`),
    });
  }

  // Codificador
  const semQuadros = placaSemQuadros(g);
  if (semQuadros.length) {
    const voltou = semQuadros.every((s) => s.depois !== null);
    lista.push({
      gravidade: voltou ? 'media' : 'alta',
      codigo: 'placa-sem-quadros',
      titulo: voltou
        ? 'O codificador da placa de vídeo não soltou nenhum quadro, e a transmissão passou para outro codec'
        : 'O codificador da placa de vídeo não soltou nenhum quadro: quem assistia via a tela preta',
      detalhe:
        `A captura entregava a imagem, a conexão estava de pé e o codificador da placa ficou em 0 quadros por ${LEITURAS_SEM_QUADROS} leituras seguidas ou mais. ` +
        'Não é falta de força (o motor de vídeo da placa costuma ficar em 0%): o codificador abre e não devolve nada, e o Chromium não troca sozinho porque ele não dá erro. ' +
        'Visto em 31/10/2026 numa RX 7900 XT no Windows 26300, com o mesmo driver de uma RX 7800 XT que funcionava, e com a gravação do Adrenalin (que não passa pelo Media Foundation) funcionando. ' +
        'O Ozamigos refaz a conexão no codec seguinte (H.265 → H.264 → VP8 no processador) depois de 5 s conectada sem quadros.',
      evidencias: semQuadros.map(
        (s) => `${s.espectador}: ${s.codec} (${s.codificador ?? '?'}) sem quadros de ${s.inicio} s a ${s.fim} s; depois: ${s.depois ?? 'nada (continuou sem quadros)'}`,
      ),
      paraVoce: voltou
        ? 'A transmissão funciona pelo processador, com menos nitidez. Para voltar à placa: feche programas que gravam a tela (o Instant Replay do Adrenalin, por exemplo) e reinstale o driver da placa do zero.'
        : 'Feche programas que gravam a tela (o Instant Replay do Adrenalin, por exemplo) e reinstale o driver da placa do zero.',
      paraOApp: voltou
        ? 'Nada a fazer na escolha: o VigiaDoCodificador já trocou. Conferir se o tempo até a troca ficou perto de 5 s.'
        : 'Conferir por que o VigiaDoCodificador não trocou de codec (a conexão conectou? a captura andava?).',
      ondeNoCodigo: [CODIGO.escolhaDoCodec],
    });
  }
  // O processador codificando porque a placa falhou já está dito acima, com a causa.
  const porFalhaDaPlaca = semQuadros.some((s) => s.depois !== null);
  const software = porFalhaDaPlaca
    ? undefined
    : validos.find((t) => t.envio.codificadorDaPlaca === false || /openh264|libvpx|libaom/i.test(t.envio.codificador ?? ''));
  if (software) {
    lista.push({
      gravidade: 'alta',
      codigo: 'codificador-software',
      titulo: 'O vídeo está sendo codificado pelo processador, não pela placa de vídeo',
      detalhe: `O codificador em uso é "${software.envio.codificador}". Codificar por software pesa muito no processador e limita fps e resolução.`,
      evidencias: [`encoderImplementation=${software.envio.codificador}; powerEfficientEncoder=${software.envio.codificadorDaPlaca}`],
      paraVoce: 'Atualize o driver da placa de vídeo.',
      paraOApp: 'Conferir se o H.265 ou o H.264 de hardware foi negociado (preferirCodecs) e se o Chromium tem o codificador da placa liberado.',
      ondeNoCodigo: [CODIGO.codificador],
    });
  }
  // Um codificador parado não está saturado (é o placa-sem-quadros), nem o que acabou de nascer depois da troca de codec.
  const fimDaFalha = Math.max(-Infinity, ...semQuadros.map((s) => s.fim));
  const saturados = validos.filter((t) => {
    if (semQuadros.length && (t.envio.fpsCodificados === 0 || t.trecho.descartarAte < fimDaFalha + SEGUNDOS_DESCARTADOS)) return false;
    const orcamento = 1000 / t.conteudoFps;
    const cpuLimitado = (t.envio.limites.cpu ?? 0) > 20;
    return cpuLimitado || (t.envio.msCodificacao ?? 0) > orcamento * 0.8 || (t.envio.fpsCodificados ?? t.conteudoFps) < t.conteudoFps * 0.9;
  });
  if (saturados.length) {
    const pior = saturados.reduce((a, b) => ((a.envio.msCodificacao ?? 0) > (b.envio.msCodificacao ?? 0) ? a : b));
    lista.push({
      gravidade: 'alta',
      codigo: 'codificador-saturado',
      titulo: `O codificador não deu conta em ${saturados.length === 1 ? '1 trecho' : `${saturados.length} trechos`}`,
      detalhe:
        'Cada pessoa assistindo é uma codificação separada da mesma imagem (malha P2P). Quando o tempo por quadro chega perto do intervalo entre quadros, o WebRTC passa a baixar fps ou resolução (qualityLimitationReason = cpu).',
      evidencias: saturados.map(
        (t) =>
          `${t.trecho.nome} (${t.trecho.espectadores} esp.): ${fmt(t.envio.msCodificacao, ' ms')}/quadro (orçamento ${fmt(1000 / t.conteudoFps, ' ms')}), ${fmt(t.envio.fpsCodificados, ' fps')} codificados de ${t.conteudoFps}, limite cpu ${fmt(t.envio.limites.cpu ?? 0, '%')} do tempo, motor de vídeo da placa ${fmt(t.pc.placaVideoTotal, '%')}`,
      ),
      paraVoce: `Com ${pior.trecho.espectadores} pessoas assistindo, use uma qualidade mais leve.`,
      paraOApp:
        'Opções: codificar uma vez só e repassar para todos (exige um servidor SFU, foge do P2P), simulcast/SVC, ou baixar a qualidade sozinho conforme o número de espectadores.',
      ondeNoCodigo: [CODIGO.malha, CODIGO.qualidades],
    });
  } else if (!semQuadros.some((s) => s.depois === null)) {
    lista.push({
      gravidade: 'ok',
      codigo: 'codificador-ok',
      titulo: 'O codificador deu conta em todos os trechos',
      detalhe: 'O tempo por quadro ficou abaixo do intervalo entre quadros, sem limite de processador.',
      evidencias: validos.map((t) => `${t.trecho.nome} (${t.trecho.espectadores} esp.): ${fmt(t.envio.msCodificacao, ' ms')}/quadro, ${t.envio.codificador ?? '?'}`),
    });
  }

  // Escala com o número de espectadores (mesma qualidade, quantidades diferentes)
  const porQualidade = new Map<Qualidade, ResumoDoTrecho[]>();
  for (const t of validos) porQualidade.set(t.trecho.qualidade, [...(porQualidade.get(t.trecho.qualidade) ?? []), t]);
  for (const [qualidade, lista2] of porQualidade) {
    const quantidades = [...new Set(lista2.map((t) => t.trecho.espectadores))];
    if (quantidades.length < 2) continue;
    const ordenados = [...lista2].sort((a, b) => a.trecho.espectadores - b.trecho.espectadores);
    const primeiro = ordenados[0];
    const ultimo = ordenados[ordenados.length - 1];
    const custo =
      primeiro.envio.msCodificacao != null && ultimo.envio.msCodificacao != null
        ? (ultimo.envio.msCodificacao - primeiro.envio.msCodificacao) / (ultimo.trecho.espectadores - primeiro.trecho.espectadores)
        : null;
    lista.push({
      gravidade: 'baixa',
      codigo: 'escala',
      titulo:
        custo != null && custo >= 0.2
          ? `Em ${QUALIDADES[qualidade].rotulo}, cada espectador a mais custa ${fmt(custo, ' ms', 2)} de codificação por quadro`
          : `Em ${QUALIDADES[qualidade].rotulo}, o tempo de codificação não subiu com mais espectadores`,
      detalhe: 'Comparação do mesmo jogo e da mesma qualidade com quantidades diferentes de pessoas assistindo.',
      evidencias: ordenados.map(
        (t) =>
          `${t.trecho.espectadores} esp.: ${fmt(t.envio.msCodificacao, ' ms')}/quadro, ${fmt(t.recepcao.fpsExibidos ?? t.recepcao.fpsDecodificados, ' fps')} na tela, fluidez ${fmt(t.recepcao.fluidez, '%')}, motor de vídeo ${fmt(t.pc.placaVideoTotal, '%')}, processador do app ${fmt(t.pc.cpuApp, '%')}`,
      ),
      ondeNoCodigo: [CODIGO.malha],
    });
  }

  // Banda (no modo simulado não existe internet no caminho: banda limitada é o próprio WebRTC)
  const banda = validos.filter((t) => (t.envio.limites.bandwidth ?? 0) > 20);
  if (banda.length) {
    lista.push({
      gravidade: g.modo === 'simulado' ? 'media' : 'alta',
      codigo: 'banda',
      titulo: g.modo === 'simulado' ? 'O controle de banda do WebRTC segurou a qualidade mesmo sem internet no caminho' : 'A internet de quem transmite limitou a qualidade',
      detalhe:
        g.modo === 'simulado'
          ? 'Os espectadores simulados estão no mesmo PC: limite por banda aqui vem da estimativa do WebRTC (subida lenta ou pacing), não da internet.'
          : 'O WebRTC estimou menos banda de upload do que a qualidade pede e baixou bitrate ou resolução.',
      evidencias: banda.map((t) => `${t.trecho.nome} (${t.trecho.espectadores} esp.): limite banda ${fmt(t.envio.limites.bandwidth, '%')} do tempo, banda estimada ${fmt(t.envio.bandaMbps, ' Mbps')}, alvo ${fmt(t.envio.alvoMbps, ' Mbps')}`),
      paraVoce: g.modo === 'simulado' ? undefined : 'Use cabo em vez de Wi-Fi, ou tenha menos gente assistindo; cada amigo usa o upload inteiro de novo.',
      paraOApp: 'Conferir a subida de banda das conexões novas (começa em ~300 kbps) e o bitrate de cada qualidade.',
      ondeNoCodigo: [CODIGO.qualidades],
    });
  }

  // Rede (amigos)
  const perda = validos.filter((t) => (t.recepcao.perdaPct ?? 0) > 1 || (t.envio.plisPorMin ?? 0) > 6);
  if (perda.length) {
    const local = g.modo === 'simulado';
    lista.push({
      gravidade: 'alta',
      codigo: 'perda-de-pacotes',
      titulo: local ? 'Pacotes se perderam mesmo sem internet: o PC ficou sobrecarregado' : 'Pacotes perdidos no caminho fizeram a imagem travar',
      detalhe: local
        ? 'No modo simulado tudo fica no mesmo PC: perda aqui quer dizer que o processo não deu conta de ler os pacotes a tempo (filas locais transbordaram). Cada perda faz quem assiste pedir um quadro-chave (PLI).'
        : 'Cada perda que não dá para recuperar faz quem assiste pedir um quadro-chave (PLI), que é grande e atrasa a imagem.',
      evidencias: perda.map((t) => `${t.trecho.nome}: perda ${fmt(t.recepcao.perdaPct, '%', 2)}, ${fmt(t.envio.plisPorMin, ' PLI/min')}, rtt ${fmt(t.envio.rttMs, ' ms', 0)}`),
      paraVoce: local ? undefined : 'Quem perde pacotes deve usar cabo ou chegar mais perto do roteador.',
      paraOApp: local ? 'Ver o que ocupa o processo nesses segundos (codificação, getStats, interface).' : 'Avaliar FEC (ulpfec/flexfec), RED e a folga do jitter buffer.',
      ondeNoCodigo: [CODIGO.buffer],
    });
  }
  const longe = validos.filter((t) => (t.envio.rttMs ?? 0) > 120 || t.envio.rede === 'relay');
  if (longe.length) {
    lista.push({
      gravidade: 'media',
      codigo: 'rede-lenta',
      titulo: g.modo === 'simulado' ? 'A ida e volta subiu mesmo sem internet: o PC demorou a responder' : 'A ida e volta entre os PCs ficou alta',
      detalhe:
        g.modo === 'simulado'
          ? 'Entre conexões no mesmo PC a ida e volta fica perto de 0 ms; acima de 120 ms, o processo estava ocupado demais para responder.'
          : 'Atraso alto não trava a imagem por si, mas faz a reação demorar e deixa o controle de banda mais lento. Vem da internet ou de um dos PCs ocupado demais para responder: compare com o rtt dos outros trechos e com o uso do PC no mesmo período.',
      evidencias: longe.map((t) => `${t.trecho.nome}: rtt ${fmt(t.envio.rttMs, ' ms', 0)}, caminho ${t.envio.rede ?? '?'}`),
      ondeNoCodigo: [CODIGO.rede],
    });
  }

  // Quem assiste: decodificação e exibição
  const decodLenta = validos.filter((t) => (t.recepcao.msDecodificacao ?? 0) > (1000 / t.conteudoFps) * 0.5);
  if (decodLenta.length) {
    lista.push({
      gravidade: 'media',
      codigo: 'decodificacao-lenta',
      titulo: 'A decodificação de quem assiste ficou lenta',
      detalhe: `Decodificador: ${decodLenta[0].recepcao.decodificador ?? '?'}. Acima de metade do intervalo entre quadros, sobra pouco para desenhar na tela.`,
      evidencias: decodLenta.map((t) => `${t.trecho.nome}: ${fmt(t.recepcao.msDecodificacao, ' ms')}/quadro`),
      paraOApp: g.modo === 'simulado' ? 'No modo simulado, os espectadores decodificam no mesmo PC do jogo: parte disso não acontece com amigos de verdade.' : undefined,
    });
  }
  const perdeNaTela = validos.filter(
    (t) => t.recepcao.fpsExibidos != null && t.recepcao.fpsDecodificados != null && t.recepcao.fpsExibidos < t.recepcao.fpsDecodificados * 0.93,
  );
  if (perdeNaTela.length) {
    lista.push({
      gravidade: 'media',
      codigo: 'perde-na-tela',
      titulo: 'Quadros decodificados que não chegaram à tela',
      detalhe: 'A imagem chega e é decodificada, mas a página não mostra todos os quadros: o navegador estava ocupado ou a tela tem outra frequência.',
      evidencias: perdeNaTela.map((t) => `${t.trecho.nome}: ${fmt(t.recepcao.fpsDecodificados, ' fps')} decodificados, ${fmt(t.recepcao.fpsExibidos, ' fps')} na tela`),
      ondeNoCodigo: [CODIGO.interface],
    });
  }

  // Engasgos e congelamentos
  const congelou = validos.filter((t) => t.recepcao.congelamentos > 0);
  if (congelou.length) {
    lista.push({
      gravidade: 'alta',
      codigo: 'congelamentos',
      titulo: `A imagem congelou ${soma(congelou.map((t) => t.recepcao.congelamentos))} ${soma(congelou.map((t) => t.recepcao.congelamentos)) === 1 ? 'vez' : 'vezes'}${congelou.length === 1 ? ` (${congelou[0].trecho.nome}, ${congelou[0].trecho.espectadores} ${congelou[0].trecho.espectadores === 1 ? 'espectador' : 'espectadores'})` : ''}`,
      detalhe: 'Congelamento (freezeCount do WebRTC): um intervalo entre quadros acima de 3x a média recente ou de 150 ms.',
      evidencias: congelou.map((t) => `${t.trecho.nome} (${t.trecho.espectadores} esp.): ${t.recepcao.congelamentos} congelamentos, ${t.recepcao.msCongelado} ms no total`),
    });
  }

  // Quem já assistia congela quando alguém novo começa a assistir (codificador novo, quadro-chave)
  const entradas = g.acontecimentos.filter((e) => (e.tipo === 'etapa' && /com [2-9]/.test(e.texto)) || (e.tipo === 'espectador' && /está assistindo/.test(e.texto)));
  const congelamentosNaEntrada = g.acontecimentos.filter(
    (c) => c.tipo === 'congelamento' && entradas.some((e) => c.t >= e.t - 6 && c.t <= e.t + 6),
  );
  if (congelamentosNaEntrada.length) {
    lista.push({
      gravidade: 'media',
      codigo: 'congela-ao-entrar',
      titulo: 'Quem já assistia congelou quando alguém começou a assistir',
      detalhe:
        'Cada pessoa nova abre uma conexão e um codificador novos, que começam com um quadro-chave. Nesse momento, a imagem de quem já estava assistindo travou. Estes segundos ficam fora das médias dos trechos.',
      evidencias: [
        ...entradas.map((e) => `${e.t} s: ${e.texto}`),
        ...congelamentosNaEntrada.map((c) => `${c.t} s: ${c.texto}`),
      ].slice(0, 12),
      paraOApp:
        'Investigar se criar o codificador de hardware (ou o quadro-chave inicial) segura a codificação das outras conexões; testar abrir as conexões novas uma de cada vez, com intervalo, e conferir o quadro-chave/PLI de quem já assistia.',
      ondeNoCodigo: [CODIGO.malha, CODIGO.codificador],
    });
  }

  // A interface de quem transmite causando engasgo
  const comTarefas = validos.filter((t) => t.pagina.engasgosJuntoComTarefaLonga > 0);
  const engasgosTotal = soma(validos.map((t) => t.pagina.segundosComEngasgo));
  const juntos = soma(validos.map((t) => t.pagina.engasgosJuntoComTarefaLonga));
  if (comTarefas.length && engasgosTotal) {
    lista.push({
      gravidade: juntos / engasgosTotal >= 0.4 ? 'media' : 'baixa',
      codigo: 'interface-trava',
      titulo: `${juntos} de ${engasgosTotal} segundos com engasgo coincidiram com uma travada da interface`,
      detalhe:
        g.modo === 'simulado'
          ? 'Os espectadores simulados vivem na mesma página que transmite: quando ela trava (tarefa acima de 50 ms), o quadro sai atrasado. Amigos de verdade não sofrem com as travadas desta página, mas a captura e o envio rodam no mesmo processo.'
          : 'Tarefas acima de 50 ms na página de quem transmite atrasam o envio dos quadros.',
      evidencias: comTarefas.map((t) => `${t.trecho.nome}: ${t.pagina.tarefasLongas} tarefas longas (maior ${t.pagina.msTarefaMaior} ms), ${t.pagina.engasgosJuntoComTarefaLonga} de ${t.pagina.segundosComEngasgo} s com engasgo coincidem`),
      paraOApp: 'Descobrir o que roda nessas tarefas (perfil do DevTools): getStats de muitas conexões, re-render do React a cada segundo, áudio do PC.',
      ondeNoCodigo: [CODIGO.interface],
    });
  }

  // Atraso
  const comAtraso = validos.filter((t) => t.atraso.total > 0);
  const recomendado = comAtraso.find((t) => t.trecho.qualidade === g.qualidadeDaPessoa) ?? comAtraso[0];
  // A folga adaptativa fica em 80–100 ms com a rede boa: só vale apontar quando ela ficou bem acima disso.
  if (recomendado && recomendado.atraso.buffer > 130 && recomendado.atraso.buffer > recomendado.atraso.total * 0.55) {
    const { buffer } = recomendado.atraso;
    // Acima do limite da folga, quem segura a imagem não é a folga: é o navegador (sincronismo com o som, ou a espera
    // que ele mesmo aumenta depois de um congelamento e demora a baixar).
    const alemDaFolga = buffer > FOLGA.maxima + 50;
    const { msBufferSom, folgaMs } = recomendado.recepcao;
    lista.push({
      gravidade: buffer > 500 ? 'alta' : alemDaFolga ? 'media' : 'baixa',
      codigo: 'atraso-no-buffer',
      titulo: alemDaFolga
        ? `A imagem espera ${fmt(buffer, ' ms', 0)} no PC de quem assiste, acima do limite da folga (${FOLGA.maxima} ms)`
        : `O buffer de quem assiste é ${Math.round((buffer / recomendado.atraso.total) * 100)}% do atraso`,
      detalhe: alemDaFolga
        ? 'Acima do limite da folga, quem segura a imagem é o navegador: o sincronismo com o som da transmissão (a imagem espera o som) ou a espera que ele mesmo aumenta depois de um congelamento e demora a baixar.'
        : 'Quem assiste segura quadros para absorver variações da rede (jitterBufferTarget). É uma escolha: menos buffer = menos atraso, mais risco de congelar em Wi-Fi instável.',
      evidencias: [
        `${recomendado.trecho.nome}: codificação ${fmt(recomendado.atraso.codificacao, ' ms')}, fila ${fmt(recomendado.atraso.fila, ' ms')}, rede ${fmt(recomendado.atraso.rede, ' ms')}, buffer ${fmt(buffer, ' ms')}, decodificação ${fmt(recomendado.atraso.decodificacao, ' ms')}`,
        `folga pedida em média: ${fmt(folgaMs, ' ms', 0)}; buffer do som: ${msBufferSom != null ? fmt(msBufferSom, ' ms') : 'sem som (ou versão que não mede)'}`,
        `jitterBufferTarget: ${g.ajustes.folgaDeRede ?? `${g.ajustes.folgaDeRedeMs ?? '?'} ms`}`,
      ],
      paraOApp: 'Rever os limites da folga adaptativa (FOLGA em folga.ts) e quanto ela sobe a cada congelamento.',
      ondeNoCodigo: [CODIGO.buffer],
    });
  }

  // Placa de vídeo ocupada pelo jogo
  const placaCheia = validos.filter((t) => (t.pc.placa3dTotalMax ?? 0) >= 95);
  if (placaCheia.length) {
    lista.push({
      gravidade: 'media',
      codigo: 'placa-cheia',
      titulo: 'A placa de vídeo chegou a 100% (o jogo usa quase tudo)',
      detalhe: 'Com a placa cheia, a captura e a codificação disputam espaço com o jogo e podem atrasar.',
      evidencias: placaCheia.map((t) => `${t.trecho.nome}: 3D até ${fmt(t.pc.placa3dTotalMax, '%')} (o jogo ${fmt(t.pc.placa3dOutros, '%')} em média)`),
      paraVoce: 'Limite o fps do jogo (60 costuma bastar) para sobrar placa para a transmissão.',
    });
  }

  // Outro programa codificando vídeo na mesma placa (gravação em segundo plano): disputa o codificador com o Ozamigos.
  const codificadorDisputado = validos.filter(
    (t) => t.pc.placaVideoTotal != null && t.pc.placaVideoApp != null && t.pc.placaVideoTotal - t.pc.placaVideoApp >= 30,
  );
  if (codificadorDisputado.length) {
    lista.push({
      gravidade: 'media',
      codigo: 'codificador-disputado',
      titulo: 'Outro programa usou o codificador de vídeo da placa junto com o Ozamigos',
      detalhe:
        'O motor de vídeo da placa estava ocupado bem além do que o Ozamigos usava. Quase sempre é uma gravação em segundo plano. Com mais amigos assistindo, os dois disputam o mesmo codificador.',
      evidencias: codificadorDisputado.map(
        (t) => `${t.trecho.nome}: motor de vídeo ${fmt(t.pc.placaVideoTotal, '%')} no total, ${fmt(t.pc.placaVideoApp, '%')} do Ozamigos`,
      ),
      paraVoce:
        'Desligue as gravações em segundo plano: Instant Replay/gravação da AMD (Adrenalin), Instant Replay da NVIDIA, gravação da Steam ou a da Barra de Jogo do Windows.',
    });
  }

  // Nitidez
  // A escala do QP é a do H.264 e do H.265 (0 a 51); a do VP8 e do AV1 vai até 127 e passaria do limite sempre.
  const borrado = validos.filter((t) => (t.envio.qp ?? 0) > 32 && !/libvpx|libaom/i.test(t.envio.codificador ?? ''));
  if (borrado.length) {
    lista.push({
      gravidade: 'baixa',
      codigo: 'imagem-borrada',
      titulo: 'A imagem saiu com pouca nitidez em alguns trechos',
      detalhe: 'QP médio alto: o codificador comprimiu demais para caber no bitrate.',
      evidencias: borrado.map((t) => `${t.trecho.nome}: QP ${fmt(t.envio.qp)}, ${fmt(t.envio.mbps, ' Mbps')} (alvo ${fmt(t.envio.alvoMbps, ' Mbps')})`),
      paraOApp: 'Avaliar bitrate maior nessa qualidade.',
      ondeNoCodigo: [CODIGO.qualidades],
    });
  }

  // Medição incompleta
  const semTela = soma(validos.map((t) => t.recepcao.segundosSemTela));
  if (semTela > 0) {
    lista.push({
      gravidade: 'baixa',
      codigo: 'sem-ritmo',
      titulo: g.modo === 'sala' ? 'Parte do tempo, quem assistia estava com o Ozamigos escondido' : 'Parte do teste não mediu o ritmo na tela',
      detalhe:
        g.modo === 'sala'
          ? 'Com a janela do Ozamigos escondida ou minimizada (por exemplo, jogando em tela cheia), o navegador não desenha o vídeo; nesses segundos valem só as medidas até a decodificação (fps decodificados e intervalo na saída do decodificador).'
          : 'Com a janela do Ozamigos escondida ou minimizada, o navegador não desenha o vídeo; nesses segundos valem só as medidas até a decodificação.',
      evidencias: [`${semTela} segundos-espectador sem medida na tela`],
      paraVoce: g.modo === 'sala' ? undefined : 'Deixe a janela do Ozamigos visível durante o teste (em outro monitor ou ao lado do jogo).',
    });
  }

  if (g.modo === 'simulado') {
    lista.push({
      gravidade: 'baixa',
      codigo: 'limites-do-simulado',
      titulo: 'O que o teste simulado não mede',
      detalhe:
        'Os espectadores simulados estão no mesmo PC: não há internet no caminho (sem perda, rtt ~0) e a decodificação deles pesa no PC de quem transmite, o que amigos de verdade não fazem. Para a internet, grave a sala com os amigos (Ctrl+Shift+G).',
      evidencias: [`${soma(validos.map((t) => t.trecho.simulados))} espectadores simulados no total dos trechos`],
    });
  }

  const ordem = { alta: 0, media: 1, baixa: 2, ok: 3 };
  return lista.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
}

// ===== Recomendação =====

const PREFERENCIA: Qualidade[] = ['leve'];
const contar = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const passou = (t: ResumoDoTrecho) => t.resultado === 'otimo' || t.resultado === 'bom';

export function recomendar(g: Gravacao, trechos: ResumoDoTrecho[], diagnosticos: Diagnostico[]): Analise['recomendacao'] {
  const validos = trechos.filter((t) => t.segundos > 0 && !t.trecho.aquecimento);
  if (!validos.length) return { titulo: 'Sem dados suficientes', texto: 'Rode o teste por mais tempo.' };
  const principal = diagnosticos.find((d) => d.gravidade === 'alta');
  if (g.modo === 'sala') {
    const piores = validos.filter((t) => !passou(t));
    if (!piores.length) {
      return {
        titulo: `A transmissão foi ${validos.every((t) => t.resultado === 'otimo') ? 'ótima' : 'boa'} para todos que assistiram`,
        texto: `Medido com ${contar(new Set(g.recepcao.map((r) => r.espectador)).size, 'amigo', 'amigos')} em ${contar(validos.length, 'trecho', 'trechos')}. ${principal ? `Atenção: ${principal.titulo}.` : 'Nenhum gargalo importante.'}`,
      };
    }
    return {
      titulo: principal ? principal.titulo : 'Houve trechos com engasgo',
      texto: `${piores.length} de ${validos.length} trechos ficaram abaixo do esperado. ${principal?.paraVoce ?? ''}`.trim(),
    };
  }
  // De cada qualidade, o trecho com menos gente assistindo (no roteiro completo, 1 espectador).
  const base = new Map<Qualidade, ResumoDoTrecho>();
  for (const t of validos) {
    const atual = base.get(t.trecho.qualidade);
    if (!atual || t.trecho.espectadores < atual.trecho.espectadores) base.set(t.trecho.qualidade, t);
  }
  // Com a captura abaixo do que a qualidade pede, a imagem sai fluida mas com menos fps: não conta como aprovada.
  const capturaOk = (t: ResumoDoTrecho) => t.captura.fps == null || t.captura.fps >= t.alvoFps * 0.85;
  const melhor = PREFERENCIA.find((q) => base.get(q) && passou(base.get(q)!) && capturaOk(base.get(q)!));
  const capturaLimita = [...base.values()].every((t) => !capturaOk(t));
  const sua = g.qualidadeDaPessoa;
  const escala = validos.filter((t) => t.trecho.qualidade === sua).sort((a, b) => a.trecho.espectadores - b.trecho.espectadores);
  const aguenta = escala.filter(passou).map((t) => t.trecho.espectadores);
  const maxOk = aguenta.length ? Math.max(...aguenta) : 0;
  const falhou = escala.find((t) => !passou(t) && t.trecho.espectadores > maxOk);
  const pessoas = (n: number) => `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
  const nomeSua = QUALIDADES[sua].rotulo;
  const partes: string[] = [];
  if (base.size > 1) {
    partes.push(
      melhor
        ? `Entre as ${base.size} qualidades testadas, a melhor que passou sem engasgos foi ${QUALIDADES[melhor].rotulo}.`
        : capturaLimita
          ? 'Nenhuma qualidade recebeu da captura os fps que pede: os amigos veem no máximo o que a captura entrega, seja qual for a qualidade. Baixar a qualidade não muda isso.'
          : 'Nenhuma das qualidades testadas passou sem engasgos.',
    );
  }
  if (escala.length) {
    if (falhou && maxOk) partes.push(`Em ${nomeSua}, foi bem com até ${pessoas(maxOk)} assistindo e engasgou com ${falhou.trecho.espectadores}.`);
    else if (falhou) partes.push(`Em ${nomeSua}, engasgou já com ${pessoas(falhou.trecho.espectadores)} assistindo.`);
    else partes.push(`Em ${nomeSua}, aguentou ${pessoas(maxOk)} assistindo sem problema.`);
  }
  if (principal) partes.push(`Gargalo principal: ${principal.titulo.charAt(0).toLowerCase()}${principal.titulo.slice(1)}.`);
  let titulo: string;
  if (base.size > 1) {
    titulo = melhor
      ? falhou && melhor === sua
        ? `Use ${QUALIDADES[melhor].rotulo} com até ${pessoas(Math.max(1, maxOk))}`
        : `Use ${QUALIDADES[melhor].rotulo}: seu PC deu conta`
      : capturaLimita
        ? `A captura do jogo limita a imagem a ~${Math.round(Math.max(...[...base.values()].map((t) => t.captura.fps ?? 0)))} fps em todas as qualidades`
        : 'Seu PC teve dificuldade em todas as qualidades';
  } else {
    titulo = !falhou ? `${nomeSua}: seu PC aguentou ${pessoas(maxOk)} assistindo` : maxOk ? `${nomeSua}: bem até ${pessoas(maxOk)}, engasgou com ${falhou.trecho.espectadores}` : `${nomeSua}: engasgou já com ${pessoas(falhou.trecho.espectadores)}`;
  }
  return { titulo, texto: partes.join(' ') };
}

export function analisar(g: Gravacao): Analise {
  const trechos = g.trechos.map((t) => resumirTrecho(g, t));
  const diagnosticos = diagnosticar(g, trechos);
  const recomendacao = recomendar(g, trechos, diagnosticos);
  const validos = trechos.filter((t) => t.segundos > 0 && !t.trecho.aquecimento);
  const daPessoa = validos.find((t) => t.trecho.qualidade === g.qualidadeDaPessoa && t.trecho.espectadores <= 1) ?? validos[0];
  const gargalo = diagnosticos.find((d) => d.gravidade === 'alta' || d.gravidade === 'media');
  return {
    trechos,
    diagnosticos,
    recomendacao,
    principal: {
      fluidez: daPessoa?.recepcao.fluidez ?? null,
      p99Ms: daPessoa?.recepcao.p99Ms ?? null,
      atraso: daPessoa?.atraso.total ?? null,
      gargalo: gargalo ? gargalo.codigo : 'nenhum',
    },
  };
}

export const NOMES_DOS_GARGALOS: Record<string, string> = {
  nenhum: 'Nenhum',
  'captura-lenta': 'Captura do jogo',
  'codificador-software': 'Codificador por software',
  'codificador-saturado': 'Codificador',
  'placa-sem-quadros': 'Codificador da placa parado',
  banda: 'Banda',
  'perda-de-pacotes': 'Perda de pacotes',
  'rede-lenta': 'Rede',
  'decodificacao-lenta': 'Decodificação',
  'perde-na-tela': 'Exibição',
  congelamentos: 'Congelamentos',
  'interface-trava': 'Interface',
  'congela-ao-entrar': 'Entrada de espectadores',
  'placa-cheia': 'Placa de vídeo',
  'codificador-disputado': 'Codificador da placa (outro programa)',
  'atraso-no-buffer': 'Atraso no buffer',
  'sem-dados': 'Sem dados',
};

export { fmt };
