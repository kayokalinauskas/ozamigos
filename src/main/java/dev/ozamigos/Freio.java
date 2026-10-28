package dev.ozamigos;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;

/**
 * Até {@code limite} vezes por chave (um endereço, uma conta) a cada {@code janela}, contando só o que passou. É o freio
 * das ações das contas: começar um login, trocar um código do app, abrir e aceitar convites.
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
        if (excedeu(chave)) {
            return false;
        }
        contar(chave);
        return true;
    }

    /** Esta chave já chegou ao limite na janela? Não conta nada. */
    synchronized boolean excedeu(String chave) {
        Deque<Instant> recentes = vezes.get(chave);
        if (recentes == null) {
            return false;
        }
        esquecerAntigas(recentes, relogio.instant());
        if (recentes.isEmpty()) {
            vezes.remove(chave);
            return false;
        }
        return recentes.size() >= limite;
    }

    /** Conta mais uma vez, sem olhar o limite (uma senha errada conta mesmo com o endereço já bloqueado). */
    synchronized void contar(String chave) {
        Instant agora = relogio.instant();
        if (vezes.size() >= CHAVES_ANTES_DE_LIMPAR) {
            vezes.values().removeIf(recentes -> {
                esquecerAntigas(recentes, agora);
                return recentes.isEmpty();
            });
        }
        vezes.computeIfAbsent(chave, c -> new ArrayDeque<>()).addLast(agora);
    }

    private void esquecerAntigas(Deque<Instant> recentes, Instant agora) {
        Instant corte = agora.minus(janela);
        while (!recentes.isEmpty() && !recentes.peekFirst().isAfter(corte)) {
            recentes.removeFirst();
        }
    }
}
