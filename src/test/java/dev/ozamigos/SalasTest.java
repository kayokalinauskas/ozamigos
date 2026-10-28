package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.adapter.standard.StandardWebSocketSession;

class SalasTest {

    private final Salas salas = new Salas();

    @Test
    void nonaPessoaNaoEntra() {
        for (String id : new String[] {"a", "b", "c", "d", "e", "f", "g", "h"}) {
            assertThat(salas.entrar("sala123", id, id, null, "", null)).isNotNull();
        }

        assertThat(salas.entrar("sala123", "i", "Iara", null, "", null)).isNull();
    }

    @Test
    void quemChegaDepoisSabeQuemTransmiteEQuemAssiste() {
        salas.entrar("sala123", "a", "Ana", null, "", null);
        salas.entrar("sala123", "b", "Beto", null, "", null);
        salas.comecarACompartilhar("sala123", "a");
        salas.comecarACompartilhar("sala123", "b");
        salas.assistir("sala123", "b", "a");

        Salas.Entrada entrada = salas.entrar("sala123", "c", "Caio", null, "", null);

        assertThat(entrada.outros()).containsEntry("a", new Salas.Pessoa("Ana", null)).containsEntry("b", new Salas.Pessoa("Beto", null));
        assertThat(entrada.compartilhando()).containsExactly("a", "b");
        assertThat(entrada.plateias()).containsEntry("a", List.of("b")).containsEntry("b", List.of());
    }

    @Test
    void oEntrouVaiSoParaQuemJaEstavaQuandoAPessoaEntrou() {
        WebSocketSession ana = new StandardWebSocketSession(null, null, null, null);
        WebSocketSession beto = new StandardWebSocketSession(null, null, null, null);

        // Os dois voltando juntos (depois de um deploy): a Ana entra, e o Beto entra antes de ela ser anunciada.
        Salas.Entrada daAna = salas.entrar("sala123", "a", "Ana", null, "", ana);
        Salas.Entrada doBeto = salas.entrar("sala123", "b", "Beto", null, "", beto);

        // O Beto recebe a Ana na lista do "bem-vindo"; avisá-lo também com o "entrou" da Ana a punha duas vezes na tela dele.
        assertThat(doBeto.outros()).containsOnlyKeys("a");
        assertThat(daAna.avisar()).isEmpty();
        assertThat(doBeto.avisar()).containsExactly(ana);
    }

    @Test
    void soAssisteQuemEstaTransmitindoEQuemSaiDeixaAPlateia() {
        salas.entrar("sala123", "a", "Ana", null, "", null);
        salas.entrar("sala123", "b", "Beto", null, "", null);

        assertThat(salas.assistir("sala123", "b", "a")).isNull(); // Ana ainda não transmite
        salas.comecarACompartilhar("sala123", "a");
        assertThat(salas.assistir("sala123", "b", "a")).containsExactly("b");
        assertThat(salas.assistir("sala123", "a", "a")).isNull(); // ninguém assiste a si mesmo

        Salas.Saida saida = salas.sair("sala123", "b");

        assertThat(saida.plateiasQueMudaram()).containsEntry("a", List.of());
    }

    @Test
    void umaGravacaoPorVezEElaAcabaQuandoQuemGravaSai() {
        salas.entrar("sala123", "a", "Ana", null, "", null);
        salas.entrar("sala123", "b", "Beto", null, "", null);

        assertThat(salas.comecarAGravar("sala123", "a")).isTrue();
        assertThat(salas.comecarAGravar("sala123", "b")).isFalse(); // a Ana já grava
        assertThat(salas.pararDeGravar("sala123", "b")).isFalse(); // só quem grava para
        assertThat(salas.entrar("sala123", "c", "Caio", null, "", null).gravador()).isEqualTo("a");

        assertThat(salas.sair("sala123", "a").gravacaoAcabou()).isTrue();
        assertThat(salas.gravador("sala123")).isNull();
    }

    @Test
    void quemVoltaComAFichaEhReconhecido() {
        salas.entrar("sala123", "a", "Ana", null, "ficha-da-ana", null);
        salas.entrar("sala123", "b", "Beto", null, "ficha-do-beto", null);

        assertThat(salas.donoDaFicha("sala123", "ficha-da-ana")).isEqualTo("a");
        assertThat(salas.donoDaFicha("sala123", "ficha-errada")).isNull();
        assertThat(salas.donoDaFicha("sala123", "")).isNull();

        salas.sair("sala123", "a");
        assertThat(salas.donoDaFicha("sala123", "ficha-da-ana")).isNull();
    }
}
