import { describe, expect, it } from 'vitest';
import { conviteDoCaminho, linkDoConvite, servidorDoCaminho } from './conexao/codigoDaSala';

describe('endereços dos servidores salvos', () => {
  it('/s/<codigo> é um servidor e /c/<codigo> um convite, e nada mais vira um dos dois', () => {
    expect(servidorDoCaminho('/s/AbCdEfGh23')).toBe('AbCdEfGh23');
    expect(servidorDoCaminho('/s/AbCdEfGh23/')).toBe('AbCdEfGh23');
    expect(conviteDoCaminho('/c/AbCdEfGh23')).toBe('AbCdEfGh23');
    expect(servidorDoCaminho('/c/AbCdEfGh23')).toBeNull();
    expect(servidorDoCaminho('/s/curto')).toBeNull();
    expect(servidorDoCaminho('/s/AbCdEfGh2<')).toBeNull();
    expect(servidorDoCaminho('/ozamigos')).toBeNull(); // o grupo fixo saiu (28/10/2026)
    expect(conviteDoCaminho('/')).toBeNull();
  });

  it('o link do convite volta ao mesmo convite', () => {
    const link = new URL(linkDoConvite('AbCdEfGh23'));
    expect(link.origin).toBe(location.origin);
    expect(conviteDoCaminho(link.pathname)).toBe('AbCdEfGh23');
  });
});
