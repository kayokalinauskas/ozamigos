package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SalasTest {

    private final Salas salas = new Salas();

    @Test
    void quartaPessoaNaoEntra() {
        assertThat(salas.entrar("sala123", "a", "Ana", null)).isNotNull();
        assertThat(salas.entrar("sala123", "b", "Beto", null)).isNotNull();
        assertThat(salas.entrar("sala123", "c", "Caio", null)).isNotNull();

        assertThat(salas.entrar("sala123", "d", "Duda", null)).isNull();
    }

    @Test
    void quemChegaDepoisSabeQuemEstaCompartilhando() {
        salas.entrar("sala123", "a", "Ana", null);
        salas.entrar("sala123", "b", "Beto", null);
        salas.comecarACompartilhar("sala123", "a");
        salas.comecarACompartilhar("sala123", "b");

        Salas.Entrada entrada = salas.entrar("sala123", "c", "Caio", null);

        assertThat(entrada.outros()).containsEntry("a", "Ana").containsEntry("b", "Beto");
        assertThat(entrada.compartilhando()).containsExactly("a", "b");
    }
}
