package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * As contas de ponta a ponta no servidor, com o banco de verdade: o login (até a porta do provedor, e a volta dele
 * simulada), a sessão no cookie, a API e a conta dentro da sala.
 */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = {
        "ozamigos.senha=teste",
        "ozamigos.google.id=id-de-teste", "ozamigos.google.segredo=segredo-de-teste",
        "ozamigos.discord.id=id-do-discord", "ozamigos.discord.segredo=segredo-do-discord"})
@Import(SinalizacaoTest.SemInternet.class)
class ContasTest extends ComBanco {

    @LocalServerPort
    private int porta;

    @Autowired
    private VidaDoBanco vida;
    @Autowired
    private Contas contas;
    @Autowired
    private Sessoes sessoes;
    @Autowired
    private CodigosDoApp codigos;
    @Autowired
    private AoEntrar aoEntrar;
    @Autowired
    private JsonMapper json;

    private final HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

    @BeforeEach
    void banco() throws InterruptedException {
        esperarPronto(vida);
    }

    @Test
    void oMesmoLoginEhSempreOMesmoUsuario() {
        String doGoogle = UUID.randomUUID().toString();

        Contas.Entrada primeira = contas.entrar("google", doGoogle, "Ana Maria\n");
        Contas.Entrada segunda = contas.entrar("google", doGoogle, "Outro nome");

        assertThat(segunda.id()).isEqualTo(primeira.id());
        assertThat(contas.usuario(primeira.id()).orElseThrow().nome()).isEqualTo("Ana Maria"); // limpo, e o primeiro fica
        assertThat(contas.entrar("discord", doGoogle, "Ana").id()).isNotEqualTo(primeira.id()); // outro provedor, outra conta
    }

    @Test
    void oCookieDizQuemEhESairEncerraASessao() throws Exception {
        UUID ana = novaConta("Ana");
        String cookie = Sessoes.COOKIE + "=" + sessoes.criar(ana, "navegador");

        JsonNode eu = json.readTree(get("/api/eu", cookie).body());
        assertThat(eu.path("conta").path("nome").asString()).isEqualTo("Ana");
        assertThat(eu.path("conta").path("provedores").get(0).asString()).isEqualTo("google");
        assertThat(eu.path("login").toString()).isEqualTo("[\"google\",\"discord\"]");

        HttpResponse<String> saiu = enviar("POST", "/api/eu/sair", cookie, origem(), "");
        assertThat(saiu.statusCode()).isEqualTo(204);
        assertThat(saiu.headers().firstValue("Set-Cookie").orElseThrow()).contains(Sessoes.COOKIE + "=;", "Max-Age=0");
        assertThat(json.readTree(get("/api/eu", cookie).body()).path("conta").isNull()).isTrue();
    }

    @Test
    void acoesVindasDeOutroSiteSaoRecusadas() throws Exception {
        UUID ana = novaConta("Ana");
        String cookie = Sessoes.COOKIE + "=" + sessoes.criar(ana, "navegador");

        assertThat(enviar("DELETE", "/api/eu", cookie, "https://site-malicioso.example", "{\"confirmar\":true}").statusCode()).isEqualTo(403);
        assertThat(enviar("DELETE", "/api/eu", cookie, null, "{\"confirmar\":true}").statusCode()).isEqualTo(403);
        assertThat(contas.usuario(ana)).isPresent();
    }

    @Test
    void apagarAContaPedeConfirmacaoEApagaTudo() throws Exception {
        UUID ana = novaConta("Ana");
        String segredo = sessoes.criar(ana, "navegador");
        String cookie = Sessoes.COOKIE + "=" + segredo;

        assertThat(enviar("DELETE", "/api/eu", cookie, origem(), "{}").statusCode()).isEqualTo(400);
        assertThat(enviar("DELETE", "/api/eu", cookie, origem(), "{\"confirmar\":true}").statusCode()).isEqualTo(204);

        assertThat(contas.usuario(ana)).isEmpty();
        assertThat(sessoes.usuario(segredo)).isEmpty();
    }

    @Test
    void oNomeDaContaMudaLimpoComoONomeDaSala() throws Exception {
        UUID ana = novaConta("Ana");
        String cookie = Sessoes.COOKIE + "=" + sessoes.criar(ana, "navegador");

        HttpResponse<String> mudou = enviar("PATCH", "/api/eu", cookie, origem(), "{\"nome\":\"  Aninha\\u202E  \"}");

        assertThat(json.readTree(mudou.body()).path("nome").asString()).isEqualTo("Aninha");
        assertThat(contas.usuario(ana).orElseThrow().nome()).isEqualTo("Aninha");
    }

    @Test
    void oUltimoProvedorNaoSaiDaConta() {
        UUID ana = novaConta("Ana");
        assertThat(contas.ligar(ana, "discord", UUID.randomUUID().toString())).isEqualTo(Contas.Ligacao.LIGADA);

        assertThat(contas.desligar(ana, "google")).isEqualTo(Contas.Desligamento.DESLIGADA);
        assertThat(contas.desligar(ana, "discord")).isEqualTo(Contas.Desligamento.ULTIMA);
    }

    @Test
    void oLoginVaiAoProvedorComPkceESemPedirOEmail() throws Exception {
        HttpResponse<String> comeco = get("/conta/entrar/google?voltar=/ozamigos", null);
        assertThat(comeco.statusCode()).isEqualTo(302);
        assertThat(comeco.headers().firstValue("Location").orElseThrow()).endsWith("/oauth2/authorization/google");
        String sessaoDoLogin = comeco.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];

        String provedor = get("/oauth2/authorization/google", sessaoDoLogin).headers().firstValue("Location").orElseThrow();

        assertThat(provedor).startsWith("https://accounts.google.com/").contains("scope=openid%20profile", "code_challenge=",
                "client_id=id-de-teste").doesNotContain("email");
    }

    @Test
    void naVoltaDoProvedorONavegadorGanhaASessao() throws Exception {
        MockHttpServletResponse resposta = voltarDoDiscord(new Login.Pedido("/ozamigos", null, null, null), "12345", "Kayo");

        assertThat(resposta.getRedirectedUrl()).isEqualTo("/ozamigos");
        String cookie = resposta.getHeader("Set-Cookie");
        assertThat(cookie).startsWith(Sessoes.COOKIE + "=").contains("Secure", "HttpOnly", "SameSite=Lax");
        UUID usuario = sessoes.usuario(cookie.substring(Sessoes.COOKIE.length() + 1, cookie.indexOf(';'))).orElseThrow();
        assertThat(contas.usuario(usuario).orElseThrow().nome()).isEqualTo("Kayo");
    }

    @Test
    void naVoltaDoProvedorOAppRecebeUmCodigoQueValeUmaVezSo() throws Exception {
        String estado = "estado-do-app-0123456789";
        MockHttpServletResponse resposta = voltarDoDiscord(new Login.Pedido("/", 50123, estado, null), "67890", "Beto");

        String volta = resposta.getRedirectedUrl();
        assertThat(volta).startsWith("http://127.0.0.1:50123/login?codigo=").endsWith("&estado=" + estado);
        assertThat(resposta.getHeader("Set-Cookie")).isNull(); // a sessão é da janela do app, não do navegador
        String codigo = volta.substring(volta.indexOf("codigo=") + 7, volta.indexOf('&'));

        HttpResponse<String> troca = enviar("POST", "/api/conta/codigo", null, origem(), "{\"codigo\":\"" + codigo + "\"}");
        assertThat(troca.statusCode()).isEqualTo(204);
        assertThat(troca.headers().firstValue("Set-Cookie").orElseThrow()).startsWith(Sessoes.COOKIE + "=");
        assertThat(enviar("POST", "/api/conta/codigo", null, origem(), "{\"codigo\":\"" + codigo + "\"}").statusCode()).isEqualTo(400);
    }

    @Test
    void naSalaQuemTemContaEntraComONomeDelaERecebeARetransmissao() throws Exception {
        UUID ana = novaConta("Ana da Conta");
        String sala = "conta" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        Cliente comConta = conectar(Sessoes.COOKIE + "=" + sessoes.criar(ana, "app"), "203.0.113.7");
        comConta.enviar("{\"tipo\":\"entrar\",\"sala\":\"" + sala + "\",\"senha\":\"teste\",\"nome\":\"Nome Forjado\"}");

        JsonNode boasVindas = comConta.esperar("bem-vindo");
        assertThat(boasVindas.path("nome").asString()).isEqualTo("Ana da Conta");
        assertThat(boasVindas.path("conta").asString()).isEqualTo(ana.toString());
        assertThat(boasVindas.path("retransmissao").isEmpty()).isFalse();
        assertThat(boasVindas.has("retransmissaoSoComConta")).isFalse();

        Cliente convidado = conectar(null, "203.0.113.8");
        convidado.enviar("{\"tipo\":\"entrar\",\"sala\":\"" + sala + "\",\"senha\":\"teste\",\"nome\":\"Beto\"}");
        JsonNode doConvidado = convidado.esperar("bem-vindo");
        assertThat(doConvidado.has("retransmissao")).isFalse();
        assertThat(doConvidado.path("retransmissaoSoComConta").asBoolean()).isTrue();
        assertThat(doConvidado.path("outros").get(0).path("conta").asString()).isEqualTo(ana.toString());
        assertThat(comConta.esperar("entrou").has("conta")).isFalse();
    }

    private UUID novaConta(String nome) {
        return contas.entrar("google", UUID.randomUUID().toString(), nome).id();
    }

    private MockHttpServletResponse voltarDoDiscord(Login.Pedido pedido, String id, String nome) throws Exception {
        MockHttpServletRequest volta = new MockHttpServletRequest("GET", "/login/oauth2/code/discord");
        volta.getSession(true).setAttribute(Login.PEDIDO, pedido);
        var usuario = new DefaultOAuth2User(AuthorityUtils.createAuthorityList("OAUTH2_USER"),
                Map.of("id", id + System.nanoTime(), "username", "usuario", "global_name", nome), "id");
        MockHttpServletResponse resposta = new MockHttpServletResponse();
        aoEntrar.onAuthenticationSuccess(volta, resposta, new OAuth2AuthenticationToken(usuario, usuario.getAuthorities(), "discord"));
        assertThat(volta.getSession(false)).isNull(); // a sessão do login (com o token do provedor) foi descartada
        return resposta;
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

    private HttpResponse<String> enviar(String metodo, String caminho, String cookie, String origem, String corpo) throws Exception {
        HttpRequest.Builder pedido = HttpRequest.newBuilder(URI.create(origem() + caminho))
                .header("Content-Type", "application/json")
                .method(metodo, HttpRequest.BodyPublishers.ofString(corpo));
        if (cookie != null) {
            pedido.header("Cookie", cookie);
        }
        if (origem != null) {
            pedido.header("Origin", origem);
        }
        return http.send(pedido.build(), HttpResponse.BodyHandlers.ofString());
    }

    private Cliente conectar(String cookie, String endereco) throws Exception {
        WebSocketHttpHeaders cabecalhos = new WebSocketHttpHeaders();
        cabecalhos.add("CF-Connecting-IP", endereco);
        if (cookie != null) {
            cabecalhos.add("Cookie", cookie);
        }
        Cliente cliente = new Cliente();
        cliente.sessao = new StandardWebSocketClient()
                .execute(cliente, cabecalhos, URI.create("ws://localhost:" + porta + "/sinal"))
                .get(5, TimeUnit.SECONDS);
        return cliente;
    }

    private class Cliente extends TextWebSocketHandler {
        final BlockingQueue<JsonNode> recebidas = new LinkedBlockingQueue<>();
        WebSocketSession sessao;

        @Override
        protected void handleTextMessage(WebSocketSession s, TextMessage m) {
            recebidas.add(json.readTree(m.getPayload()));
        }

        void enviar(String texto) throws Exception {
            sessao.sendMessage(new TextMessage(texto));
        }

        JsonNode esperar(String tipo) throws InterruptedException {
            long limite = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (System.nanoTime() < limite) {
                JsonNode m = recebidas.poll(100, TimeUnit.MILLISECONDS);
                if (m != null && m.path("tipo").asString().equals(tipo)) {
                    return m;
                }
            }
            throw new AssertionError("não chegou mensagem do tipo " + tipo);
        }
    }
}
