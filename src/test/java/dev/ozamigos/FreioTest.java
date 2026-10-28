package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.Test;

/** O freio dos logins, das trocas de código do app e dos convites: por chave, numa janela que anda. */
class FreioTest {

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
    void seguraAChaveQuePassouDoLimiteSemAfetarAsOutras() {
        Freio freio = new Freio(3, Duration.ofMinutes(5), new Relogio());

        for (int i = 0; i < 3; i++) {
            assertThat(freio.passa("1.2.3.4")).isTrue();
        }

        assertThat(freio.passa("1.2.3.4")).isFalse();
        assertThat(freio.passa("5.6.7.8")).isTrue();
    }

    @Test
    void oContadorDaApiSeguraOEnderecoAteOMinutoSeguinte() {
        Relogio relogio = new Relogio();
        LimitesDaApi.Contador contador = new LimitesDaApi.Contador(3, 60_000, relogio);
        for (int i = 0; i < 3; i++) {
            assertThat(contador.passa("1.2.3.4")).isTrue();
        }

        assertThat(contador.passa("1.2.3.4")).isFalse();
        assertThat(contador.passa("5.6.7.8")).isTrue();
        relogio.agora = relogio.agora.plusSeconds(60);
        assertThat(contador.passa("1.2.3.4")).isTrue();
    }

    @Test
    void liberaDepoisDaJanela() {
        Relogio relogio = new Relogio();
        Freio freio = new Freio(3, Duration.ofMinutes(5), relogio);
        for (int i = 0; i < 3; i++) {
            freio.passa("1.2.3.4");
        }

        relogio.agora = relogio.agora.plus(Duration.ofMinutes(5)).plusSeconds(1);

        assertThat(freio.passa("1.2.3.4")).isTrue();
    }
}
