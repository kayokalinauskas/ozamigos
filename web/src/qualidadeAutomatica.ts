// Quem escolheu 1080p e não dá conta desce sozinho para 720p, e volta quando folgar. Como no Discord: a imagem fica
// menor, mas não trava. Nunca sobe acima do que a pessoa escolheu.
// A 1080p usa "maintain-resolution" (veja QUALIDADES): sem esta descida, um aperto que dura vira fps baixo e engasgo.
// Dois apertos, decididos à parte:
// - o PC de quem transmite (processador ou placa de vídeo): a captura inteira desce, para todos, porque o problema é dele;
// - a internet: cada pessoa que assiste tem a sua conexão e o seu codificador, então só quem não aguenta recebe 720p
//   (scaleResolutionDownBy naquele envio). Um amigo num Wi-Fi ruim não derruba a imagem de quem está no cabo.

import { QUALIDADES, type Qualidade } from './qualidade';

export const AUTOMATICA = {
  /** Segundos sem julgar uma conexão nova ou recém-trocada: o bitrate inicial e a estimativa de banda ainda estão subindo. */
  carencia: 10,
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

export function qualidadeMaisLeve(qualidade: Qualidade): Qualidade | null {
  return MAIS_LEVE[qualidade] ?? null;
}

/** O que segurou a transmissão: o PC (processador ou placa de vídeo) ou a internet entre quem transmite e quem assiste. */
export type Motivo = 'pc' | 'rede';

/** O que se usa de cada conexão de envio (a Metrica de conexao/medidor.ts). */
export type EnvioMedido = { id: string; limite: string | null; banda: number | null };

/** id null: a captura, para todos (motivo "pc"); com id, só o envio para essa pessoa (motivo "rede"). */
export type Decisao = { acao: 'descer' | 'subir'; id: string | null; motivo: Motivo };

/** A memória de um aperto: o do PC, ou o da conexão com uma pessoa. */
type Acompanhamento = { reduzida: boolean; janela: boolean[]; calma: number; descidas: number; desceuEm: number; trocouEm: number };

const novo = (trocouEm: number): Acompanhamento => ({ reduzida: false, janela: [], calma: 0, descidas: 0, desceuEm: 0, trocouEm });

export class QualidadeAutomatica {
  private pc = novo(-Infinity);
  private readonly pessoas = new Map<string, Acompanhamento>(); // id de quem assiste -> a conexão com essa pessoa

  /** A captura desceu para todos, porque o PC não dava conta. */
  get reduzidaPeloPc() {
    return this.pc.reduzida;
  }

  /** Quem está recebendo a qualidade mais leve porque a conexão não aguentava. */
  reduzidos(): string[] {
    return [...this.pessoas].filter(([, p]) => p.reduzida).map(([id]) => id);
  }

  /** Uma vez por segundo, com as conexões de envio. Devolve as trocas a fazer. */
  medir(agora: number, escolhida: Qualidade, envios: EnvioMedido[]): Decisao[] {
    if (!qualidadeMaisLeve(escolhida)) return [];
    for (const id of this.pessoas.keys()) if (!envios.some((e) => e.id === id)) this.pessoas.delete(id);
    for (const { id } of envios) if (!this.pessoas.has(id)) this.pessoas.set(id, novo(agora)); // conexão nova: carência
    const decisoes: Decisao[] = [];

    // O PC vale para todos: basta um envio limitado pelo processador ou pela placa de vídeo.
    const maduros = envios.filter((e) => pronto(this.pessoas.get(e.id)!, agora));
    if (maduros.length && pronto(this.pc, agora)) {
      const acao = passo(this.pc, agora, maduros.some((e) => e.limite === 'cpu'));
      if (acao) {
        decisoes.push({ acao, id: null, motivo: 'pc' });
        // Todos os envios mudaram de tamanho e de bitrate: cada um ganha a carência de novo.
        for (const p of this.pessoas.values()) recomecar(p, agora);
      }
    } else {
      recomecar(this.pc, this.pc.trocouEm);
    }

    // A internet: cada pessoa à parte, pela banda estimada da conexão com ela.
    const bandaMinima = (QUALIDADES[escolhida].bitrate / 1e6) * AUTOMATICA.bandaMinima;
    for (const e of envios) {
      const p = this.pessoas.get(e.id)!;
      if (!pronto(p, agora)) {
        recomecar(p, p.trocouEm);
        continue;
      }
      // "bandwidth" só conta na 1080p cheia, que não baixa a resolução (lá, quer dizer fps reduzido). Na imagem menor
      // o WebRTC o deixa preso por minutos depois de uma queda curta (num relatório da 1.2.3, 148 s com "bandwidth" e a
      // banda estimada em ~7 Mbps), e a qualidade nunca voltaria. O Firefox não informa o motivo: lá, só a banda conta.
      const contarLimite = !this.pc.reduzida && !p.reduzida;
      const semBanda = (contarLimite && e.limite === 'bandwidth') || (e.banda != null && e.banda < bandaMinima);
      const acao = passo(p, agora, semBanda);
      if (acao) decisoes.push({ acao, id: e.id, motivo: 'rede' });
    }
    return decisoes;
  }

  /** A conexão com essa pessoa foi refeita: começa do zero, na qualidade escolhida. */
  esquecer(id: string) {
    this.pessoas.delete(id);
  }

  /** A pessoa escolheu outra qualidade, ou parou de transmitir: começa do zero. */
  reiniciar() {
    this.pc = novo(-Infinity);
    this.pessoas.clear();
  }
}

const pronto = (p: Acompanhamento, agora: number) => agora - p.trocouEm >= AUTOMATICA.carencia * 1000;

function recomecar(p: Acompanhamento, trocouEm: number) {
  p.trocouEm = trocouEm;
  p.janela = [];
  p.calma = 0;
}

/** Um segundo de um acompanhamento: desce com o aperto durando, sobe depois da calma e da espera. */
function passo(p: Acompanhamento, agora: number, apertado: boolean): 'descer' | 'subir' | null {
  if (!p.reduzida) {
    p.janela.push(apertado);
    if (p.janela.length > AUTOMATICA.janela) p.janela.shift();
    if (p.janela.filter(Boolean).length < AUTOMATICA.apertados) return null;
    p.reduzida = true;
    p.descidas++;
    p.desceuEm = agora;
    recomecar(p, agora);
    return 'descer';
  }
  p.calma = apertado ? 0 : p.calma + 1;
  const espera = Math.min(AUTOMATICA.esperaInicial * 2 ** (p.descidas - 1), AUTOMATICA.esperaMaxima) * 1000;
  if (p.calma < AUTOMATICA.calmaParaSubir || agora - p.desceuEm < espera) return null;
  p.reduzida = false;
  recomecar(p, agora);
  return 'subir';
}
