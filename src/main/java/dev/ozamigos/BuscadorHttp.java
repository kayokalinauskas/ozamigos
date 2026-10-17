package dev.ozamigos;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import org.springframework.stereotype.Component;

/** O Buscador de verdade, com o cliente HTTP do Java. */
@Component
class BuscadorHttp implements Buscador {

    // Um robô que diz quem é: os sites de vídeo mandam as metatags de prévia para robôs (a Twitch, por exemplo).
    private static final String AGENTE = "Mozilla/5.0 (compatible; OzamigosBot/1.0; +https://kayokalinauskas.github.io/ozamigos/)";

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Override
    public Resposta buscar(URI endereco, int maximoDeBytes) throws IOException, InterruptedException {
        HttpRequest pedido = HttpRequest.newBuilder(endereco)
                .timeout(Duration.ofSeconds(6))
                .header("User-Agent", AGENTE)
                .header("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8")
                .GET()
                .build();
        HttpResponse<InputStream> resposta = http.send(pedido, HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream corpo = resposta.body()) {
            byte[] bytes = corpo.readNBytes(maximoDeBytes + 1);
            if (bytes.length > maximoDeBytes) {
                throw new IOException("resposta grande demais");
            }
            return new Resposta(
                    resposta.statusCode(),
                    resposta.headers().firstValue("content-type").orElse(""),
                    bytes,
                    resposta.headers().firstValue("location").orElse(null));
        }
    }
}
