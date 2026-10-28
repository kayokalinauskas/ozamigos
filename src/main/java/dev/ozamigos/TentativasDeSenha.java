package dev.ozamigos;

import java.time.Clock;
import java.time.Duration;

import org.springframework.stereotype.Component;

/**
 * Freio contra quem tenta adivinhar a senha do grupo: cada senha errada derruba a conexão, mas abrir outra é
 * de graça. Depois de {@value #LIMITE} erros do mesmo endereço em {@code JANELA}, esse endereço espera.
 *
 * <p>O endereço é o que a Cloudflare (na frente do Render) põe no CF-Connecting-IP, que o visitante não consegue
 * forjar; veja {@code Enderecos}. Até 14/10/2026 vinha do X-Forwarded-For, e quem o forjava escapava do freio.
 */
@Component
public class TentativasDeSenha {

    static final int LIMITE = 10;
    static final Duration JANELA = Duration.ofMinutes(5);

    private final Freio erros;

    public TentativasDeSenha() {
        this(Clock.systemUTC());
    }

    TentativasDeSenha(Clock relogio) {
        this.erros = new Freio(LIMITE, JANELA, relogio);
    }

    /** Este endereço já errou demais e precisa esperar? */
    public boolean bloqueado(String endereco) {
        return erros.excedeu(endereco);
    }

    public void errou(String endereco) {
        erros.contar(endereco);
    }
}
