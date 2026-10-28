package dev.ozamigos;

import java.util.Map;

import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

/**
 * Na abertura do WebSocket da sala, lê o cookie da sessão (Sessoes) e guarda nos atributos quem é a pessoa: o
 * SinalizacaoHandler usa o nome da conta e manda a conta para a sala. Sem cookie, ou com o banco fora do ar, a conexão
 * abre do mesmo jeito: é o "entrar" que recusa ({@code sem-conta}, {@code servidores-indisponiveis}), com o motivo.
 */
@Component
public class ContaNoWebSocket implements HandshakeInterceptor {

    static final String CONTA = "conta";
    static final String NOME = "nomeDaConta";

    private final Sessoes sessoes;

    public ContaNoWebSocket(Sessoes sessoes) {
        this.sessoes = sessoes;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest pedido, ServerHttpResponse resposta, WebSocketHandler handler,
            Map<String, Object> atributos) {
        // Uma consulta só (Sessoes.conta): esta roda a cada entrada numa sala, e todos voltam juntos depois de um deploy.
        sessoes.conta(Sessoes.segredoDe(pedido.getHeaders())).ifPresent(conta -> {
            atributos.put(CONTA, new Salas.Conta(conta.id().toString(), ContaApi.enderecoDaFoto(conta)));
            atributos.put(NOME, conta.nome());
        });
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest pedido, ServerHttpResponse resposta, WebSocketHandler handler,
            Exception erro) {}
}
