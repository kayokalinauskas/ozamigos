import { afterEach, describe, expect, it, vi } from 'vitest';
import { lembrado, lembradoNumero, lembrar } from './armazenamento';
import { QUALIDADES, QUALIDADE_PADRAO, ehQualidade } from './qualidade';

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
    expect(ehQualidade(QUALIDADE_PADRAO)).toBe(true);
    expect(ehQualidade('maxima')).toBe(true);
    expect(ehQualidade('4k')).toBe(false);
    expect(ehQualidade('toString')).toBe(false); // herdado do objeto, não é opção
  });

  it('nenhuma opção passa de 1080p, 60 fps ou 8 Mbps', () => {
    for (const opcao of Object.values(QUALIDADES)) {
      expect(opcao.altura).toBeLessThanOrEqual(1080);
      expect(opcao.fps).toBeLessThanOrEqual(60);
      expect(opcao.bitrate).toBeLessThanOrEqual(8_000_000);
    }
  });
});
