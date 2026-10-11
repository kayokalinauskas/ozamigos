package dev.ozamigos;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * A senha que o grupo de amigos usa para entrar nas salas.
 * Ela vem da configuração (variável de ambiente OZAMIGOS_SENHA), nunca do código.
 */
@Component
public class SenhaDoGrupo {

    private final byte[] senha;

    public SenhaDoGrupo(@Value("${ozamigos.senha}") String senha) {
        if (senha == null || senha.isBlank()) {
            throw new IllegalStateException("Defina a senha do grupo na variável de ambiente OZAMIGOS_SENHA.");
        }
        this.senha = senha.getBytes(StandardCharsets.UTF_8);
    }

    public boolean confere(String tentativa) {
        if (tentativa == null) {
            return false;
        }
        // MessageDigest.isEqual leva o mesmo tempo seja qual for o primeiro caractere errado.
        return MessageDigest.isEqual(senha, tentativa.getBytes(StandardCharsets.UTF_8));
    }
}
