// A "porta" do microfone: decide, a cada 10 ms, se o que entra é fala (abre) ou só barulho (fecha).
// Roda dentro do processador de áudio (processador.ts), sem nada de página.

/** O RNNoise trabalha em quadros de 10 ms a 48 kHz. */
export const QUADRO = 480;
/** Depois da última sílaba, a porta fica aberta mais 350 ms: sem isso, o fim das palavras seria cortado. */
const SEGURAR = 35;
/** Acima disso o RNNoise acha que é voz humana (0 a 1). */
const CHANCE_DE_VOZ = 0.5;
const SILENCIO = -100;
/**
 * O começo sem voz das palavras ("S" de "sim", "F" de "fala", "Ch" de "chega") o RNNoise não chama de voz, e a porta
 * só abriria na vogal, comendo de 80 a 180 ms. Então um chiado estável (3 quadros seguidos bem acima do ruído de fundo,
 * com a energia espalhada no quadro, o que um clique de tecla não tem) abre a porta por até 200 ms, esperando a voz.
 * O processador atrasa a saída nesses 3 quadros para que o começo do chiado também passe.
 */
export const ANTECIPAR = 3;
const PROVISORIA = 20;
const FOLGA_DO_CHIADO = 12;
const PICO_DO_CHIADO = 2;

export type AjustesDaPorta = { automatica: boolean; limiarDb: number };

/** O volume de um quadro em dB (0 dB = o máximo), com -100 para silêncio. */
export function nivelEmDb(amostras: Float32Array): number {
  let soma = 0;
  for (let i = 0; i < amostras.length; i++) soma += amostras[i] * amostras[i];
  const rms = Math.sqrt(soma / amostras.length);
  return rms > 1e-5 ? Math.max(SILENCIO, 20 * Math.log10(rms)) : SILENCIO;
}

/** Quanto a energia do quadro se concentra num pedaço de 2,5 ms: 1 = espalhada (chiado), 4 = toda num pedaço (clique). */
export function picoNoQuadro(amostras: Float32Array): number {
  const pedaco = amostras.length / 4;
  let maior = 0;
  let soma = 0;
  for (let p = 0; p < 4; p++) {
    let e = 0;
    for (let i = p * pedaco; i < (p + 1) * pedaco; i++) e += amostras[i] * amostras[i];
    maior = Math.max(maior, e);
    soma += e;
  }
  return soma > 0 ? maior / (soma / 4) : 1;
}

export class Porta {
  /** O ruído de fundo estimado (dB): desce rápido quando fica mais quieto e sobe devagar (ar-condicionado ligado). */
  piso = -70;
  aberta = false;
  private segurar = 0;
  private chiadoSeguido = 0;
  private provisoria = 0;
  /** Um chiado que não virou voz não reabre a porta até o som cair (ventilador, sopro). */
  private chiadoGasto = false;

  /**
   * Automática: abre quando o RNNoise diz que é voz e ela está acima do ruído de fundo, ou provisoriamente no
   * começo sem voz das palavras (ver ANTECIPAR). Sem o RNNoise (não carregou), usa só o volume acima do ruído
   * de fundo. Manual: abre acima do limite escolhido.
   */
  decidir(nivelDb: number, chanceDeVoz: number | null, ajustes: AjustesDaPorta, pico = 1): boolean {
    if (nivelDb < this.piso) this.piso += (nivelDb - this.piso) * 0.1;
    else if (chanceDeVoz === null || chanceDeVoz < 0.2) this.piso += Math.min(0.02, nivelDb - this.piso); // ~2 dB por segundo
    this.piso = Math.min(-20, Math.max(SILENCIO, this.piso));

    let fala: boolean;
    if (!ajustes.automatica) fala = nivelDb > ajustes.limiarDb;
    else if (chanceDeVoz !== null) fala = chanceDeVoz >= CHANCE_DE_VOZ && nivelDb > Math.max(-75, this.piso + 6);
    else fala = nivelDb > Math.max(-65, this.piso + 12);

    const chiado = nivelDb > Math.max(-65, this.piso + FOLGA_DO_CHIADO) && pico <= PICO_DO_CHIADO;
    this.chiadoSeguido = chiado ? this.chiadoSeguido + 1 : 0;
    if (!chiado) this.chiadoGasto = false;

    if (fala) {
      this.segurar = SEGURAR;
      this.provisoria = 0;
      this.chiadoGasto = false;
    } else if (this.segurar > 0) this.segurar--;

    let provisoria = false;
    if (ajustes.automatica && chanceDeVoz !== null && this.segurar === 0) {
      if (this.chiadoSeguido >= ANTECIPAR && this.provisoria === 0 && !this.chiadoGasto) this.provisoria = PROVISORIA;
      if (this.provisoria > 0) {
        provisoria = true;
        if (--this.provisoria === 0) this.chiadoGasto = true;
      }
    }
    this.aberta = fala || this.segurar > 0 || provisoria;
    return this.aberta;
  }
}
