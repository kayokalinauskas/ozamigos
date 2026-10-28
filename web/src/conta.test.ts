import { afterEach, describe, expect, it, vi } from 'vitest';
import { carregarConta, lerConta } from './conta';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a conta ao abrir', () => {
  it('com o servidor acordando (banco ainda não pronto), espera e pergunta de novo sozinha', async () => {
    vi.useFakeTimers();
    const respostas = [
      { login: [], conta: null, indisponivel: true },
      { login: ['google', 'discord'], conta: null, indisponivel: false },
    ];
    const pedidos = vi.fn(async () => new Response(JSON.stringify(respostas.shift())));
    vi.stubGlobal('fetch', pedidos);

    await carregarConta();
    expect(lerConta().carregada).toBe(false); // "Carregando…", e não o aviso de indisponível

    await vi.advanceTimersByTimeAsync(3_000);
    expect(pedidos).toHaveBeenCalledTimes(2);
    expect(lerConta()).toMatchObject({ carregada: true, login: ['google', 'discord'] });
  });
});
