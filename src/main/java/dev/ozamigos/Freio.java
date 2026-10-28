package dev.ozamigos;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;

/**
 * Até {@code limite} vezes por chave (um endereço, uma conta) a cada {@code janela}, contando só o que passou. A mesma
 * regra do TentativasDeSenha, para as ações das contas (começar um login, resgatar um código do app).
 */
final class Freio {

    /** Acima disso, as chaves que não aparecem há uma janela inteira saem da memória. */
    private static final int CHAVES_ANTES_DE_LIMPAR = 10_000;

    private final int limite;
    private final Duration janela;
    private final Clock relogio;
    private final Map<String, Deque<Instant>> vezes = new HashMap<>();

    Freio(int limite, Duration janela) {
        this(limite, janela, Clock.systemUTC());
    }

    Freio(int limite, Duration janela, Clock relogio) {
        this.limite = limite;
        this.janela = janela;
        this.relogio = relogio;
    }

    /** Conta mais uma vez, se ainda cabe. False: passou do limite, e esta não conta. */
    synchronized boolean passa(String chave) {
        Instant agora = relogio.instant();
        if (vezes.size() >= CHAVES_ANTES_DE_LIMPAR) {
            vezes.values().removeIf(recentes -> {
                esquecerAntigas(recentes, agora);
                return recentes.isEmpty();
            });
        }
        Deque<Instant> recentes = vezes.computeIfAbsent(chave, c -> new ArrayDeque<>());
        esquecerAntigas(recentes, agora);
        if (recentes.size() >= limite) {
            return false;
        }
        recentes.addLast(agora);
        return true;
    }

    private void esquecerAntigas(Deque<Instant> recentes, Instant agora) {
        Instant corte = agora.minus(janela);
        while (!recentes.isEmpty() && !recentes.peekFirst().isAfter(corte)) {
            recentes.removeFirst();
        }
    }
}
