package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;

// RANDOM_PORT sobe o Tomcat de verdade, que é quem fornece o suporte a WebSocket.
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class OzamigosShareApplicationTests {

    @LocalServerPort
    private int porta;

    @Test
    void saudeRespondeUpSemDetalhesEOResteDoActuatorFicaFechado() throws Exception {
        HttpResponse<String> saude = get("/actuator/health");
        assertThat(saude.statusCode()).isEqualTo(200);
        assertThat(saude.body()).contains("\"status\":\"UP\"").doesNotContain("components", "details");

        assertThat(get("/actuator/env").statusCode()).isEqualTo(404);
        assertThat(get("/actuator/beans").statusCode()).isEqualTo(404);
    }

    @Test
    void osLinksDeAntesLevamAEntradaSemTomarOsCaminhosDoServidor() throws Exception {
        // O grupo fixo e os grupos com senha saíram (28/10/2026): o link antigo leva à entrada, e não a um erro.
        for (String antigo : new String[] {"/ozamigos", "/amigos-do-kayo"}) {
            HttpResponse<String> resposta = get(antigo);
            assertThat(resposta.statusCode()).isEqualTo(302);
            assertThat(resposta.headers().firstValue("Location").orElseThrow()).endsWith("/");
        }
        assertThat(new PaginasDoApp().servidorOuConvite("AbCdEfGh23")).isEqualTo("forward:/index.html");
        // O WebSocket continua sendo do WebSocket (sem o pedido de upgrade, ele recusa), não um link antigo.
        assertThat(get("/sinal").statusCode()).isEqualTo(400);
    }

    @Test
    void semBancoTodosSaoConvidadosESemLogin() throws Exception {
        HttpResponse<String> eu = get("/api/eu");

        assertThat(eu.statusCode()).isEqualTo(200);
        assertThat(eu.body()).isEqualTo("{\"login\":[],\"conta\":null}");
        assertThat(eu.headers().firstValue("Cache-Control").orElseThrow()).contains("no-store");
    }

    private HttpResponse<String> get(String caminho) throws Exception {
        try (HttpClient http = HttpClient.newHttpClient()) {
            return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + porta + caminho)).build(),
                    HttpResponse.BodyHandlers.ofString());
        }
    }
}
