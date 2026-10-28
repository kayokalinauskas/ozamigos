package dev.ozamigos;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;

/**
 * O login do app (Electron) pelo navegador do sistema, como recomenda a RFC 8252 para apps nativos: o Google não deixa
 * entrar dentro de uma janela embutida. O app abre uma porta só no 127.0.0.1 e o navegador na página de login; no fim,
 * o servidor manda o navegador para essa porta com um código de uso único, e a página do app troca o código pela sessão
 * ({@code POST /api/conta/codigo}).
 *
 * <p>Ligar mais um provedor pelo app usa um código do mesmo tipo, no outro sentido ({@link Uso#LIGACAO}): a página do
 * app, logada, pede um ({@code POST /api/eu/ligacao}) e o leva no endereço do navegador, que não tem a sessão do app.
 * Cada código só vale para o seu uso: o de uma ligação não vira sessão.
 *
 * <p>O código vale {@link #VALIDADE} e uma vez só, e só existe na memória (um login no meio de um deploy é refeito).
 * Um link de login forjado por outra pessoa não leva a nada: o código vai para o 127.0.0.1 de quem fez o login, e o
 * app só o aceita com o {@code estado} que ele mesmo sorteou.
 */
@Component
public class CodigosDoApp {

    static final Duration VALIDADE = Duration.ofMinutes(2);
    /** Mais que isso esperando troca é ataque, não gente: os mais velhos saem. */
    private static final int MAXIMO = 1_000;

    public enum Uso { LOGIN, LIGACAO }

    private record Pendente(UUID usuario, Uso uso, Instant expira) {}

    private final Map<String, Pendente> pendentes = new HashMap<>();
    private final SecureRandom aleatorio = new SecureRandom();
    private final Clock relogio;

    public CodigosDoApp() {
        this(Clock.systemUTC());
    }

    CodigosDoApp(Clock relogio) {
        this.relogio = relogio;
    }

    public synchronized String criar(UUID usuario, Uso uso) {
        Instant agora = relogio.instant();
        pendentes.values().removeIf(p -> !p.expira().isAfter(agora));
        if (pendentes.size() >= MAXIMO) {
            pendentes.entrySet().stream().min(Map.Entry.comparingByValue((a, b) -> a.expira().compareTo(b.expira())))
                    .ifPresent(maisVelho -> pendentes.remove(maisVelho.getKey()));
        }
        byte[] bytes = new byte[32];
        aleatorio.nextBytes(bytes);
        String codigo = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        pendentes.put(codigo, new Pendente(usuario, uso, agora.plus(VALIDADE)));
        return codigo;
    }

    /** De quem é o código, se for deste uso; ele deixa de valer na hora, dando certo ou não. */
    public synchronized Optional<UUID> trocar(String codigo, Uso uso) {
        Pendente pendente = codigo == null ? null : pendentes.remove(codigo);
        if (pendente == null || pendente.uso() != uso || !pendente.expira().isAfter(relogio.instant())) {
            return Optional.empty();
        }
        return Optional.of(pendente.usuario());
    }
}
