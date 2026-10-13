// Quanto quem assiste segura de imagem antes de mostrar (jitterBufferTarget), ajustado pela rede de cada um.
// Era fixo em 200 ms, e os relatórios mostraram que isso era ~96% do atraso. Em rede boa, 80–100 ms bastam;
// quando o Wi-Fi oscila ou a imagem congela, a folga sobe na hora e depois desce devagar.

export const FOLGA = { minima: 80, inicial: 100, maxima: 250 } as const;

/** A folga sobe isso a cada congelamento. */
const SOBE_AO_CONGELAR = 50;
/** Com a rede calma por esse tempo (s), a folga desce 5 ms por segundo até o que a rede pede. */
const CALMA = 10;

export class FolgaAdaptativa {
  alvo: number = FOLGA.inicial;
  private calma = 0;
  private congelamentos: number | null = null;

  /**
   * Uma vez por segundo, com a variação de chegada dos pacotes de vídeo (jitter do RTP, em ms) e o total de
   * congelamentos da conexão. Devolve a folga nova.
   */
  medir(jitterMs: number | null, congelamentos: number): number {
    const novos = this.congelamentos === null ? 0 : Math.max(0, congelamentos - this.congelamentos);
    this.congelamentos = congelamentos;
    const pelaRede = Math.min(FOLGA.maxima, Math.max(FOLGA.minima, Math.round((jitterMs ?? 0) * 4 + 40)));
    if (novos > 0) {
      this.alvo = Math.min(FOLGA.maxima, Math.max(this.alvo, pelaRede) + SOBE_AO_CONGELAR);
      this.calma = 0;
    } else if (pelaRede > this.alvo) {
      this.alvo = pelaRede;
      this.calma = 0;
    } else if (++this.calma >= CALMA) {
      this.alvo = Math.max(pelaRede, this.alvo - 5);
    }
    return this.alvo;
  }
}
