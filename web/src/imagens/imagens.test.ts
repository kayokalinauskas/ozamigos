import { describe, expect, it } from 'vitest';
import { lerControle, pedacos, Recepcao, IMAGENS_RECEBIDAS_POR_MINUTO, PRAZO_PARA_CHEGAR, type Controle } from './protocolo';
import { AREA_MAXIMA, MAXIMO_RECEBIDO, tamanhoAceito, tamanhoDoWebp, tamanhoFinal } from './regras';

/** Um WebP só com o cabeçalho (o bastante para tamanhoDoWebp), completado com zeros até `total` bytes. */
function webp(tipo: 'VP8 ' | 'VP8L' | 'VP8X', largura: number, altura: number, total = 64): Uint8Array {
  const b = new Uint8Array(total);
  const escrever = (texto: string, em: number) => [...texto].forEach((c, i) => (b[em + i] = c.charCodeAt(0)));
  escrever('RIFF', 0);
  escrever('WEBP', 8);
  escrever(tipo, 12);
  if (tipo === 'VP8 ') {
    b.set([0x9d, 0x01, 0x2a, largura & 0xff, largura >> 8, altura & 0xff, altura >> 8], 23);
  } else if (tipo === 'VP8L') {
    const bits = (largura - 1) | ((altura - 1) << 14);
    b.set([0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff], 20);
  } else {
    const l = largura - 1;
    const a = altura - 1;
    b.set([l & 0xff, (l >> 8) & 0xff, l >> 16, a & 0xff, (a >> 8) & 0xff, a >> 16], 24);
  }
  return b;
}

describe('tamanho da imagem', () => {
  it('um print 1440p vai intacto, um 4K vira 2560×1440 e um ultrawide não vira uma faixa estreita', () => {
    expect(tamanhoFinal(2560, 1440)).toEqual({ largura: 2560, altura: 1440 });
    expect(tamanhoFinal(3840, 2160)).toEqual({ largura: 2560, altura: 1440 });
    const ultrawide = tamanhoFinal(3440, 1440);
    expect(ultrawide.largura).toBeGreaterThan(2900);
    expect(ultrawide.largura * ultrawide.altura).toBeLessThanOrEqual(AREA_MAXIMA);
    expect(tamanhoFinal(800, 600)).toEqual({ largura: 800, altura: 600 }); // a pequena não estica
    expect(tamanhoFinal(20000, 10)).toEqual({ largura: 3840, altura: 1 }); // lado máximo
  });

  it('todo tamanho que sai da regra é aceito por quem recebe, e o que passa dela não', () => {
    for (const [l, a] of [[2560, 1440], [3440, 1440], [5120, 2880], [1080, 2400], [7680, 4320], [20000, 10]]) {
      const final = tamanhoFinal(l, a);
      expect(tamanhoAceito(final.largura, final.altura)).toBe(true);
    }
    expect(tamanhoAceito(2561, 1440)).toBe(false);
    expect(tamanhoAceito(16000, 16000)).toBe(false);
    expect(tamanhoAceito(0, 10)).toBe(false);
  });

  it('o tamanho é lido do cabeçalho do WebP, nos três formatos', () => {
    expect(tamanhoDoWebp(webp('VP8 ', 2560, 1440))).toEqual({ largura: 2560, altura: 1440 });
    expect(tamanhoDoWebp(webp('VP8L', 2970, 1243))).toEqual({ largura: 2970, altura: 1243 });
    expect(tamanhoDoWebp(webp('VP8X', 3840, 960))).toEqual({ largura: 3840, altura: 960 });
    expect(tamanhoDoWebp(new TextEncoder().encode('\x89PNG nada de webp aqui, só texto qualquer'))).toBeNull();
  });
});

describe('o que chega pelo canal de imagens', () => {
  const inicio = (bytes: number, largura = 2560, altura = 1440, id = 'a1'): Controle => ({ t: 'inicio', id, largura, altura, bytes, miniatura: 'UklGR' });

  function mandar(r: Recepcao, arquivo: Uint8Array, anunciado = arquivo.length, tamanho = { largura: 2560, altura: 1440 }) {
    const eventos = r.controle(inicio(anunciado, tamanho.largura, tamanho.altura), 0);
    for (const parte of pedacos(arquivo, 16)) {
      const e = r.pedaco(parte.slice().buffer);
      if (e) eventos.push(e);
    }
    return [...eventos, ...r.controle({ t: 'fim', id: 'a1' }, 0)];
  }

  it('a imagem anunciada chega inteira, com o progresso no caminho', () => {
    const arquivo = webp('VP8 ', 2560, 1440, 100);
    const eventos = mandar(new Recepcao(), arquivo);
    expect(eventos[0]).toMatchObject({ tipo: 'comecou', largura: 2560, altura: 1440 });
    expect(eventos.filter((e) => e.tipo === 'progresso').length).toBe(7);
    expect(eventos.at(-1)).toEqual({ tipo: 'chegou', id: 'a1', bytes: arquivo });
  });

  it('recusa o que não bate: tamanho fora da regra, arquivo grande demais, pedaços a mais ou a menos, outro conteúdo', () => {
    expect(new Recepcao().controle(inicio(1000, 16000, 16000), 0)).toEqual([{ tipo: 'falhou', id: 'a1', motivo: 'tamanho fora da regra', responder: true }]);
    expect(new Recepcao().controle(inicio(MAXIMO_RECEBIDO + 1), 0)[0]).toMatchObject({ tipo: 'falhou', motivo: 'arquivo grande demais' });

    const arquivo = webp('VP8 ', 2560, 1440, 100);
    expect(mandar(new Recepcao(), arquivo, 90).at(-1)).toMatchObject({ tipo: 'falhou', motivo: 'maior que o anunciado' });
    expect(mandar(new Recepcao(), arquivo.subarray(0, 80), 100).at(-1)).toMatchObject({ tipo: 'falhou', motivo: 'chegou incompleta' });
    // O cabeçalho diz um tamanho e o anúncio outro (o que travaria quem recebe ao decodificar).
    const mentira = webp('VP8X', 16000, 16000, 100);
    expect(mandar(new Recepcao(), mentira).at(-1)).toMatchObject({ tipo: 'falhou', motivo: 'não é a imagem anunciada' });
  });

  it('a imagem parada no meio vence no prazo, e quem manda demais é freado', () => {
    const r = new Recepcao();
    r.controle(inicio(100), 0);
    expect(r.vencer(PRAZO_PARA_CHEGAR - 1)).toBeNull();
    expect(r.vencer(PRAZO_PARA_CHEGAR)).toMatchObject({ tipo: 'falhou', motivo: 'demorou demais' });

    const muitas = new Recepcao();
    for (let i = 0; i < IMAGENS_RECEBIDAS_POR_MINUTO; i++) muitas.controle(inicio(100, 2560, 1440, `x${i}`), i);
    expect(muitas.controle(inicio(100, 2560, 1440, 'demais'), 100).at(-1)).toMatchObject({ tipo: 'falhou', motivo: 'imagens demais' });
  });

  it('mensagens estranhas no canal são ignoradas', () => {
    expect(lerControle('não é json')).toBeNull();
    expect(lerControle('{"t":"apagar-tudo","id":"a"}')).toBeNull();
    expect(lerControle('{"t":"fim"}')).toBeNull();
    expect(lerControle('{"t":"fim","id":"a"}')).toEqual({ t: 'fim', id: 'a' });
  });
});
