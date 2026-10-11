package dev.ozamigos;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * O servidor de sinalização: põe as pessoas em salas e repassa as mensagens
 * do WebRTC (oferta, resposta e candidatos) de um navegador para o outro.
 * O vídeo nunca passa por aqui.
 */
@Component
public class SinalizacaoHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(SinalizacaoHandler.class);
    private static final Pattern CODIGO_VALIDO = Pattern.compile("[A-Za-z0-9]{6,20}");

    private final Salas salas;
    private final SenhaDoGrupo senhaDoGrupo;
    private final JsonMapper json;

    public SinalizacaoHandler(Salas salas, SenhaDoGrupo senhaDoGrupo, JsonMapper json) {
        this.salas = salas;
        this.senhaDoGrupo = senhaDoGrupo;
        this.json = json;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession sessao) {
        Map<String, Object> atributos = sessao.getAttributes();
        atributos.put("id", UUID.randomUUID().toString().substring(0, 8));
        // Envios de threads diferentes na mesma sessão precisam ser em fila.
        atributos.put("segura", new ConcurrentWebSocketSessionDecorator(sessao, 5_000, 512 * 1024));
    }

    @Override
    protected void handleTextMessage(WebSocketSession sessao, TextMessage mensagem) throws IOException {
        JsonNode msg = json.readTree(mensagem.getPayload());
        String id = (String) sessao.getAttributes().get("id");
        String sala = (String) sessao.getAttributes().get("sala");
        String tipo = msg.path("tipo").asString("");

        if (sala == null && !tipo.equals("entrar")) {
            erro(sessao, "entre-numa-sala-primeiro");
            return;
        }
        switch (tipo) {
            case "entrar" -> entrar(sessao, id, msg.path("sala").asString(""), msg.path("senha").asString(""),
                    nomeLimpo(msg.path("nome").asString("")));
            case "comecei" -> comecei(sessao, id, sala);
            case "parei" -> parei(id, sala);
            case "assistir" -> assistir(id, sala, msg.path("para").asString(""));
            case "deixar" -> deixar(id, sala, msg.path("para").asString(""));
            case "oferta", "resposta", "candidato" -> repassar(sessao, id, sala, (ObjectNode) msg);
            case "ping" -> { } // só mantém a conexão viva
            default -> erro(sessao, "tipo-desconhecido");
        }
    }

    private void entrar(WebSocketSession sessao, String id, String codigo, String senha, String nome)
            throws IOException {
        // A senha vem antes de tudo: sem ela, a pessoa não descobre nada sobre a sala.
        if (!senhaDoGrupo.confere(senha)) {
            log.info("{} errou a senha", id);
            erro(sessao, "senha-errada");
            sessao.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        if (sessao.getAttributes().containsKey("sala")) {
            erro(sessao, "ja-esta-numa-sala");
            return;
        }
        if (!CODIGO_VALIDO.matcher(codigo).matches()) {
            erro(sessao, "codigo-invalido");
            return;
        }
        Salas.Entrada entrada = salas.entrar(codigo, id, nome, segura(sessao));
        if (entrada == null) {
            erro(sessao, "sala-cheia");
            sessao.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        sessao.getAttributes().put("sala", codigo);
        log.info("{} entrou na sala {}", id, codigo);

        ObjectNode boasVindas = json.createObjectNode()
                .put("tipo", "bem-vindo")
                .put("id", id);
        ArrayNode outros = boasVindas.putArray("outros");
        entrada.outros().forEach((outroId, outroNome) -> outros.addObject().put("id", outroId).put("nome", outroNome));
        ArrayNode compartilhando = boasVindas.putArray("compartilhando");
        entrada.compartilhando().forEach(compartilhando::add);
        ObjectNode plateias = boasVindas.putObject("plateias");
        entrada.plateias().forEach((quem, ids) -> ids.forEach(plateias.putArray(quem)::add));
        enviar(segura(sessao), boasVindas);

        ObjectNode entrou = json.createObjectNode().put("tipo", "entrou").put("id", id).put("nome", nome);
        for (WebSocketSession outro : salas.outros(codigo, id)) {
            enviar(outro, entrou);
        }
    }

    private void comecei(WebSocketSession sessao, String id, String sala) throws IOException {
        if (!salas.comecarACompartilhar(sala, id)) {
            return; // já estava compartilhando
        }
        enviar(segura(sessao), json.createObjectNode().put("tipo", "pode-compartilhar"));
        ObjectNode aviso = json.createObjectNode().put("tipo", "compartilhando").put("id", id);
        for (WebSocketSession outro : salas.outros(sala, id)) {
            enviar(outro, aviso);
        }
    }

    private void parei(String id, String sala) throws IOException {
        if (salas.pararDeCompartilhar(sala, id)) {
            ObjectNode aviso = json.createObjectNode().put("tipo", "parou").put("id", id);
            for (WebSocketSession outro : salas.outros(sala, id)) {
                enviar(outro, aviso);
            }
        }
    }

    /** Quem quer assistir avisa quem transmite (que então manda a oferta) e a sala inteira vê a plateia nova. */
    private void assistir(String id, String sala, String alvo) throws IOException {
        List<String> plateia = salas.assistir(sala, id, alvo);
        if (plateia == null) {
            return; // alvo parou de transmitir, saiu, ou já estava assistindo
        }
        enviar(salas.sessao(sala, alvo), json.createObjectNode().put("tipo", "assistir").put("de", id));
        avisarPlateia(sala, alvo, plateia);
    }

    private void deixar(String id, String sala, String alvo) throws IOException {
        List<String> plateia = salas.deixarDeAssistir(sala, id, alvo);
        if (plateia == null) {
            return;
        }
        enviar(salas.sessao(sala, alvo), json.createObjectNode().put("tipo", "deixar").put("de", id));
        avisarPlateia(sala, alvo, plateia);
    }

    private void avisarPlateia(String sala, String quem, List<String> plateia) throws IOException {
        ObjectNode aviso = json.createObjectNode().put("tipo", "plateia").put("id", quem);
        plateia.forEach(aviso.putArray("ids")::add);
        for (WebSocketSession pessoa : salas.todos(sala)) {
            enviar(pessoa, aviso);
        }
    }

    /** Oferta, resposta e candidato vão só para o destinatário, e só dentro da mesma sala. */
    private void repassar(WebSocketSession sessao, String id, String sala, ObjectNode msg) throws IOException {
        WebSocketSession destino = salas.sessao(sala, msg.path("para").asString(""));
        if (destino == null) {
            erro(sessao, "destinatario-nao-esta-na-sala");
            return;
        }
        msg.remove("para");
        msg.put("de", id); // quem enviou é o servidor que diz, nunca o cliente
        enviar(destino, msg);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession sessao, CloseStatus status) throws IOException {
        String id = (String) sessao.getAttributes().get("id");
        String sala = (String) sessao.getAttributes().get("sala");
        if (sala == null) {
            return;
        }
        Salas.Saida saida = salas.sair(sala, id);
        log.info("{} saiu da sala {}", id, sala);
        ObjectNode saiu = json.createObjectNode().put("tipo", "saiu").put("id", id);
        for (WebSocketSession restante : saida.restantes()) {
            enviar(restante, saiu);
        }
        for (Map.Entry<String, List<String>> mudou : saida.plateiasQueMudaram().entrySet()) {
            avisarPlateia(sala, mudou.getKey(), mudou.getValue());
        }
    }

    /** O nome aparece para os outros: sem espaços nas pontas, até 20 caracteres, "Amigo" se vier vazio. */
    private static String nomeLimpo(String nome) {
        String limpo = nome.strip();
        if (limpo.isEmpty()) {
            return "Amigo";
        }
        return limpo.length() > 20 ? limpo.substring(0, 20) : limpo;
    }

    private WebSocketSession segura(WebSocketSession sessao) {
        return (WebSocketSession) sessao.getAttributes().get("segura");
    }

    private void erro(WebSocketSession sessao, String motivo) throws IOException {
        enviar(segura(sessao), json.createObjectNode().put("tipo", "erro").put("motivo", motivo));
    }

    private void enviar(WebSocketSession destino, JsonNode msg) throws IOException {
        if (destino != null && destino.isOpen()) {
            destino.sendMessage(new TextMessage(json.writeValueAsString(msg)));
        }
    }
}
