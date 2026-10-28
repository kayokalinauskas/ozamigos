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
        LimitesDaApi.Contador contador = new LimitesDaApi.Contador(3, 60_000, 100, relogio);
        for (int i = 0; i < 3; i++) {
            assertThat(contador.passa("1.2.3.4")).isTrue();
        }

        assertThat(contador.passa("1.2.3.4")).isFalse();
        assertThat(contador.passa("5.6.7.8")).isTrue();
        relogio.agora = relogio.agora.plusSeconds(60);
        assertThat(contador.passa("1.2.3.4")).isTrue();
    }

    @Test
    void comOContadorCheioOsEnderecosNovosDividemUmaContagemSo() {
        LimitesDaApi.Contador contador = new LimitesDaApi.Contador(2, 60_000, 1, new Relogio());
        assertThat(contador.passa("1.2.3.4")).isTrue();

        // Cheio (uma enxurrada de endereços): os novos não passam sem contar, e não ocupam mais memória.
        assertThat(contador.passa("5.6.7.8")).isTrue();
        assertThat(contador.passa("9.9.9.9")).isTrue();
        assertThat(contador.passa("8.8.8.8")).isFalse();
        assertThat(contador.passa("1.2.3.4")).isTrue(); // quem já tinha lugar continua com o seu
    }

    @Test
    void oContadorCheioLimpaAsJanelasQuePassaram() {
        Relogio relogio = new Relogio();
        LimitesDaApi.Contador contador = new LimitesDaApi.Contador(1, 60_000, 1, relogio);
        assertThat(contador.passa("1.2.3.4")).isTrue();
        assertThat(contador.passa("5.6.7.8")).isTrue(); // cheio: a contagem dividida

        relogio.agora = relogio.agora.plusSeconds(61);
        // A limpeza tira as janelas vencidas: o endereço novo ganha a sua contagem...
        assertThat(contador.passa("9.9.9.9")).isTrue();
        // ...e a dividida, que também venceu, começa do zero (sem a limpeza, o 9.9.9.9 teria gastado a vez dela).
        assertThat(contador.passa("8.8.8.8")).isTrue();
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
