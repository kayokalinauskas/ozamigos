package dev.ozamigos;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;

import org.springframework.stereotype.Component;

/**
 * Freio contra quem tenta adivinhar a senha do grupo: cada senha errada derruba a conexão, mas abrir outra é
 * de graça. Depois de {@value #LIMITE} erros do mesmo endereço em {@code JANELA}, esse endereço espera.
 *
 * <p>O endereço vem do X-Forwarded-For quando há proxy na frente (Render): quem forja o cabeçalho escapa do
 * freio, mas o ataque automático simples, que é o comum, para aqui.
 */
@Component
public class TentativasDeSenha {

    static final int LIMITE = 10;
    static final Duration JANELA = Duration.ofMinutes(5);
    /** Acima disso, os endereços que já não erram há uma janela inteira saem da memória. */
    private static final int ENDERECOS_ANTES_DE_LIMPAR = 10_000;

    private final Map<String, Deque<Instant>> erros = new HashMap<>();
    private final Clock relogio;

    public TentativasDeSenha() {
        this(Clock.systemUTC());
    }

    TentativasDeSenha(Clock relogio) {
        this.relogio = relogio;
    }

    /** Este endereço já errou demais e precisa esperar? */
    public synchronized boolean bloqueado(String endereco) {
        Deque<Instant> recentes = erros.get(endereco);
        if (recentes == null) {
            return false;
        }
        esquecerAntigos(recentes, relogio.instant());
        if (recentes.isEmpty()) {
            erros.remove(endereco);
            return false;
        }
        return recentes.size() >= LIMITE;
    }

    public synchronized void errou(String endereco) {
        Instant agora = relogio.instant();
        if (erros.size() >= ENDERECOS_ANTES_DE_LIMPAR) {
            erros.values().removeIf(recentes -> {
                esquecerAntigos(recentes, agora);
                return recentes.isEmpty();
            });
        }
        erros.computeIfAbsent(endereco, e -> new ArrayDeque<>()).addLast(agora);
    }

    private static void esquecerAntigos(Deque<Instant> recentes, Instant agora) {
        Instant limite = agora.minus(JANELA);
        while (!recentes.isEmpty() && !recentes.peekFirst().isAfter(limite)) {
            recentes.removeFirst();
        }
    }
}
