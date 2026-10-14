import { describe, expect, it } from 'vitest';
import { codigoDe, codigoValido, linkDaSala, novoCodigo } from './conexao/codigoDaSala';

describe('código da sala', () => {
  it('aceita de 6 a 20 letras e números, e nada além disso', () => {
    expect(codigoValido('abc123')).toBe(true);
    expect(codigoValido('a'.repeat(20))).toBe(true);
    expect(codigoValido('abc12')).toBe(false); // curto demais
    expect(codigoValido('a'.repeat(21))).toBe(false); // longo demais
    expect(codigoValido('abc-123')).toBe(false); // símbolo
    expect(codigoValido('<script>')).toBe(false);
  });

  it('gera códigos novos válidos, sem letras que se confundem', () => {
    const codigos = Array.from({ length: 200 }, novoCodigo);
    for (const codigo of codigos) {
      expect(codigoValido(codigo)).toBe(true);
      expect(codigo).not.toMatch(/[0O1lI]/);
    }
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('tira o código de um link colado ou usa o texto como código', () => {
    expect(codigoDe('https://ozamigos.onrender.com/?sala=Ab3dEf9')).toBe('Ab3dEf9');
    expect(codigoDe('  Ab3dEf9  ')).toBe('Ab3dEf9');
    expect(codigoDe('https://ozamigos.onrender.com/')).toBe('https://ozamigos.onrender.com/'); // link sem sala: inválido depois
  });

  it('monta o link da sala no endereço atual, e o link volta ao mesmo código', () => {
    const link = linkDaSala('Ab3dEf9');
    expect(link).toBe(`${location.origin}${location.pathname}?sala=Ab3dEf9`);
    expect(codigoDe(link)).toBe('Ab3dEf9');
  });
});
