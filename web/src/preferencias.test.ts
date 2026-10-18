import { afterEach, describe, expect, it, vi } from 'vitest';
import { lembrado, lembradoNumero, lembrar } from './armazenamento';
import { QUALIDADE, QUALIDADES, capturaAbaixo } from './qualidade';
import { escolherQualidade, qualidadeEscolhida } from './escolhaDeQualidade';

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
  it('o padrão é 720p a 30 fps, e quando falta banda o WebRTC baixa o fps e a nitidez, nunca a resolução', () => {
    expect(qualidadeEscolhida()).toBe(QUALIDADE);
    expect(QUALIDADES[QUALIDADE]).toMatchObject({ altura: 720, fps: 30, preferencia: 'maintain-resolution' });
    expect(Object.values(QUALIDADES).every((q) => q.preferencia === 'maintain-resolution')).toBe(true);
  });

  it('a escolha da engrenagem fica guardada, mas sem o canal direto do app (navegador, app 1.2.18) vale o padrão', () => {
    escolherQualidade('nitida60');
    expect(localStorage.getItem('ozamigos-resolucao')).toBe('nitida60');
    expect(qualidadeEscolhida()).toBe(QUALIDADE); // aqui não há app: em 1080p a 60, a página de lá não dava conta
    escolherQualidade(QUALIDADE);
    expect(localStorage.getItem('ozamigos-resolucao')).toBeNull();
    localStorage.setItem('ozamigos-resolucao', 'qualquer'); // de uma versão que não existe mais: vale o padrão
    expect(qualidadeEscolhida()).toBe(QUALIDADE);
  });
});

describe('capturaAbaixo', () => {
  it('avisa quando a captura fica abaixo do fps da qualidade', () => {
    expect(capturaAbaixo([21.4], QUALIDADE)).toBe(21); // o caso medido com o Path of Exile
    expect(capturaAbaixo([29], QUALIDADE)).toBeNull(); // oscilação normal não avisa
    expect(capturaAbaixo([null], QUALIDADE)).toBeNull(); // sem ninguém assistindo, não há medição
    expect(capturaAbaixo([], QUALIDADE)).toBeNull();
  });
});
