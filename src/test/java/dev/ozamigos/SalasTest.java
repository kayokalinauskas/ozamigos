package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

class SalasTest {

    private final Salas salas = new Salas();

    @Test
    void nonaPessoaNaoEntra() {
        for (String id : new String[] {"a", "b", "c", "d", "e", "f", "g", "h"}) {
            assertThat(salas.entrar("sala123", id, id, "", null)).isNotNull();
        }

        assertThat(salas.entrar("sala123", "i", "Iara", "", null)).isNull();
    }

    @Test
    void quemChegaDepoisSabeQuemTransmiteEQuemAssiste() {
        salas.entrar("sala123", "a", "Ana", "", null);
        salas.entrar("sala123", "b", "Beto", "", null);
        salas.comecarACompartilhar("sala123", "a");
        salas.comecarACompartilhar("sala123", "b");
        salas.assistir("sala123", "b", "a");

        Salas.Entrada entrada = salas.entrar("sala123", "c", "Caio", "", null);

        assertThat(entrada.outros()).containsEntry("a", "Ana").containsEntry("b", "Beto");
        assertThat(entrada.compartilhando()).containsExactly("a", "b");
        assertThat(entrada.plateias()).containsEntry("a", List.of("b")).containsEntry("b", List.of());
    }

    @Test
    void soAssisteQuemEstaTransmitindoEQuemSaiDeixaAPlateia() {
        salas.entrar("sala123", "a", "Ana", "", null);
        salas.entrar("sala123", "b", "Beto", "", null);

        assertThat(salas.assistir("sala123", "b", "a")).isNull(); // Ana ainda não transmite
        salas.comecarACompartilhar("sala123", "a");
        assertThat(salas.assistir("sala123", "b", "a")).containsExactly("b");
        assertThat(salas.assistir("sala123", "a", "a")).isNull(); // ninguém assiste a si mesmo

        Salas.Saida saida = salas.sair("sala123", "b");

        assertThat(saida.plateiasQueMudaram()).containsEntry("a", List.of());
    }

    @Test
    void quemVoltaComAFichaEhReconhecido() {
        salas.entrar("sala123", "a", "Ana", "ficha-da-ana", null);
        salas.entrar("sala123", "b", "Beto", "ficha-do-beto", null);

        assertThat(salas.donoDaFicha("sala123", "ficha-da-ana")).isEqualTo("a");
        assertThat(salas.donoDaFicha("sala123", "ficha-errada")).isNull();
        assertThat(salas.donoDaFicha("sala123", "")).isNull();

        salas.sair("sala123", "a");
        assertThat(salas.donoDaFicha("sala123", "ficha-da-ana")).isNull();
    }
}
