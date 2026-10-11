package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class SenhaDoGrupoTest {

    private final SenhaDoGrupo senha = new SenhaDoGrupo("pastel de feira");

    @Test
    void aceitaSoASenhaCerta() {
        assertThat(senha.confere("pastel de feira")).isTrue();
        assertThat(senha.confere("Pastel de feira")).isFalse();
        assertThat(senha.confere("")).isFalse();
        assertThat(senha.confere(null)).isFalse();
    }

    @Test
    void naoSobeSemSenhaConfigurada() {
        assertThatThrownBy(() -> new SenhaDoGrupo(" "))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("OZAMIGOS_SENHA");
    }
}
