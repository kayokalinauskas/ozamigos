package dev.ozamigos;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

/**
 * As sessões de quem entrou com conta. São do Ozamigos, no banco, e não do Spring: sobrevivem aos reinícios do Render
 * (deploy, o servidor dormindo), e o banco fora do ar só deixa todo mundo como convidado (nada quebra).
 *
 * <p>O cookie {@value #COOKIE} leva um segredo aleatório de 256 bits; o banco guarda só o resumo (SHA-256). Valem
 * {@link #VALIDADE} desde o último uso. {@code __Host-}: só por HTTPS (ou localhost), sem domínio, para o caminho
 * todo; {@code HttpOnly} (nenhum script da página o lê) e {@code SameSite=Lax} (outro site não manda pedidos com ele,
 * a não ser abrindo um link: e as ações conferem a origem, ProtecaoDaApi).
 */
@Component
public class Sessoes {

    private static final Logger log = LoggerFactory.getLogger(Sessoes.class);

    static final String COOKIE = "__Host-ozamigos";
    static final Duration VALIDADE = Duration.ofDays(60);
    /** Atualiza a validade no banco no máximo uma vez por dia, e não a cada pedido. */
    static final Duration RENOVAR_A_CADA = Duration.ofDays(1);
    private static final Pattern SEGREDO = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final Contas contas;
    private final JdbcClient banco;
    private final SecureRandom aleatorio = new SecureRandom();

    public Sessoes(Contas contas, ObjectProvider<DataSource> fonte) {
        this.contas = contas;
        DataSource dados = fonte.getIfAvailable();
        this.banco = dados == null ? null : JdbcClient.create(dados);
    }

    /** Uma sessão nova; devolve o segredo, que vai só no cookie. */
    public String criar(UUID usuario, String aparelho) {
        byte[] bytes = new byte[32];
        aleatorio.nextBytes(bytes);
        String segredo = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        banco.sql("""
                insert into sessoes (resumo, usuario_id, aparelho, expira_em)
                values (:resumo, :usuario, :aparelho, now() + make_interval(days => :dias))""")
                .param("resumo", resumo(segredo)).param("usuario", usuario).param("aparelho", aparelho)
                .param("dias", (int) VALIDADE.toDays()).update();
        return segredo;
    }

    /**
     * De quem é a sessão desse segredo. Vazio: sem cookie, segredo inválido, vencido ou apagado, e também com o banco
     * fora do ar (a pessoa entra como convidada, em vez de não entrar).
     */
    public Optional<UUID> usuario(String segredo) {
        return conta(segredo).map(Contas.Usuario::id);
    }

    /**
     * A conta da sessão (sem os provedores, que a sala não usa), numa consulta só: é a que roda a cada entrada numa
     * sala. A validade só é renovada no banco uma vez por dia (RENOVAR_A_CADA), numa segunda consulta, rara.
     */
    public Optional<Contas.Usuario> conta(String segredo) {
        if (segredo == null || !SEGREDO.matcher(segredo).matches() || !contas.disponivel()) {
            return Optional.empty();
        }
        byte[] resumo = resumo(segredo);
        try {
            record Achada(Contas.Usuario usuario, boolean renovar) {}
            Optional<Achada> achada = banco.sql("""
                    select u.id, u.nome, u.foto_versao, u.foto is not null as tem_foto,
                           s.usada_em < now() - make_interval(secs => :renovar) as renovar
                    from sessoes s join usuarios u on u.id = s.usuario_id
                    where s.resumo = :resumo and s.expira_em > now()""")
                    .param("resumo", resumo).param("renovar", (double) RENOVAR_A_CADA.toSeconds())
                    .query((linha, n) -> new Achada(new Contas.Usuario(linha.getObject("id", UUID.class), linha.getString("nome"),
                            linha.getInt("foto_versao"), linha.getBoolean("tem_foto"), List.of()), linha.getBoolean("renovar")))
                    .optional();
            if (achada.isPresent() && achada.get().renovar()) {
                banco.sql("update sessoes set usada_em = now(), expira_em = now() + make_interval(days => :dias) where resumo = :resumo")
                        .param("dias", (int) VALIDADE.toDays()).param("resumo", resumo).update();
            }
            return achada.map(Achada::usuario);
        } catch (DataAccessException erro) {
            contas.bancoFalhou();
            log.warn("Sessões: o banco não respondeu ({}); convidados por {} s", erro.getMostSpecificCause().getMessage(),
                    Contas.FORA_POR.toSeconds());
            return Optional.empty();
        }
    }

    public void encerrar(String segredo) {
        if (segredo != null && SEGREDO.matcher(segredo).matches()) {
            banco.sql("delete from sessoes where resumo = :resumo").param("resumo", resumo(segredo)).update();
        }
    }

    static ResponseCookie cookie(String segredo) {
        return ResponseCookie.from(COOKIE, segredo).path("/").secure(true).httpOnly(true).sameSite("Lax")
                .maxAge(VALIDADE).build();
    }

    static ResponseCookie cookieApagado() {
        return ResponseCookie.from(COOKIE, "").path("/").secure(true).httpOnly(true).sameSite("Lax").maxAge(0).build();
    }

    static String segredoDe(HttpServletRequest pedido) {
        Cookie[] cookies = pedido.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (COOKIE.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    /** O segredo nos cabeçalhos do pedido de abertura do WebSocket. */
    static String segredoDe(HttpHeaders cabecalhos) {
        List<String> linhas = cabecalhos.getOrEmpty(HttpHeaders.COOKIE);
        for (String linha : linhas) {
            for (String parte : linha.split(";")) {
                int igual = parte.indexOf('=');
                if (igual > 0 && parte.substring(0, igual).strip().equals(COOKIE)) {
                    return parte.substring(igual + 1).strip();
                }
            }
        }
        return null;
    }

    static byte[] resumo(String segredo) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(segredo.getBytes(StandardCharsets.US_ASCII));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
