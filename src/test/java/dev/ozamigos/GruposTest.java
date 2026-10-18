package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.Test;

class GruposTest {

    /** Um relógio que o teste adianta. */
    private static final class Relogio extends Clock {
        Instant agora = Instant.parse("2026-10-18T12:00:00Z");

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

    private final Relogio relogio = new Relogio();
    private final Grupos grupos = new Grupos(relogio);

    @Test
    void quemCriaEntraEOsOutrosSoComASenhaCerta() {
        assertThat(grupos.entrar("amigos", "segredo", false, "1.1.1.1")).isEqualTo(Grupos.Resultado.NAO_EXISTE);
        assertThat(grupos.entrar("amigos", "segredo", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.CRIADO);

        assertThat(grupos.entrar("amigos", "segredo", false, "2.2.2.2")).isEqualTo(Grupos.Resultado.ENTRA);
        assertThat(grupos.entrar("amigos", "chute", false, "2.2.2.2")).isEqualTo(Grupos.Resultado.SENHA_ERRADA);
        // Criar com o nome de um grupo que existe: com a senha dele, entra (amigos recriando juntos); com outra, não.
        assertThat(grupos.entrar("amigos", "segredo", true, "3.3.3.3")).isEqualTo(Grupos.Resultado.ENTRA);
        assertThat(grupos.entrar("amigos", "outra", true, "3.3.3.3")).isEqualTo(Grupos.Resultado.EM_USO);
    }

    @Test
    void nomesReservadosOuForaDaRegraESenhasCurtasNaoCriam() {
        assertThat(grupos.entrar("ozamigos", "segredo", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.NOME_INVALIDO);
        assertThat(grupos.entrar("sinal", "segredo", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.NOME_INVALIDO);
        assertThat(grupos.entrar("Amigos", "segredo", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.NOME_INVALIDO);
        assertThat(grupos.entrar("-amigos", "segredo", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.NOME_INVALIDO);
        assertThat(grupos.entrar("ab", "segredo", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.NOME_INVALIDO);
        assertThat(grupos.entrar("amigos", "abc", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.SENHA_CURTA);
        assertThat(grupos.quantos()).isZero();
    }

    @Test
    void oGrupoSomeTrintaMinutosDepoisDeFicarVazioENaoEnquantoTemGente() {
        grupos.entrar("amigos", "segredo", true, "1.1.1.1");
        grupos.ocupado("amigos");
        relogio.agora = relogio.agora.plus(Duration.ofHours(5));
        assertThat(grupos.entrar("amigos", "segredo", false, "2.2.2.2")).isEqualTo(Grupos.Resultado.ENTRA);

        grupos.vazio("amigos");
        relogio.agora = relogio.agora.plus(Grupos.VAZIO_POR).minusSeconds(1);
        assertThat(grupos.quantos()).isEqualTo(1);
        relogio.agora = relogio.agora.plusSeconds(1);
        assertThat(grupos.entrar("amigos", "segredo", false, "2.2.2.2")).isEqualTo(Grupos.Resultado.NAO_EXISTE);
        // Esquecido, o nome fica livre: até com outra senha.
        assertThat(grupos.entrar("amigos", "outra", true, "2.2.2.2")).isEqualTo(Grupos.Resultado.CRIADO);
    }

    @Test
    void cadaEnderecoCriaPoucosGruposPorVez() {
        for (int i = 0; i < Grupos.CRIACOES_POR_ENDERECO; i++) {
            assertThat(grupos.entrar("grupo" + i, "segredo", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.CRIADO);
        }
        assertThat(grupos.entrar("mais-um", "segredo", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.CRIOU_DEMAIS);
        assertThat(grupos.entrar("mais-um", "segredo", true, "2.2.2.2")).isEqualTo(Grupos.Resultado.CRIADO);

        relogio.agora = relogio.agora.plus(Grupos.JANELA_DE_CRIACAO);
        assertThat(grupos.entrar("e-mais-um", "segredo", true, "1.1.1.1")).isEqualTo(Grupos.Resultado.CRIADO);
    }
}
