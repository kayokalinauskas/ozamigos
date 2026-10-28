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

/**
 * Os limites de todo pedido no servidor de verdade (o filtro registrado, a ordem dele e o endereço de cada um): os
 * outros testes sobem o limite por minuto (ComBanco), e o Contador sozinho não prova que o freio está ligado. Sem banco.
 */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = "ozamigos.limite.api-por-minuto=3")
class LimitesDaApiTest {

    @LocalServerPort
    private int porta;

    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void cadaEnderecoTemOSeuLimiteDePedidosAApi() throws Exception {
        for (int i = 0; i < 3; i++) {
            assertThat(eu("198.51.100.30").statusCode()).isEqualTo(200);
        }

        HttpResponse<String> recusado = eu("198.51.100.30");
        assertThat(recusado.statusCode()).isEqualTo(429);
        assertThat(recusado.body()).contains("muitas-tentativas");
        assertThat(eu("198.51.100.31").statusCode()).isEqualTo(200);
    }

    @Test
    void aConexaoQueNaoEntraNumaSalaFecha() throws Exception {
        ClienteDaSala parada = ClienteDaSala.conectar(porta, null, "198.51.100.32");

        long limite = System.nanoTime() + SinalizacaoHandler.SEM_SALA_NO_MAXIMO_MS * 1_000_000 + 5_000_000_000L;
        while (!parada.fechou && System.nanoTime() < limite) {
            Thread.sleep(100);
        }
        assertThat(parada.fechou).isTrue();
    }

    private HttpResponse<String> eu(String endereco) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + porta + "/api/eu"))
                .header("CF-Connecting-IP", endereco).build(), HttpResponse.BodyHandlers.ofString());
    }
}
