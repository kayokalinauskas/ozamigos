package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** O painel do dono: só o dono o vê (os outros recebem o 404 de um endereço que não existe), com as salas abertas. */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@Import(SinalizacaoTest.SemInternet.class)
class PainelTest extends ComBanco {

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
    private Painel painel;
    @Autowired
    private JsonMapper json;

    private final HttpClient http = HttpClient.newHttpClient();

    @BeforeEach
    void banco() throws InterruptedException {
        esperarPronto(vida);
    }

    @Test
    void soODonoVeOPainelComQuemEstaEmCadaSala() throws Exception {
        UUID dono = contas.entrar("google", UUID.randomUUID().toString(), "Dono").id();
        UUID ana = contas.entrar("google", UUID.randomUUID().toString(), "Ana").id();
        painel.donos = Set.of(dono);
        String servidor = servidores.criar(ana, "Servidor da Ana");
        ClienteDaSala naSala = ClienteDaSala.conectar(porta, Sessoes.COOKIE + "=" + sessoes.criar(ana, "app"), "203.0.113.8");
        naSala.enviar("{\"tipo\":\"entrar\",\"servidor\":\"" + servidor + "\"}");
        naSala.esperar("bem-vindo");

        assertThat(get(null).statusCode()).isEqualTo(404);
        HttpResponse<String> daAna = get(sessoes.criar(ana, "navegador"));
        assertThat(daAna.statusCode()).isEqualTo(404);
        assertThat(daAna.body()).doesNotContain("Servidor da Ana");
        assertThat(json.readTree(eu(sessoes.criar(ana, "navegador"))).path("conta").has("dono")).isFalse();

        String doDono = sessoes.criar(dono, "navegador");
        assertThat(json.readTree(eu(doDono)).path("conta").path("dono").asBoolean()).isTrue();
        HttpResponse<String> resposta = get(doDono);
        assertThat(resposta.statusCode()).isEqualTo(200);
        JsonNode corpo = json.readTree(resposta.body());
        JsonNode sala = corpo.path("salas").get(0);
        assertThat(sala.path("nome").asString()).isEqualTo("Servidor da Ana");
        assertThat(sala.path("pessoas").get(0).path("conta").asString()).isEqualTo(ana.toString());
        assertThat(corpo.path("servidores").findValuesAsString("nome")).contains("Servidor da Ana");
        assertThat(corpo.path("contas").findValuesAsString("id")).contains(dono.toString(), ana.toString());
        assertThat(corpo.path("banco").path("contas").asLong()).isGreaterThanOrEqualTo(2);
    }

    private HttpResponse<String> get(String sessao) throws Exception {
        HttpRequest.Builder pedido = HttpRequest.newBuilder(URI.create("http://localhost:" + porta + "/api/painel"));
        if (sessao != null) {
            pedido.header("Cookie", Sessoes.COOKIE + "=" + sessao);
        }
        return http.send(pedido.build(), HttpResponse.BodyHandlers.ofString());
    }

    private String eu(String sessao) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + porta + "/api/eu"))
                .header("Cookie", Sessoes.COOKIE + "=" + sessao).build(), HttpResponse.BodyHandlers.ofString()).body();
    }
}
