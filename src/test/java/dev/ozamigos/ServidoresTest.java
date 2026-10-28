package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;

import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import dev.ozamigos.Servidores.Motivo;
import dev.ozamigos.Servidores.Papel;

/** Os servidores salvos, com o banco de verdade: quem pode o quê, os convites, a posse e a sala sem senha. */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = "ozamigos.senha=teste")
@Import(SinalizacaoTest.SemInternet.class)
class ServidoresTest extends ComBanco {

    @LocalServerPort
    private int porta;

    @Autowired
    private VidaDoBanco vida;
    @Autowired
    private Contas contas;
    @Autowired
    private Sessoes sessoes;
    @Autowired
    private Servidores servidores;
    @Autowired
    private DataSource fonte;
    @Autowired
    private JsonMapper json;

    private final HttpClient http = HttpClient.newHttpClient();

    @BeforeEach
    void banco() throws InterruptedException {
        esperarPronto(vida);
    }

    @Test
    void osPapeisDecidemQuemPodeOQue() {
        UUID ana = conta("Ana"), beto = conta("Beto"), caio = conta("Caio"), dani = conta("Dani"), estranho = conta("Estranho");
        String codigo = servidores.criar(ana, "  Os Amigos\u202E ");
        for (UUID quem : new UUID[] {beto, caio, dani}) {
            servidores.aceitar(servidores.convidar(codigo, ana, null, null), quem);
        }
        servidores.mudarPapel(codigo, ana, beto, Papel.ADMIN);
        servidores.mudarPapel(codigo, ana, dani, Papel.ADMIN);

        assertThat(servidores.ver(codigo, caio).nome()).isEqualTo("Os Amigos");
        recusado(Motivo.NAO_EXISTE, () -> servidores.ver(codigo, estranho)); // igual a um que não existe
        recusado(Motivo.SEM_PERMISSAO, () -> servidores.renomear(codigo, caio, "Meu"));
        recusado(Motivo.SEM_PERMISSAO, () -> servidores.convites(codigo, caio));
        recusado(Motivo.SEM_PERMISSAO, () -> servidores.expulsar(codigo, beto, dani)); // admin não tira admin
        recusado(Motivo.SEM_PERMISSAO, () -> servidores.mudarPapel(codigo, beto, caio, Papel.ADMIN));
        recusado(Motivo.SEM_PERMISSAO, () -> servidores.apagar(codigo, beto));
        recusado(Motivo.DONO_NAO_SAI, () -> servidores.sair(codigo, ana));
        assertThat(servidores.renomear(codigo, beto, "Nome do Admin")).isEqualTo("Nome do Admin");
        servidores.expulsar(codigo, beto, caio);
        assertThat(servidores.papel(codigo, caio)).isEmpty();
        // Expulso fica bloqueado: nem um convite novo o traz de volta, até um admin desbloquear.
        String convite = servidores.convidar(codigo, beto, null, null);
        recusado(Motivo.BLOQUEADO, () -> servidores.aceitar(convite, caio));
        assertThat(servidores.bloqueados(codigo, dani)).singleElement().satisfies(b -> assertThat(b.porQuem()).isEqualTo("Beto"));
        servidores.desbloquear(codigo, dani, caio);
        assertThat(servidores.aceitar(convite, caio)).isEqualTo(codigo);

        servidores.passarPosse(codigo, ana, beto);
        assertThat(servidores.papel(codigo, beto)).contains(Papel.DONO);
        assertThat(servidores.papel(codigo, ana)).contains(Papel.ADMIN);
        servidores.sair(codigo, ana);
        assertThat(servidores.meus(ana)).isEmpty();
    }

    @Test
    void oConviteValeAteOsUsosEOPrazoEOsMembrosConvidamSeODonoDeixar() {
        UUID ana = conta("Ana"), beto = conta("Beto"), caio = conta("Caio");
        String codigo = servidores.criar(ana, "Servidor");
        String umUso = servidores.convidar(codigo, ana, Duration.ofDays(1), 1);

        assertThat(servidores.aceitar(umUso, beto)).isEqualTo(codigo);
        assertThat(servidores.aceitar(umUso, beto)).isEqualTo(codigo); // já é membro: não gasta o uso, nem falha
        recusado(Motivo.CONVITE_INVALIDO, () -> servidores.aceitar(umUso, caio));

        String vencido = servidores.convidar(codigo, ana, Duration.ofHours(1), null);
        JdbcClient.create(fonte).sql("update convites set expira_em = now() - interval '1 second' where codigo = :c")
                .param("c", vencido).update();
        assertThat(servidores.previa(vencido)).isEmpty();
        recusado(Motivo.CONVITE_INVALIDO, () -> servidores.aceitar(vencido, caio));

        servidores.aceitar(servidores.convidar(codigo, beto, null, null), caio); // membro convida
        servidores.membrosConvidam(codigo, ana, false);
        recusado(Motivo.SEM_PERMISSAO, () -> servidores.convidar(codigo, beto, null, null));
        recusado(Motivo.PEDIDO_INVALIDO, () -> servidores.convidar(codigo, ana, Duration.ofDays(31), null));
        assertThat(servidores.ver(codigo, ana).membros()).hasSize(3);
    }

    @Test
    void apagarAContaPassaOsServidoresAdianteOuApagaOsVazios() {
        UUID ana = conta("Ana"), beto = conta("Beto"), caio = conta("Caio");
        String comGente = servidores.criar(ana, "Com gente");
        String vazio = servidores.criar(ana, "Só a Ana");
        servidores.aceitar(servidores.convidar(comGente, ana, null, null), beto);
        servidores.aceitar(servidores.convidar(comGente, ana, null, null), caio);
        servidores.mudarPapel(comGente, ana, caio, Papel.ADMIN); // admin, mesmo tendo entrado depois do Beto

        contas.apagar(ana);

        assertThat(servidores.papel(comGente, caio)).contains(Papel.DONO);
        assertThat(servidores.papel(comGente, beto)).contains(Papel.MEMBRO);
        assertThat(servidores.icone(vazio)).isEmpty();
        assertThat(JdbcClient.create(fonte).sql("select count(*) from servidores where codigo = :c").param("c", vazio)
                .query(Integer.class).single()).isZero();
    }

    @Test
    void peloLinkOMembroEntraNaSalaSemSenhaEQuemEhExpulsoSaiNaHora() throws Exception {
        UUID ana = conta("Ana"), beto = conta("Beto"), estranho = conta("Estranho");
        String daAna = cookie(ana), doBeto = cookie(beto);
        String codigo = json.readTree(enviar("POST", "/api/servidores", daAna, "{\"nome\":\"Os Amigos\"}").body()).path("codigo").asString();
        String convite = json.readTree(enviar("POST", "/api/servidores/" + codigo + "/convites", daAna, "{\"usos\":5}").body())
                .path("codigo").asString();

        // A prévia do convite, mesmo sem conta; aceitar pede conta.
        JsonNode previa = json.readTree(get("/api/convites/" + convite, null).body());
        assertThat(previa.path("nome").asString()).isEqualTo("Os Amigos");
        assertThat(previa.path("membros").asInt()).isEqualTo(1);
        assertThat(enviar("POST", "/api/convites/" + convite, null, "").statusCode()).isEqualTo(401);
        assertThat(json.readTree(enviar("POST", "/api/convites/" + convite, doBeto, "").body()).path("servidor").asString())
                .isEqualTo(codigo);
        assertThat(json.readTree(get("/api/servidores", doBeto).body()).path("servidores").get(0).path("papel").asString())
                .isEqualTo("membro");

        String entrar = "{\"tipo\":\"entrar\",\"servidor\":\"" + codigo + "\",\"senha\":\"\",\"nome\":\"x\"}";
        ClienteDaSala doServidor = ClienteDaSala.conectar(porta, doBeto, "203.0.113.20");
        doServidor.enviar(entrar);
        assertThat(doServidor.esperar("bem-vindo").path("nome").asString()).isEqualTo("Beto");

        ClienteDaSala naoMembro = ClienteDaSala.conectar(porta, cookie(estranho), "203.0.113.21");
        naoMembro.enviar(entrar);
        assertThat(naoMembro.esperarErro()).isEqualTo("servidor-nao-existe");
        ClienteDaSala convidado = ClienteDaSala.conectar(porta, null, "203.0.113.22");
        convidado.enviar(entrar);
        assertThat(convidado.esperarErro()).isEqualTo("sem-conta");

        assertThat(enviar("DELETE", "/api/servidores/" + codigo + "/membros/" + beto, daAna, "").statusCode()).isEqualTo(204);
        assertThat(doServidor.esperarErro()).isEqualTo("expulso");
        long limite = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (!doServidor.fechou && System.nanoTime() < limite) {
            Thread.sleep(50);
        }
        assertThat(doServidor.fechou).isTrue();
        assertThat(get("/api/servidores/" + codigo, doBeto).statusCode()).isEqualTo(404);
    }

    private UUID conta(String nome) {
        return contas.entrar("google", UUID.randomUUID().toString(), nome).id();
    }

    private String cookie(UUID usuario) {
        return Sessoes.COOKIE + "=" + sessoes.criar(usuario, "navegador");
    }

    private static void recusado(Motivo motivo, Runnable acao) {
        assertThatThrownBy(acao::run).isInstanceOfSatisfying(Servidores.Recusa.class, r -> assertThat(r.motivo).isEqualTo(motivo));
    }

    private String origem() {
        return "http://localhost:" + porta;
    }

    private HttpResponse<String> get(String caminho, String cookie) throws Exception {
        HttpRequest.Builder pedido = HttpRequest.newBuilder(URI.create(origem() + caminho));
        if (cookie != null) {
            pedido.header("Cookie", cookie);
        }
        return http.send(pedido.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> enviar(String metodo, String caminho, String cookie, String corpo) throws Exception {
        HttpRequest.Builder pedido = HttpRequest.newBuilder(URI.create(origem() + caminho))
                .header("Content-Type", "application/json").header("Origin", origem())
                .method(metodo, HttpRequest.BodyPublishers.ofString(corpo));
        if (cookie != null) {
            pedido.header("Cookie", cookie);
        }
        return http.send(pedido.build(), HttpResponse.BodyHandlers.ofString());
    }
}
