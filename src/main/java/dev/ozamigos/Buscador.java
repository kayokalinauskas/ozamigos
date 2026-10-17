package dev.ozamigos;

import java.io.IOException;
import java.net.URI;

/**
 * Busca um endereço da internet para as prévias de links do chat: só GET, sem cookies, sem seguir redirecionamentos
 * sozinho (quem chama confere cada destino) e com um tamanho máximo. Uma interface para os testes não dependerem da
 * internet.
 */
public interface Buscador {

    /** redirecionaPara: o Location de um 3xx, ou null. */
    record Resposta(int status, String tipo, byte[] corpo, String redirecionaPara) {}

    /** Lança se a rede falhar, se demorar demais ou se a resposta passar de maximoDeBytes. */
    Resposta buscar(URI endereco, int maximoDeBytes) throws IOException, InterruptedException;
}
