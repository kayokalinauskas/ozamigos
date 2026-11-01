import { describe, expect, it } from 'vitest';
import { arranjoDoDestaque } from './arranjoDoDestaque';

describe('arranjo do destaque', () => {
  it('escolhe o lado em que a principal fica maior, sem passar do espaço', () => {
    // 1920×1080 sem painel aberto (31/10/2026): com a coluna mais fina, a principal passa de ~1290 para 1421 px.
    const cheio = arranjoDoDestaque(1673, 925);
    expect(cheio).toEqual({ onde: 'lado', principal: 1421, lateral: 240 });
    // Com o chat aberto, o palco estreita: a fileira embaixo deixa a principal maior.
    const comChat = arranjoDoDestaque(1350, 925);
    expect(comChat.onde).toBe('embaixo');
    expect(comChat.principal).toBeGreaterThan(1350 - 240 - 12);
    // Em qualquer medida, a principal e as outras cabem no palco.
    for (const [largura, altura] of [[2232, 1250], [1350, 925], [900, 300], [3000, 600], [600, 1200]]) {
      const a = arranjoDoDestaque(largura, altura);
      const alturaDaPrincipal = (a.principal * 9) / 16;
      if (a.onde === 'lado') {
        expect(a.principal + 12 + a.lateral).toBeLessThanOrEqual(largura);
        expect(alturaDaPrincipal).toBeLessThanOrEqual(altura);
      } else {
        expect(a.principal).toBeLessThanOrEqual(largura);
        expect(alturaDaPrincipal + 12 + a.lateral).toBeLessThanOrEqual(altura);
      }
    }
  });
});
