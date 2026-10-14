package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.Test;

class TentativasDeSenhaTest {

    /** Um relógio que o teste adianta. */
    private static final class Relogio extends Clock {
        Instant agora = Instant.parse("2026-10-14T12:00:00Z");

        @Override
        public Instant instant() {
            return agora;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zona) {
            return this;
        }
    }

    @Test
    void bloqueiaOEnderecoQueErraDemaisSemAfetarOsOutros() {
        TentativasDeSenha tentativas = new TentativasDeSenha(new Relogio());

        for (int i = 0; i < TentativasDeSenha.LIMITE - 1; i++) {
            tentativas.errou("1.2.3.4");
        }
        assertThat(tentativas.bloqueado("1.2.3.4")).isFalse();
        tentativas.errou("1.2.3.4");

        assertThat(tentativas.bloqueado("1.2.3.4")).isTrue();
        assertThat(tentativas.bloqueado("5.6.7.8")).isFalse();
    }

    @Test
    void liberaDepoisDaJanela() {
        Relogio relogio = new Relogio();
        TentativasDeSenha tentativas = new TentativasDeSenha(relogio);
        for (int i = 0; i < TentativasDeSenha.LIMITE; i++) {
            tentativas.errou("1.2.3.4");
        }

        relogio.agora = relogio.agora.plus(TentativasDeSenha.JANELA).plusSeconds(1);

        assertThat(tentativas.bloqueado("1.2.3.4")).isFalse();
    }
}
