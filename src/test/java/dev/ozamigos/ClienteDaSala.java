package dev.ozamigos;

import java.net.URI;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Uma página de mentira na sala, para os testes com conta: conecta com o cookie da sessão e um endereço. */
class ClienteDaSala extends TextWebSocketHandler {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    final BlockingQueue<JsonNode> recebidas = new LinkedBlockingQueue<>();
    volatile boolean fechou;
    WebSocketSession sessao;

    static ClienteDaSala conectar(int porta, String cookie, String endereco) throws Exception {
        WebSocketHttpHeaders cabecalhos = new WebSocketHttpHeaders();
        cabecalhos.add("CF-Connecting-IP", endereco);
        if (cookie != null) {
            cabecalhos.add("Cookie", cookie);
        }
        ClienteDaSala cliente = new ClienteDaSala();
        cliente.sessao = new StandardWebSocketClient()
                .execute(cliente, cabecalhos, URI.create("ws://localhost:" + porta + "/sinal"))
                .get(5, TimeUnit.SECONDS);
        return cliente;
    }

    @Override
    protected void handleTextMessage(WebSocketSession s, TextMessage m) {
        recebidas.add(JSON.readTree(m.getPayload()));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
        fechou = true;
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

    /** Espera um erro e devolve o motivo. */
    String esperarErro() throws InterruptedException {
        return esperar("erro").path("motivo").asString();
    }
}
