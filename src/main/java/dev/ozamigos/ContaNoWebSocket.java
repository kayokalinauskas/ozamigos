package dev.ozamigos;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

/**
 * Na abertura do WebSocket da sala, lê o cookie da sessão (Sessoes) e guarda nos atributos quem é a pessoa: o
 * SinalizacaoHandler usa o nome da conta e manda a conta para a sala. Sem cookie, ou com o banco fora do ar, a pessoa
 * entra como convidada: a conexão nunca é recusada por causa da conta.
 */
@Component
public class ContaNoWebSocket implements HandshakeInterceptor {

    static final String CONTA = "conta";
    static final String NOME = "nomeDaConta";

    private final Sessoes sessoes;
    private final Contas contas;

    public ContaNoWebSocket(Sessoes sessoes, Contas contas) {
        this.sessoes = sessoes;
        this.contas = contas;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest pedido, ServerHttpResponse resposta, WebSocketHandler handler,
            Map<String, Object> atributos) {
        Optional<UUID> usuario = sessoes.usuario(Sessoes.segredoDe(pedido.getHeaders()));
        if (usuario.isEmpty()) {
            return true;
        }
        try {
            contas.usuario(usuario.get()).ifPresent(conta -> {
                atributos.put(CONTA, new Salas.Conta(conta.id().toString(), ContaApi.enderecoDaFoto(conta)));
                atributos.put(NOME, conta.nome());
            });
        } catch (RuntimeException erro) {
            // O banco caiu entre as duas consultas: convidada desta vez.
        }
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest pedido, ServerHttpResponse resposta, WebSocketHandler handler,
            Exception erro) {}
}
