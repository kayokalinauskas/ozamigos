import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lembrado, lembradoNumero, lembrar } from './armazenamento';
import { useNumeroLembrado } from './useCliente';
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

  it('o volume e o silenciado de uma transmissão voltam como ficaram, e trocar a chave não grava por cima', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let atual: readonly [number, (novo: number) => void] = [0, () => undefined];
    const Volume = ({ chave }: { chave: string }) => {
      atual = useNumeroLembrado(chave, 100);
      return null;
    };
    const raiz = createRoot(document.createElement('div'));
    lembrar('ozamigos-volume:conta:2', '35');
    await act(async () => raiz.render(createElement(Volume, { chave: 'ozamigos-volume:conta:1' })));
    expect(atual[0]).toBe(100);
    await act(async () => atual[1](0));
    // Parou e voltou a transmitir: a transmissão nasce de novo e lê o 0.
    await act(async () => raiz.render(null));
    await act(async () => raiz.render(createElement(Volume, { chave: 'ozamigos-volume:conta:1' })));
    expect(atual[0]).toBe(0);
    // A mesma transmissão com outra chave lê a dela, sem levar o 0 junto.
    await act(async () => raiz.render(createElement(Volume, { chave: 'ozamigos-volume:conta:2' })));
    expect(atual[0]).toBe(35);
    expect(lembrado('ozamigos-volume:conta:2')).toBe('35');
    expect(lembrado('ozamigos-volume:conta:1')).toBe('0');
    await act(async () => raiz.unmount());
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
