import { beforeEach, describe, expect, it } from 'vitest';
import { FOLGA, FolgaAdaptativa } from './folga';
import { AJUSTES_PADRAO, lerAjustes } from './voz/ajustes';
import { Porta } from './voz/porta';

const AUTOMATICA = { automatica: true, limiarDb: -50 };

describe('porta do microfone', () => {
  it('na automática, abre com voz e não com barulho alto, e segura o fim da fala', () => {
    const porta = new Porta();
    for (let i = 0; i < 100; i++) porta.decidir(-60, 0.01, AUTOMATICA); // ambiente quieto
    expect(porta.decidir(-25, 0.05, AUTOMATICA)).toBe(false); // teclado: alto, mas não é voz
    expect(porta.decidir(-30, 0.95, AUTOMATICA)).toBe(true); // fala
    for (let i = 0; i < 30; i++) porta.decidir(-60, 0.01, AUTOMATICA);
    expect(porta.aberta).toBe(true); // 300 ms depois ainda aberta (fim da palavra)
    for (let i = 0; i < 10; i++) porta.decidir(-60, 0.01, AUTOMATICA);
    expect(porta.aberta).toBe(false);
  });

  it('na manual, abre só acima do limite escolhido', () => {
    const porta = new Porta();
    expect(porta.decidir(-55, 0.99, { automatica: false, limiarDb: -50 })).toBe(false);
    expect(porta.decidir(-45, 0, { automatica: false, limiarDb: -50 })).toBe(true);
  });
});

describe('folga de rede de quem assiste', () => {
  it('sobe ao congelar e desce devagar com a rede calma, sem passar dos limites', () => {
    const folga = new FolgaAdaptativa();
    expect(folga.medir(5, 0)).toBe(FOLGA.inicial);
    expect(folga.medir(5, 1)).toBe(FOLGA.inicial + 50);
    for (let i = 0; i < 9; i++) folga.medir(5, 1);
    expect(folga.alvo).toBe(FOLGA.inicial + 50); // ainda esperando a rede acalmar
    for (let i = 0; i < 200; i++) folga.medir(5, 1);
    expect(folga.alvo).toBe(FOLGA.minima);
    for (let i = 2; i < 10; i++) folga.medir(5, i);
    expect(folga.alvo).toBe(FOLGA.maxima);
  });
});

describe('ajustes de voz', () => {
  beforeEach(() => localStorage.clear());

  it('o que vier estranho do armazenamento volta para o padrão', () => {
    localStorage.setItem('ozamigos-voz', JSON.stringify({ volumeEntrada: 999, supressao: 'outra', limiarDb: 'x', cancelarEco: false }));
    expect(lerAjustes()).toEqual({ ...AJUSTES_PADRAO, volumeEntrada: 200, cancelarEco: false });
    localStorage.setItem('ozamigos-voz', '{quebrado');
    expect(lerAjustes()).toEqual(AJUSTES_PADRAO);
  });
});
