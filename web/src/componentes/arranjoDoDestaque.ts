// No modo destaque, as outras transmissões vão numa coluna à direita ou numa fileira embaixo, como no Discord: o que
// deixar a principal maior. Antes, a escolha era pela proporção do palco (9:5), e num palco quase dessa proporção a
// principal ficava com a coluna larga e uma faixa vazia embaixo (31/10/2026, 1920×1080 com duas transmissões).

const VAO = 12; // o gap do .destaque-arranjo
const PROPORCAO = 16 / 9;
const COLUNA_MINIMA = 240;
const COLUNA_MAXIMA = 420;
const FILEIRA_MINIMA = 90;
const FILEIRA_MAXIMA = 150;

export type Arranjo = {
  /** `lado`: as outras numa coluna à direita; `embaixo`: numa fileira embaixo. */
  onde: 'lado' | 'embaixo';
  /** Largura da principal, em px. */
  principal: number;
  /** Largura da coluna ou altura da fileira, em px. */
  lateral: number;
};

const limitar = (valor: number, minimo: number, maximo: number) => Math.min(maximo, Math.max(minimo, valor));

export function arranjoDoDestaque(largura: number, altura: number): Arranjo {
  // Coluna: a principal com a altura toda, e a coluna com o que sobrar ao lado (nem fina demais, nem larga demais).
  const coluna = limitar(largura - altura * PROPORCAO - VAO, COLUNA_MINIMA, COLUNA_MAXIMA);
  const aoLado = Math.min(largura - coluna - VAO, altura * PROPORCAO);
  const fileira = limitar(altura * 0.17, FILEIRA_MINIMA, FILEIRA_MAXIMA);
  const embaixo = Math.min(largura, (altura - fileira - VAO) * PROPORCAO);
  return aoLado >= embaixo
    ? { onde: 'lado', principal: Math.max(0, Math.floor(aoLado)), lateral: coluna }
    : { onde: 'embaixo', principal: Math.max(0, Math.floor(embaixo)), lateral: fileira };
}
