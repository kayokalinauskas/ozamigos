import { afterEach, describe, expect, it, vi } from 'vitest';
import { lembrado, lembradoNumero, lembrar } from './armazenamento';
import { QUALIDADES, QUALIDADE_PADRAO, capturaAbaixo, ehQualidade, qualidadeGuardada } from './qualidade';
import { AUTOMATICA, QualidadeAutomatica, type EnvioMedido } from './qualidadeAutomatica';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('preferências guardadas', () => {
  it('guarda, lê e apaga (texto vazio apaga)', () => {
    lembrar('ozamigos-teste', 'Kayo');
    expect(lembrado('ozamigos-teste')).toBe('Kayo');
    lembrar('ozamigos-teste', '');
    expect(localStorage.getItem('ozamigos-teste')).toBeNull();
  });

  it('lê números e usa o padrão quando não há valor válido', () => {
    lembrar('ozamigos-volume', '0.4');
    expect(lembradoNumero('ozamigos-volume', 1)).toBe(0.4);
    lembrar('ozamigos-volume', 'abc');
    expect(lembradoNumero('ozamigos-volume', 1)).toBe(1);
  });

  it('sem armazenamento (aba anônima, bloqueio), segue sem quebrar', () => {
    const bloqueado = () => {
      throw new DOMException('bloqueado', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: bloqueado, setItem: bloqueado, removeItem: bloqueado });
    expect(() => lembrar('ozamigos-nome', 'Kayo')).not.toThrow();
    expect(lembrado('ozamigos-nome')).toBe('');
  });
});

describe('qualidade', () => {
  it('reconhece só as opções que existem, e a padrão é uma delas', () => {
    expect(QUALIDADES[QUALIDADE_PADRAO].altura).toBe(720);
    expect(ehQualidade('nitida')).toBe(true);
    expect(ehQualidade('4k')).toBe(false);
    expect(ehQualidade('toString')).toBe(false); // herdado do objeto, não é opção
  });

  it('nenhuma opção passa de 1080p, 30 fps ou 5 Mbps', () => {
    for (const opcao of Object.values(QUALIDADES)) {
      expect(opcao.altura).toBeLessThanOrEqual(1080);
      expect(opcao.fps).toBe(30);
      expect(opcao.bitrate).toBeLessThanOrEqual(5_000_000);
    }
  });

  it('troca as opções a 60 fps guardadas pela de 30 do mesmo tamanho', () => {
    expect(qualidadeGuardada('maxima')).toBe('nitida');
    expect(qualidadeGuardada('equilibrada')).toBe('leve');
    expect(qualidadeGuardada('nitida')).toBe('nitida');
    expect(qualidadeGuardada('')).toBe(QUALIDADE_PADRAO);
  });
});

describe('capturaAbaixo', () => {
  it('avisa quando a captura fica abaixo do fps da qualidade', () => {
    expect(capturaAbaixo([21.4], 'nitida')).toBe(21); // 1080p 30: o caso medido com o Path of Exile
    expect(capturaAbaixo([29], 'nitida')).toBeNull(); // oscilação normal não avisa
    expect(capturaAbaixo([20], 'leve')).toBe(20); // o notebook com a captura a ~20 fps
    expect(capturaAbaixo([null], 'nitida')).toBeNull(); // sem ninguém assistindo, não há medição
    expect(capturaAbaixo([], 'nitida')).toBeNull();
  });
});

describe('qualidade automática', () => {
  const folgado = (id = 'a'): EnvioMedido => ({ id, limite: 'none', banda: 8 });
  const semPc = (id = 'a'): EnvioMedido => ({ id, limite: 'cpu', banda: 8 });
  const semBanda = (id = 'a'): EnvioMedido => ({ id, limite: 'none', banda: 2 });
  /** Mede `segundos` vezes, um por segundo a partir de `inicio` (s), e devolve as trocas pedidas com o segundo. */
  function medir(auto: QualidadeAutomatica, inicio: number, segundos: number, envios: EnvioMedido[]) {
    const trocas = [];
    for (let t = inicio; t < inicio + segundos; t++) {
      for (const decisao of auto.medir(t * 1000, 'nitida', envios)) trocas.push({ t, ...decisao });
    }
    return trocas;
  }

  it('com o PC apertado, a captura desce para todos só com o aperto durando, e nunca nos primeiros segundos de quem assiste', () => {
    const auto = new QualidadeAutomatica();
    expect(medir(auto, 0, AUTOMATICA.carencia, [semPc()])).toEqual([]); // conexão nova: o bitrate ainda está subindo
    const curto = new QualidadeAutomatica();
    medir(curto, 0, 20, [folgado()]);
    expect(medir(curto, 20, AUTOMATICA.apertados - 1, [semPc()])).toEqual([]); // um aperto curto não derruba
    expect(medir(curto, 25, 10, [folgado()])).toEqual([]);
    expect(medir(auto, AUTOMATICA.carencia, 10, [semPc()])).toEqual([{ t: 15, acao: 'descer', id: null, motivo: 'pc' }]);
    expect(auto.reduzidaPeloPc).toBe(true);
    expect(new QualidadeAutomatica().medir(0, 'leve', [semPc()])).toEqual([]); // 720p não desce: lá, o WebRTC baixa a imagem
  });

  it('com a conexão de uma pessoa apertada, só ela recebe 720p; quem está bem continua em 1080p', () => {
    const auto = new QualidadeAutomatica();
    const trocas = medir(auto, 0, 30, [semBanda('wifi'), folgado('cabo')]);
    expect(trocas).toEqual([{ t: 15, acao: 'descer', id: 'wifi', motivo: 'rede' }]);
    expect(auto.reduzidos()).toEqual(['wifi']);
    expect(auto.reduzidaPeloPc).toBe(false);
    auto.esquecer('wifi'); // a conexão foi refeita: começa do zero
    expect(auto.reduzidos()).toEqual([]);
  });

  it('volta para 1080p depois de folgar e da espera, que dobra a cada descida', () => {
    const auto = new QualidadeAutomatica();
    medir(auto, 0, 16, [semPc()]); // desce em t = 15
    expect(medir(auto, 16, 300, [{ ...semPc() }])).toEqual([]); // ainda apertado: não volta
    const volta = medir(auto, 316, 60, [folgado()]);
    expect(volta).toEqual([{ t: 316 + AUTOMATICA.calmaParaSubir - 1, acao: 'subir', id: null, motivo: 'pc' }]);
    // Desce de novo (depois da carência da volta): agora espera o dobro antes de tentar.
    const segunda = medir(auto, volta[0].t + 1, 30, [semPc()]);
    expect(segunda[0].acao).toBe('descer');
    const subida = medir(auto, segunda[0].t + 1, 2 * AUTOMATICA.esperaInicial + 60, [folgado()]);
    expect(subida[0].t - segunda[0].t).toBeGreaterThanOrEqual(2 * AUTOMATICA.esperaInicial);
  });
});
