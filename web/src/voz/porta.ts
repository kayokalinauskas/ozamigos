// A "porta" do microfone: decide, a cada 10 ms, se o que entra é fala (abre) ou só barulho (fecha).
// Roda dentro do processador de áudio (processador.ts), sem nada de página.

/** O RNNoise trabalha em quadros de 10 ms a 48 kHz. */
export const QUADRO = 480;
/** Depois da última sílaba, a porta fica aberta mais 350 ms: sem isso, o fim das palavras seria cortado. */
const SEGURAR = 35;
/** Acima disso o RNNoise acha que é voz humana (0 a 1). */
const CHANCE_DE_VOZ = 0.5;
const SILENCIO = -100;

export type AjustesDaPorta = { automatica: boolean; limiarDb: number };

/** O volume de um quadro em dB (0 dB = o máximo), com -100 para silêncio. */
export function nivelEmDb(amostras: Float32Array): number {
  let soma = 0;
  for (let i = 0; i < amostras.length; i++) soma += amostras[i] * amostras[i];
  const rms = Math.sqrt(soma / amostras.length);
  return rms > 1e-5 ? Math.max(SILENCIO, 20 * Math.log10(rms)) : SILENCIO;
}

export class Porta {
  /** O ruído de fundo estimado (dB): desce rápido quando fica mais quieto e sobe devagar (ar-condicionado ligado). */
  piso = -70;
  aberta = false;
  private segurar = 0;

  /**
   * Automática: abre quando o RNNoise diz que é voz e ela está acima do ruído de fundo. Sem o RNNoise
   * (não carregou), usa só o volume acima do ruído de fundo. Manual: abre acima do limite escolhido.
   */
  decidir(nivelDb: number, chanceDeVoz: number | null, ajustes: AjustesDaPorta): boolean {
    if (nivelDb < this.piso) this.piso += (nivelDb - this.piso) * 0.1;
    else if (chanceDeVoz === null || chanceDeVoz < 0.2) this.piso += Math.min(0.02, nivelDb - this.piso); // ~2 dB por segundo
    this.piso = Math.min(-20, Math.max(SILENCIO, this.piso));

    let fala: boolean;
    if (!ajustes.automatica) fala = nivelDb > ajustes.limiarDb;
    else if (chanceDeVoz !== null) fala = chanceDeVoz >= CHANCE_DE_VOZ && nivelDb > Math.max(-75, this.piso + 6);
    else fala = nivelDb > Math.max(-65, this.piso + 12);

    if (fala) this.segurar = SEGURAR;
    else if (this.segurar > 0) this.segurar--;
    this.aberta = fala || this.segurar > 0;
    return this.aberta;
  }
}
