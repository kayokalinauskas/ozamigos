// Quem escolheu 1080p e não dá conta (o PC ou a internet de quem transmite) desce sozinho para 720p, e volta quando
// folgar. Como no Discord: a imagem fica menor, mas não trava. Nunca sobe acima do que a pessoa escolheu.
// A 1080p usa "maintain-resolution" (veja QUALIDADES): sem esta descida, um aperto que dura vira fps baixo e engasgo.

import { QUALIDADES, type Qualidade } from './qualidade';

export const AUTOMATICA = {
  /** Segundos de cada conexão de envio antes de contar: o bitrate inicial e a estimativa de banda ainda estão subindo. */
  maduraDepois: 10,
  /** Depois de cada troca de qualidade, o codificador e a estimativa de banda se ajustam por esse tempo (s). */
  carenciaDaTroca: 10,
  /** Desce com o aperto em `apertados` dos últimos `janela` segundos: um soluço curto não derruba a qualidade. */
  janela: 10,
  apertados: 6,
  /** A banda estimada abaixo dessa fração do bitrate da qualidade escolhida conta como aperto da internet. Em 1080p
   * pelo cabo, ela ficava entre 7,6 e 8,9 Mbps; no Wi-Fi do notebook, a mediana era 4,7 e os piores 10%, 2,7. */
  bandaMinima: 0.6,
  /** Para voltar: tantos segundos seguidos sem aperto, e a espera desde a descida (s), que dobra a cada nova descida. */
  calmaParaSubir: 30,
  esperaInicial: 120,
  esperaMaxima: 960,
} as const;

/** Para onde cada qualidade desce. A 720p não desce mais: lá, o próprio WebRTC baixa a imagem ("balanced"). */
const MAIS_LEVE: Partial<Record<Qualidade, Qualidade>> = { nitida: 'leve' };

/** O que segurou a transmissão: o PC (processador ou placa de vídeo) ou a internet de quem transmite. */
export type Motivo = 'pc' | 'rede';

/** O que se usa de cada conexão de envio (a Metrica de conexao/medidor.ts). */
export type EnvioMedido = { id: string; limite: string | null; banda: number | null };

export type Decisao = { acao: 'descer'; qualidade: Qualidade; motivo: Motivo } | { acao: 'subir'; qualidade: Qualidade };

export class QualidadeAutomatica {
  /** Por que desceu; null enquanto está na qualidade escolhida. */
  motivo: Motivo | null = null;
  private readonly vistos = new Map<string, number>(); // id de quem assiste -> quando apareceu (ms)
  private janela: (Motivo | null)[] = [];
  private calma = 0;
  private descidas = 0;
  private desceuEm = 0;
  private trocouEm = -Infinity;

  /** Uma vez por segundo, com as conexões de envio. Devolve a troca a fazer, ou null. */
  medir(agora: number, escolhida: Qualidade, envios: EnvioMedido[]): Decisao | null {
    const menor = MAIS_LEVE[escolhida];
    if (!menor) return null;
    for (const id of this.vistos.keys()) if (!envios.some((e) => e.id === id)) this.vistos.delete(id);
    for (const { id } of envios) if (!this.vistos.has(id)) this.vistos.set(id, agora);
    const maduros = envios.filter((e) => agora - this.vistos.get(e.id)! >= AUTOMATICA.maduraDepois * 1000);
    // Sem ninguém assistindo há tempo suficiente, não há o que julgar: fica como está.
    if (!maduros.length || agora - this.trocouEm < AUTOMATICA.carenciaDaTroca * 1000) {
      this.janela = [];
      this.calma = 0;
      return null;
    }
    const aperto = apertoDe(maduros, escolhida, this.motivo === null);

    if (this.motivo === null) {
      this.janela.push(aperto);
      if (this.janela.length > AUTOMATICA.janela) this.janela.shift();
      const apertados = this.janela.filter((m) => m !== null);
      if (apertados.length < AUTOMATICA.apertados) return null;
      this.motivo = apertados.includes('pc') ? 'pc' : 'rede';
      this.descidas++;
      this.desceuEm = agora;
      this.trocou(agora);
      return { acao: 'descer', qualidade: menor, motivo: this.motivo };
    }

    this.calma = aperto ? 0 : this.calma + 1;
    const espera = Math.min(AUTOMATICA.esperaInicial * 2 ** (this.descidas - 1), AUTOMATICA.esperaMaxima) * 1000;
    if (this.calma < AUTOMATICA.calmaParaSubir || agora - this.desceuEm < espera) return null;
    this.motivo = null;
    this.trocou(agora);
    return { acao: 'subir', qualidade: escolhida };
  }

  /** A pessoa escolheu outra qualidade, ou parou de transmitir: começa do zero. */
  reiniciar() {
    this.motivo = null;
    this.descidas = 0;
    this.vistos.clear();
    this.trocou(-Infinity);
  }

  private trocou(agora: number) {
    this.trocouEm = agora;
    this.janela = [];
    this.calma = 0;
  }
}

/**
 * O pior aperto entre as conexões, medido contra a qualidade escolhida (para voltar, a 720p precisa ter folga para 1080p).
 * qualityLimitationReason: "cpu" é o PC; "bandwidth" é a internet. Na 1080p, que não baixa a resolução, "bandwidth"
 * quer dizer fps reduzido. Na 720p ("balanced") ele não conta: o WebRTC o deixa preso por minutos depois de uma queda
 * curta (num relatório da 1.2.3, 148 s com "bandwidth" e a banda estimada em ~7 Mbps), e a qualidade nunca voltaria.
 * O Firefox não informa o motivo: lá, só a banda estimada conta.
 */
function apertoDe(envios: EnvioMedido[], escolhida: Qualidade, contarLimiteDeBanda: boolean): Motivo | null {
  if (envios.some((e) => e.limite === 'cpu')) return 'pc';
  const bandaMinima = (QUALIDADES[escolhida].bitrate / 1e6) * AUTOMATICA.bandaMinima;
  const semBanda = (e: EnvioMedido) => (contarLimiteDeBanda && e.limite === 'bandwidth') || (e.banda != null && e.banda < bandaMinima);
  return envios.some(semBanda) ? 'rede' : null;
}
