package dev.ozamigos;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * A senha que o grupo de amigos usa para entrar nas salas.
 * Ela vem da configuração (variável de ambiente OZAMIGOS_SENHA), nunca do código.
 */
@Component
public class SenhaDoGrupo {

    private final byte[] resumo;

    public SenhaDoGrupo(@Value("${ozamigos.senha}") String senha) {
        if (senha == null || senha.isBlank()) {
            throw new IllegalStateException("Defina a senha do grupo na variável de ambiente OZAMIGOS_SENHA.");
        }
        this.resumo = resumo(senha);
    }

    public boolean confere(String tentativa) {
        if (tentativa == null) {
            return false;
        }
        // Compara os resumos (SHA-256), que têm sempre 32 bytes: o MessageDigest.isEqual só leva o mesmo tempo
        // com entradas do mesmo tamanho, e comparar as senhas direto deixava o tempo da resposta contar o
        // tamanho da senha certa.
        return MessageDigest.isEqual(resumo, resumo(tentativa));
    }

    private static byte[] resumo(String texto) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(texto.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("Java sem SHA-256", e); // toda JVM tem SHA-256
        }
    }
}
