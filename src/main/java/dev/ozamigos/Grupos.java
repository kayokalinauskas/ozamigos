package dev.ozamigos;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.security.spec.InvalidKeySpecException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

import org.springframework.stereotype.Component;

/**
 * Os grupos que qualquer pessoa cria na hora, com nome e senha próprios (o endereço é {@code /nome}). Ficam só na
 * memória, como as salas: somem quando o servidor reinicia (deploy, ou o Render dormindo) e {@code VAZIO_POR} depois
 * de ficarem sem ninguém. Quem volta com o link e a senha recria o grupo. Decisão do dono (18/10/2026): sem banco de
 * dados, e não importa que o grupo caia. O grupo fixo, o da senha OZAMIGOS_SENHA, continua em SenhaDoGrupo.
 *
 * <p>Cada grupo tem uma sala só, a de chave {@link #sala(String)}. Os códigos das salas do grupo fixo são só letras
 * e números, então as chaves nunca se confundem.
 */
@Component
public class Grupos {

    /** Letras minúsculas, números e hífen, de 3 a 32, sem hífen nas pontas: o nome vai no endereço. */
    static final Pattern NOME_VALIDO = Pattern.compile("[a-z0-9][a-z0-9-]{1,30}[a-z0-9]");
    /**
     * O grupo fixo e os caminhos que o site já usa (ou poderia usar) não podem ser nomes de grupo. Mudou um caminho do
     * servidor? Confira também o padrão do PaginaDoGrupo.
     */
    static final Set<String> RESERVADOS = Set.of("ozamigos", "sinal", "actuator", "assets", "api", "index", "error",
            "privacidade", "privacy", "sala", "salas", "grupo", "grupos", "admin", "login", "app", "site", "www", "en");
    static final int SENHA_MINIMA = 4;
    static final int MAXIMO = 200;
    static final int CRIACOES_POR_ENDERECO = 3;
    static final Duration JANELA_DE_CRIACAO = Duration.ofMinutes(10);
    static final Duration VAZIO_POR = Duration.ofMinutes(30);
    /** A senha é escolhida por quem cria (pode ser fraca): o resumo é lento de propósito, com sal. */
    private static final int ITERACOES = 20_000;

    public enum Resultado {
        ENTRA, CRIADO, SENHA_ERRADA, EM_USO, NAO_EXISTE, NOME_INVALIDO, SENHA_CURTA, CRIOU_DEMAIS, GRUPOS_DEMAIS
    }

    private static final class Grupo {
        final byte[] sal;
        final byte[] resumo;
        /** Desde quando está sem ninguém (null: tem gente). Um grupo recém-criado conta como vazio até alguém entrar. */
        Instant vazioDesde;

        Grupo(byte[] sal, byte[] resumo, Instant agora) {
            this.sal = sal;
            this.resumo = resumo;
            this.vazioDesde = agora;
        }
    }

    private final Map<String, Grupo> grupos = new HashMap<>();
    private final Map<String, Deque<Instant>> criacoes = new HashMap<>();
    private final SecureRandom aleatorio = new SecureRandom();
    private final Clock relogio;

    public Grupos() {
        this(Clock.systemUTC());
    }

    Grupos(Clock relogio) {
        this.relogio = relogio;
    }

    /** A chave da sala do grupo em Salas. */
    public static String sala(String nome) {
        return "grupo:" + nome;
    }

    public static boolean nomeValido(String nome) {
        return NOME_VALIDO.matcher(nome).matches() && !RESERVADOS.contains(nome);
    }

    /**
     * Confere a entrada num grupo. Com {@code criar}, cria o grupo se ele não existe (ou já não existe: foi esquecido);
     * existindo, a senha certa entra do mesmo jeito (amigos recriando juntos), e a errada dá EM_USO.
     */
    public synchronized Resultado entrar(String nome, String senha, boolean criar, String endereco) {
        if (!nomeValido(nome)) {
            return Resultado.NOME_INVALIDO;
        }
        Instant agora = relogio.instant();
        esquecerVazios(agora);
        Grupo grupo = grupos.get(nome);
        if (grupo != null) {
            if (MessageDigest.isEqual(grupo.resumo, resumo(senha, grupo.sal))) {
                return Resultado.ENTRA;
            }
            return criar ? Resultado.EM_USO : Resultado.SENHA_ERRADA;
        }
        if (!criar) {
            return Resultado.NAO_EXISTE;
        }
        if (senha.length() < SENHA_MINIMA) {
            return Resultado.SENHA_CURTA;
        }
        if (grupos.size() >= MAXIMO) {
            return Resultado.GRUPOS_DEMAIS;
        }
        Deque<Instant> recentes = criacoes.computeIfAbsent(endereco, e -> new ArrayDeque<>());
        while (!recentes.isEmpty() && !recentes.peekFirst().isAfter(agora.minus(JANELA_DE_CRIACAO))) {
            recentes.removeFirst();
        }
        if (recentes.size() >= CRIACOES_POR_ENDERECO) {
            return Resultado.CRIOU_DEMAIS;
        }
        recentes.addLast(agora);
        byte[] sal = new byte[16];
        aleatorio.nextBytes(sal);
        grupos.put(nome, new Grupo(sal, resumo(senha, sal), agora));
        return Resultado.CRIADO;
    }

    /** Alguém entrou na sala do grupo: ele não some enquanto houver gente. */
    public synchronized void ocupado(String nome) {
        Grupo grupo = grupos.get(nome);
        if (grupo != null) {
            grupo.vazioDesde = null;
        }
    }

    /** A sala do grupo ficou vazia: daqui a VAZIO_POR, ele é esquecido (se ninguém voltar antes). */
    public synchronized void vazio(String nome) {
        Grupo grupo = grupos.get(nome);
        if (grupo != null && grupo.vazioDesde == null) {
            grupo.vazioDesde = relogio.instant();
        }
    }

    public synchronized int quantos() {
        esquecerVazios(relogio.instant());
        return grupos.size();
    }

    private void esquecerVazios(Instant agora) {
        Instant limite = agora.minus(VAZIO_POR);
        grupos.values().removeIf(g -> g.vazioDesde != null && !g.vazioDesde.isAfter(limite));
        criacoes.values().removeIf(r -> r.isEmpty() || !r.peekLast().isAfter(agora.minus(JANELA_DE_CRIACAO)));
    }

    private static byte[] resumo(String senha, byte[] sal) {
        try {
            // O prefixo porque o PBKDF2 do Java recusa uma senha vazia (a chave do HMAC não pode ser vazia).
            PBEKeySpec spec = new PBEKeySpec(("oz:" + senha).toCharArray(), sal, ITERACOES, 256);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (NoSuchAlgorithmException | InvalidKeySpecException e) {
            // Toda JVM tem o PBKDF2.
            throw new IllegalStateException("Java sem PBKDF2", e);
        }
    }
}
