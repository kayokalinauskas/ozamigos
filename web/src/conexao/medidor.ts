// As estatísticas de cada conexão de vídeo, uma vez por segundo: os fps de verdade, e o porquê quando não chega lá.

import type { Canal } from './protocolo';

/** Uma linha de medição por conexão, atualizada a cada segundo. */
export type Metrica = {
  canal: Canal;
  id: string;
  fps: number;
  largura: number | null;
  altura: number | null;
  mbps: number;
  codec: string;
  captura: number | null; // fps que o navegador consegue copiar da tela (só envio)
  codificador: string | null;
  limite: string | null; // qualityLimitationReason (só envio; o Firefox não informa)
  rede: string | null; // host, srflx, prflx ou relay
  idaEVolta: number | null; // ms
  banda: number | null; // Mbps estimados de upload (só envio)
  congelamentos: number; // só recebimento
  perdidos: number; // só recebimento
  congelouAgora: boolean; // houve congelamento nos últimos segundos
};

export type ConexaoMedida = { pc: RTCPeerConnection; id: string; canal: Canal };

/** O que se mede de quem eu assisto, para a folga de rede acompanhar (folga.ts). */
export type AoMedirRecebimento = (id: string, pc: RTCPeerConnection, jitterEmSegundos: number | undefined, congelamentos: number) => void;

export class Medidor {
  private readonly anteriores = new Map<string, { bytes: number; momento: number }>();
  private readonly historicoDeCongelamentos = new Map<string, number[]>();

  constructor(private readonly aoMedirRecebimento: AoMedirRecebimento) {}

  /** Mede todas as conexões; a chave do resultado é a mesma do mapa recebido. */
  async medir(conexoes: Map<string, ConexaoMedida>): Promise<Record<string, Metrica>> {
    const metricas: Record<string, Metrica> = {};
    for (const [chaveDaConexao, { pc, id, canal }] of conexoes) {
      let relatorio: Map<string, any>;
      try {
        relatorio = (await pc.getStats()) as unknown as Map<string, any>;
      } catch {
        continue; // a conexão fechou durante a medição
      }
      let rede: string | null = null;
      let idaEVolta: number | null = null;
      let banda: number | null = null;
      relatorio.forEach((r) => {
        // Chrome e Edge apontam o par de candidatos escolhido no relatório "transport"; o Firefox marca o par com selected.
        let par = null;
        if (r.type === 'transport' && r.selectedCandidatePairId) par = relatorio.get(r.selectedCandidatePairId);
        if (r.type === 'candidate-pair' && r.selected) par = r;
        if (!par) return;
        rede = relatorio.get(par.remoteCandidateId)?.candidateType ?? null;
        idaEVolta = par.currentRoundTripTime != null ? Math.round(par.currentRoundTripTime * 1000) : null;
        if (canal === 'envio' && par.availableOutgoingBitrate) banda = par.availableOutgoingBitrate / 1e6;
      });
      relatorio.forEach((r) => {
        if (r.kind !== 'video' || (r.type !== 'outbound-rtp' && r.type !== 'inbound-rtp')) return;
        const enviando = r.type === 'outbound-rtp';
        // O Firefox gera ids de relatório novos a cada consulta: o ssrc identifica o fluxo nos dois navegadores.
        const mbps = this.mbpsDesde(`${chaveDaConexao}:${r.type}:${r.ssrc}`, enviando ? r.bytesSent : r.bytesReceived, r.timestamp);
        const congelamentos = r.freezeCount ?? 0;
        if (!enviando) this.aoMedirRecebimento(id, pc, r.jitter, congelamentos);
        metricas[chaveDaConexao] = {
          canal,
          id,
          fps: Math.round(r.framesPerSecond ?? 0),
          largura: r.frameWidth ?? null,
          altura: r.frameHeight ?? null,
          mbps,
          codec: relatorio.get(r.codecId)?.mimeType?.replace('video/', '') ?? '?',
          // A captura vem antes do codificador: se ela já está baixa, o problema é o jogo/placa de vídeo, não a rede.
          captura: enviando ? (relatorio.get(r.mediaSourceId)?.framesPerSecond ?? null) : null,
          codificador: enviando ? (r.encoderImplementation ?? null) : null,
          limite: enviando ? (r.qualityLimitationReason ?? null) : null,
          rede,
          idaEVolta,
          banda,
          congelamentos,
          perdidos: r.framesDropped ?? 0,
          congelouAgora: !enviando && this.congelouAgora(chaveDaConexao, congelamentos),
        };
      });
    }
    return metricas;
  }

  /** A conexão fechou: o que se guardou dela para comparar com o segundo seguinte não serve mais. */
  esquecer(chaveDaConexao: string) {
    const prefixo = `${chaveDaConexao}:`;
    for (const chave of this.anteriores.keys()) {
      if (chave.startsWith(prefixo)) this.anteriores.delete(chave);
    }
    this.historicoDeCongelamentos.delete(chaveDaConexao);
  }

  private mbpsDesde(chave: string, bytes: number, momento: number): number {
    const anterior = this.anteriores.get(chave);
    this.anteriores.set(chave, { bytes, momento });
    return anterior ? ((bytes - anterior.bytes) * 8) / ((momento - anterior.momento) * 1000) : 0;
  }

  /** Congelou nos últimos 5 segundos? Guarda a contagem de cada segundo e compara com a de 5 s atrás. */
  private congelouAgora(chaveDaConexao: string, congelamentos: number): boolean {
    const historico = this.historicoDeCongelamentos.get(chaveDaConexao) ?? [];
    historico.push(congelamentos);
    if (historico.length > 6) historico.shift();
    this.historicoDeCongelamentos.set(chaveDaConexao, historico);
    return congelamentos > historico[0];
  }
}
