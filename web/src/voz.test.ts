import { beforeEach, describe, expect, it } from 'vitest';
import { FOLGA, FolgaAdaptativa } from './folga';
import { AJUSTES_PADRAO, lerAjustes } from './voz/ajustes';
import { Porta } from './voz/porta';
import { LeitorDeAtalhos, ATALHOS_PADRAO, teclaVirtual } from './voz/atalhos';
import { MedidorDaConexao } from './voz/qualidade';

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

  it('na automática, abre no chiado do começo da palavra ("S", "F"), mas não com cliques', () => {
    const porta = new Porta();
    for (let i = 0; i < 100; i++) porta.decidir(-60, 0.01, AUTOMATICA);
    for (let i = 0; i < 5; i++) porta.decidir(-35, 0.05, AUTOMATICA, 4); // cliques: alto, energia num pedaço só
    expect(porta.aberta).toBe(false);
    for (let i = 0; i < 10; i++) porta.decidir(-60, 0.01, AUTOMATICA);
    porta.decidir(-42, 0.1, AUTOMATICA, 1.3);
    porta.decidir(-41, 0.1, AUTOMATICA, 1.4);
    expect(porta.decidir(-40, 0.15, AUTOMATICA, 1.2)).toBe(true); // 3 quadros de chiado: abre (e a saída volta 30 ms)
    for (let i = 0; i < 25; i++) porta.decidir(-40, 0.15, AUTOMATICA, 1.2); // chiado que nunca vira voz (sopro)
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

describe('qualidade da conexão com cada amigo', () => {
  it('piora na hora, melhora só depois de uns segundos, e não conta perda com o amigo calado', () => {
    const medidor = new MedidorDaConexao();
    const ler = (idaEVolta: number, recebidos: number, perdidos: number) => medidor.medir({ estado: 'connected', idaEVolta, recebidos, perdidos, jitter: 0.005 });
    expect(ler(0.04, 0, 0).nivel).toBe('boa');
    // Calado (DTX): 5 pacotes a cada 2 s, 1 perdido. Seria "17% de perda", mas são pacotes de menos para contar.
    expect(ler(0.04, 5, 1).perdaPct).toBeNull();
    expect(ler(0.2, 10, 1).nivel).toBe('instavel'); // 200 ms de ida e volta: piora na hora
    expect(ler(0.04, 110, 1).nivel).toBe('instavel'); // melhorou, mas ainda não por tempo bastante
    expect(ler(0.04, 210, 1).nivel).toBe('instavel');
    const boa = ler(0.04, 310, 1);
    expect(boa.nivel).toBe('boa'); // 3 leituras seguidas melhores
    expect(boa.perdaPct).toBe(0.3); // falando: 1 perdido em 311
    expect(ler(0.04, 360, 60).nivel).toBe('ruim'); // perda alta: ruim na hora
    expect(medidor.medir({ estado: 'failed' }).nivel).toBe('sem');
  });
});

describe('atalhos de voz', () => {
  it('mudo troca ao completar a combinação; apertar para falar conta ao apertar e ao soltar', () => {
    const eventos: string[] = [];
    const atalhos = { ...ATALHOS_PADRAO, falar: { teclas: ['Mouse4'], nome: 'Mouse 4' } };
    const leitor = new LeitorDeAtalhos(atalhos, (qual, apertado) => eventos.push(`${qual} ${apertado}`));
    leitor.apertou('Control');
    leitor.apertou('Shift');
    leitor.apertou('KeyM');
    leitor.soltou('KeyM');
    leitor.apertou('KeyM'); // de novo, com Ctrl e Shift ainda apertados
    leitor.apertou('Mouse4');
    leitor.soltarTudo(); // a página perdeu o foco com tudo apertado
    expect(eventos).toEqual(['mudo true', 'mudo true', 'falar true', 'falar false']);
  });

  it('as teclas viram as teclas virtuais que o app pergunta ao Windows', () => {
    expect(['Control', 'Shift', 'KeyM', 'Digit0', 'F24', 'Numpad5', 'Mouse4', 'Semicolon'].map(teclaVirtual)).toEqual([
      0x11, 0x10, 0x4d, 0x30, 0x87, 0x65, 0x05, 0xba,
    ]);
    expect(teclaVirtual('Fn')).toBeNull();
  });
});
