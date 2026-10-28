package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.UUID;

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

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * As contas de ponta a ponta no servidor, com o banco de verdade: o login (até a porta do provedor, e a volta dele
 * simulada), a sessão no cookie, a API e a conta dentro da sala.
 */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = {
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
    private Servidores servidores;
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

        HttpResponse<String> quemSou = get("/api/eu", cookie);
        assertThat(quemSou.headers().firstValue("Set-Cookie").orElseThrow()).startsWith(cookie + ";"); // renovado a cada abertura
        JsonNode eu = json.readTree(quemSou.body());
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
    void umCorpoGrandeDemaisEhRecusadoAntesDeLerOuConferirAConta() throws Exception {
        String enorme = "{\"nome\":\"" + "a".repeat(LimitesDaApi.CORPO_MAXIMO) + "\"}";
        HttpResponse<String> resposta = enviar("POST", "/api/servidores", null, origem(), enorme);
        assertThat(resposta.statusCode()).isEqualTo(413);
        assertThat(resposta.body()).contains("grande-demais");

        // Em pedaços, sem o tamanho no cabeçalho: o limite vale na leitura, com a mesma resposta.
        UUID ana = novaConta("Ana");
        HttpRequest emPedacos = HttpRequest.newBuilder(URI.create(origem() + "/api/servidores"))
                .header("Content-Type", "application/json").header("Origin", origem())
                .header("Cookie", Sessoes.COOKIE + "=" + sessoes.criar(ana, "navegador"))
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new java.io.ByteArrayInputStream(enorme.getBytes())))
                .build();
        HttpResponse<String> lida = http.send(emPedacos, HttpResponse.BodyHandlers.ofString());
        assertThat(lida.statusCode()).isEqualTo(413);
        assertThat(lida.body()).contains("grande-demais");
    }

    @Test
    void comContasNovasDemaisNaHoraQuemJaTemContaEntraEQuemNaoTemEspera() throws Exception {
        String doGoogle = UUID.randomUUID().toString();
        UUID ana = contas.entrar("google", doGoogle, "Ana").id();
        int antes = contas.contasNovasPorHora;
        contas.contasNovasPorHora = 0;
        try {
            assertThat(contas.entrar("google", doGoogle, "Ana").id()).isEqualTo(ana);
            MockHttpServletResponse volta = voltarDoDiscord(new Login.Pedido("/", null, null, null), "nova", "Beto");
            assertThat(volta.getRedirectedUrl()).isEqualTo("/?erro-de-login=contas-novas-demais");
            assertThat(volta.getHeader("Set-Cookie")).isNull();
        } finally {
            contas.contasNovasPorHora = antes;
        }

        // Por endereço: quem cria contas descartáveis esbarra no próprio teto, e as contas dos outros continuam nascendo.
        Freio antigo = contas.novasPorEndereco;
        contas.novasPorEndereco = new Freio(1, java.time.Duration.ofHours(1));
        try {
            assertThat(contas.entrar("google", UUID.randomUUID().toString(), "Caio", "203.0.113.50")).isNotNull();
            org.assertj.core.api.Assertions.assertThatThrownBy(
                    () -> contas.entrar("google", UUID.randomUUID().toString(), "Caio 2", "203.0.113.50"))
                    .isInstanceOf(Contas.NovasDemais.class);
            assertThat(contas.entrar("google", UUID.randomUUID().toString(), "Duda", "203.0.113.51")).isNotNull();
        } finally {
            contas.novasPorEndereco = antigo;
        }
    }

    @Test
    void sairDeTodosOsAparelhosEncerraTodasAsSessoesDaConta() throws Exception {
        UUID ana = novaConta("Ana");
        String noApp = sessoes.criar(ana, "app");
        String cookie = Sessoes.COOKIE + "=" + sessoes.criar(ana, "navegador");

        HttpResponse<String> saiu = enviar("POST", "/api/eu/sair-de-todos", cookie, origem(), "");
        assertThat(saiu.statusCode()).isEqualTo(204);
        assertThat(saiu.headers().firstValue("Set-Cookie").orElseThrow()).contains("Max-Age=0");
        assertThat(sessoes.usuario(noApp)).isEmpty();
        assertThat(contas.usuario(ana)).isPresent();
    }

    @Test
    void umLinkComOCodigoDeLigacaoDeOutraPessoaNaoLigaNada() throws Exception {
        UUID ana = novaConta("Ana");
        String cookie = Sessoes.COOKIE + "=" + sessoes.criar(ana, "app");
        String ligacao = json.readTree(enviar("POST", "/api/eu/ligacao", cookie, origem(), "").body()).path("ligacao").asString();

        // Aberto no navegador de outra pessoa, sem o app: recusado antes de ir ao provedor.
        assertThat(get("/conta/ligar/discord?ligacao=" + ligacao, null).headers().firstValue("Location").orElseThrow())
                .endsWith("/?erro-de-login=pedido-invalido");

        // Com uma porta de app inventada: o código de confirmação vai para o PC de quem abriu, e a conta de quem
        // mandou não consegue confirmar sem ele. Nem quem abriu, com outra conta.
        String estado = "estado-do-app-0123456789";
        MockHttpServletResponse volta = voltarDoDiscord(new Login.Pedido("/", 50125, estado, ana), "222", "Beto");
        assertThat(contas.usuario(ana).orElseThrow().provedores()).containsExactly("google");
        String codigo = codigoDa(volta.getRedirectedUrl());
        String deBeto = Sessoes.COOKIE + "=" + sessoes.criar(novaConta("Beto"), "app");
        assertThat(enviar("POST", "/api/eu/ligacao/confirmar", deBeto, origem(), "{\"codigo\":\"" + codigo + "\"}").statusCode())
                .isEqualTo(400);
        assertThat(enviar("POST", "/api/eu/ligacao/confirmar", cookie, origem(), "{\"codigo\":\"" + codigo + "\"}").statusCode())
                .isEqualTo(400); // uma vez só
        assertThat(contas.usuario(ana).orElseThrow().provedores()).containsExactly("google");
    }

    @Test
    void peloAppOCodigoDeLigacaoLigaOutroProvedorENaoViraSessao() throws Exception {
        UUID ana = novaConta("Ana");
        String cookie = Sessoes.COOKIE + "=" + sessoes.criar(ana, "app");
        String ligacao = json.readTree(enviar("POST", "/api/eu/ligacao", cookie, origem(), "").body()).path("ligacao").asString();

        // Trocado como se fosse o de um login, não vale (e deixa de valer).
        assertThat(enviar("POST", "/api/conta/codigo", null, origem(), "{\"codigo\":\"" + ligacao + "\"}").statusCode()).isEqualTo(400);

        String outra = json.readTree(enviar("POST", "/api/eu/ligacao", cookie, origem(), "").body()).path("ligacao").asString();
        String estado = "estado-do-app-0123456789";
        HttpResponse<String> comeco = get("/conta/ligar/discord?app=50124&estado=" + estado + "&ligacao=" + outra, null);
        assertThat(comeco.headers().firstValue("Location").orElseThrow()).endsWith("/oauth2/authorization/discord");
        assertThat(get("/conta/ligar/discord?app=50124&estado=" + estado + "&ligacao=" + outra, null)
                .headers().firstValue("Location").orElseThrow()).contains("erro=sem-conta"); // uma vez só

        // A volta leva à porta do app um código, que a página do app (com a sessão da conta) confirma.
        MockHttpServletResponse volta = voltarDoDiscord(new Login.Pedido("/", 50124, estado, ana), "111", "Ana");
        assertThat(volta.getRedirectedUrl()).startsWith("http://127.0.0.1:50124/login?codigo=").endsWith("&estado=" + estado);
        assertThat(contas.usuario(ana).orElseThrow().provedores()).containsExactly("google");
        HttpResponse<String> confirmou = enviar("POST", "/api/eu/ligacao/confirmar", cookie, origem(),
                "{\"codigo\":\"" + codigoDa(volta.getRedirectedUrl()) + "\"}");
        assertThat(confirmou.statusCode()).isEqualTo(200);
        assertThat(json.readTree(confirmou.body()).path("ligou").asString()).isEqualTo("discord");
        assertThat(contas.usuario(ana).orElseThrow().provedores()).containsExactly("discord", "google");
    }

    @Test
    void naSalaONomeEhODaContaEElaRecebeARetransmissao() throws Exception {
        UUID ana = novaConta("Ana da Conta");
        String servidor = servidores.criar(ana, "Servidor da Ana");
        ClienteDaSala comConta = ClienteDaSala.conectar(porta, Sessoes.COOKIE + "=" + sessoes.criar(ana, "app"), "203.0.113.7");
        comConta.enviar("{\"tipo\":\"entrar\",\"servidor\":\"" + servidor + "\",\"nome\":\"Nome Forjado\"}");

        JsonNode boasVindas = comConta.esperar("bem-vindo");
        assertThat(boasVindas.path("nome").asString()).isEqualTo("Ana da Conta");
        assertThat(boasVindas.path("conta").asString()).isEqualTo(ana.toString());
        assertThat(boasVindas.path("retransmissao").isEmpty()).isFalse();
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

    private static String codigoDa(String volta) {
        return volta.substring(volta.indexOf("codigo=") + 7, volta.indexOf('&'));
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
}
