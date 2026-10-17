// A qualidade da conexão com cada amigo, medida na conexão de voz (que existe com todos, transmitindo ou não).
// Mostra na barra lateral quando está ruim, e os números no menu de voz da pessoa: "é a minha internet ou a dele?".

export type NivelDaConexao = 'boa' | 'instavel' | 'ruim' | 'conectando' | 'sem';

export type QualidadeDaConexao = {
  nivel: NivelDaConexao;
  idaEVoltaMs: number | null;
  perdaPct: number | null; // do que ela me mandou, quanto se perdeu no caminho
  jitterMs: number | null;
};

/** Uma leitura do getStats da conexão de voz (os contadores são os acumulados desde o começo). */
export type AmostraDaConexao = {
  estado: RTCPeerConnectionState;
  idaEVolta?: number; // segundos
  recebidos?: number;
  perdidos?: number;
  jitter?: number; // segundos
};

// Os limites, do pior para o melhor. Para voz e para a transmissão, 150 ms de ida e volta já se sentem na conversa.
export const LIMITES = {
  instavel: { idaEVoltaMs: 150, perdaPct: 3, jitterMs: 30 },
  ruim: { idaEVoltaMs: 300, perdaPct: 10, jitterMs: 60 },
};
// A perda é contada nos últimos ~10 s (5 leituras a cada 2 s), e só com pacotes bastantes: com o amigo calado, o Opus
// manda um pacote a cada 400 ms (DTX), e 1 perdido em 5 viraria "20% de perda".
const LEITURAS_DA_PERDA = 5;
const PACOTES_MINIMOS = 50;
// Para voltar a "boa" (ou melhorar), a conexão precisa ficar melhor por 3 leituras seguidas (~6 s): sem piscar.
const LEITURAS_PARA_MELHORAR = 3;

const ORDEM: NivelDaConexao[] = ['boa', 'instavel', 'ruim'];

function nivelDe(valor: number | null, campo: keyof (typeof LIMITES)['ruim']): NivelDaConexao {
  if (valor === null) return 'boa';
  if (valor >= LIMITES.ruim[campo]) return 'ruim';
  if (valor >= LIMITES.instavel[campo]) return 'instavel';
  return 'boa';
}

const pior = (a: NivelDaConexao, b: NivelDaConexao) => (ORDEM.indexOf(a) >= ORDEM.indexOf(b) ? a : b);

export class MedidorDaConexao {
  private contadores: { recebidos: number; perdidos: number }[] = [];
  private atual: NivelDaConexao = 'conectando';
  private melhorSeguidas = 0;

  medir(amostra: AmostraDaConexao): QualidadeDaConexao {
    if (amostra.estado !== 'connected') {
      this.contadores = [];
      this.melhorSeguidas = 0;
      const nivel = amostra.estado === 'failed' || amostra.estado === 'closed' ? 'sem' : this.atual === 'sem' ? 'sem' : 'conectando';
      this.atual = nivel;
      return { nivel, idaEVoltaMs: null, perdaPct: null, jitterMs: null };
    }

    const idaEVoltaMs = amostra.idaEVolta === undefined ? null : Math.round(amostra.idaEVolta * 1000);
    const jitterMs = amostra.jitter === undefined ? null : Math.round(amostra.jitter * 1000);
    let perdaPct: number | null = null;
    if (amostra.recebidos !== undefined && amostra.perdidos !== undefined) {
      this.contadores.push({ recebidos: amostra.recebidos, perdidos: Math.max(0, amostra.perdidos) });
      if (this.contadores.length > LEITURAS_DA_PERDA + 1) this.contadores.shift();
      const primeiro = this.contadores[0];
      const ultimo = this.contadores[this.contadores.length - 1];
      const recebidos = ultimo.recebidos - primeiro.recebidos;
      const perdidos = Math.max(0, ultimo.perdidos - primeiro.perdidos);
      if (recebidos + perdidos >= PACOTES_MINIMOS) perdaPct = Math.round((perdidos / (recebidos + perdidos)) * 1000) / 10;
    }

    const agora = [nivelDe(idaEVoltaMs, 'idaEVoltaMs'), nivelDe(perdaPct, 'perdaPct'), nivelDe(jitterMs, 'jitterMs')].reduce(pior);
    const melhorou = ORDEM.includes(this.atual) && ORDEM.indexOf(agora) < ORDEM.indexOf(this.atual);
    if (melhorou) {
      this.melhorSeguidas++;
      if (this.melhorSeguidas >= LEITURAS_PARA_MELHORAR) {
        this.atual = agora;
        this.melhorSeguidas = 0;
      }
    } else {
      this.atual = agora; // piorou (ou acabou de conectar): vale na hora
      this.melhorSeguidas = 0;
    }
    return { nivel: this.atual, idaEVoltaMs, perdaPct, jitterMs };
  }
}

/** Tira do getStats da conexão de voz o que o medidor usa. */
export function amostraDe(estado: RTCPeerConnectionState, relatorio: RTCStatsReport): AmostraDaConexao {
  const amostra: AmostraDaConexao = { estado };
  let parSelecionado: string | undefined;
  relatorio.forEach((r) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) parSelecionado = r.selectedCandidatePairId;
  });
  relatorio.forEach((r) => {
    if (r.type === 'candidate-pair' && (r.id === parSelecionado || (!parSelecionado && r.nominated && r.state === 'succeeded'))) {
      if (typeof r.currentRoundTripTime === 'number') amostra.idaEVolta = r.currentRoundTripTime;
    } else if (r.type === 'inbound-rtp' && r.kind === 'audio') {
      amostra.recebidos = r.packetsReceived;
      amostra.perdidos = r.packetsLost;
      if (typeof r.jitter === 'number') amostra.jitter = r.jitter;
    } else if (r.type === 'remote-inbound-rtp' && r.kind === 'audio' && amostra.idaEVolta === undefined && typeof r.roundTripTime === 'number') {
      amostra.idaEVolta = r.roundTripTime; // o Firefox não dá o do par de candidatos: vale o do RTCP
    }
  });
  return amostra;
}

/** O texto da dica e do menu: "boa · 35 ms" ou "instável · 180 ms · 4% de perda". */
export function descrever(q: QualidadeDaConexao): string {
  if (q.nivel === 'conectando') return 'conectando…';
  if (q.nivel === 'sem') return 'sem conexão direta (a rede não deixou conectar)';
  const partes = [q.nivel === 'boa' ? 'boa' : q.nivel === 'instavel' ? 'instável' : 'ruim'];
  if (q.idaEVoltaMs !== null) partes.push(`${q.idaEVoltaMs} ms`);
  if (q.perdaPct !== null && q.perdaPct > 0) partes.push(`${q.perdaPct.toLocaleString('pt-BR')}% de perda`);
  if (q.jitterMs !== null && q.jitterMs >= LIMITES.instavel.jitterMs) partes.push(`variação de ${q.jitterMs} ms`);
  return partes.join(' · ');
}
