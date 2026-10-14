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
  const folgado: EnvioMedido = { id: 'a', limite: 'none', banda: 8 };
  const semPc: EnvioMedido = { id: 'a', limite: 'cpu', banda: 8 };
  /** Mede `segundos` vezes, um por segundo a partir de `inicio` (s), e devolve as trocas pedidas. */
  function medir(auto: QualidadeAutomatica, inicio: number, segundos: number, envio: EnvioMedido) {
    const trocas = [];
    for (let t = inicio; t < inicio + segundos; t++) {
      const decisao = auto.medir(t * 1000, 'nitida', [envio]);
      if (decisao) trocas.push({ t, ...decisao });
    }
    return trocas;
  }

  it('quem escolheu 1080p desce para 720p só com o aperto durando, e nunca nos primeiros segundos de quem assiste', () => {
    const auto = new QualidadeAutomatica();
    expect(medir(auto, 0, AUTOMATICA.maduraDepois, semPc)).toEqual([]); // conexão nova: o bitrate ainda está subindo
    const curto = new QualidadeAutomatica();
    medir(curto, 0, 20, folgado);
    expect(medir(curto, 20, AUTOMATICA.apertados - 1, semPc)).toEqual([]); // um aperto curto não derruba
    expect(medir(curto, 25, 10, folgado)).toEqual([]);
    expect(medir(auto, AUTOMATICA.maduraDepois, 10, semPc)).toEqual([{ t: 15, acao: 'descer', qualidade: 'leve', motivo: 'pc' }]);
    expect(new QualidadeAutomatica().medir(0, 'leve', [semPc])).toBeNull(); // 720p não desce: lá, o WebRTC baixa a imagem
  });

  it('volta para 1080p depois de folgar e da espera, que dobra a cada descida', () => {
    const auto = new QualidadeAutomatica();
    medir(auto, 0, 16, semPc); // desce em t = 15
    const pelaBanda = { ...folgado, banda: 2 }; // a 720p, sem banda para 1080p: não volta
    expect(medir(auto, 16, 300, pelaBanda)).toEqual([]);
    const volta = medir(auto, 316, 60, folgado);
    expect(volta).toEqual([{ t: 316 + AUTOMATICA.calmaParaSubir - 1, acao: 'subir', qualidade: 'nitida' }]);
    // Desce de novo: agora espera o dobro antes de tentar.
    const t0 = volta[0].t + 1;
    const segunda = medir(auto, t0, 30, semPc);
    expect(segunda[0].acao).toBe('descer');
    const t1 = segunda[0].t;
    const subida = medir(auto, t1 + 1, 2 * AUTOMATICA.esperaInicial + 60, folgado);
    expect(subida[0].t - t1).toBeGreaterThanOrEqual(2 * AUTOMATICA.esperaInicial);
  });
});
