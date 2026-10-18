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
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = "ozamigos.senha=teste")
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
    void oEnderecoDeUmGrupoAbreAInterfaceSemTomarOsCaminhosDoServidor() throws Exception {
        assertThat(new PaginaDoGrupo().grupo("amigos-do-kayo")).isEqualTo("forward:/index.html");
        assertThat(new PaginaDoGrupo().grupo("ozamigos")).isEqualTo("forward:/index.html"); // o grupo fixo, sala única
        assertThat(get("/privacidade").statusCode()).isEqualTo(404);
        // O WebSocket continua sendo do WebSocket (sem o pedido de upgrade, ele recusa), não da página do grupo.
        assertThat(get("/sinal").statusCode()).isEqualTo(400);
    }

    private HttpResponse<String> get(String caminho) throws Exception {
        try (HttpClient http = HttpClient.newHttpClient()) {
            return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + porta + caminho)).build(),
                    HttpResponse.BodyHandlers.ofString());
        }
    }
}
