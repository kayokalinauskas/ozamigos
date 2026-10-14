package dev.ozamigos;

import java.io.IOException;
import java.net.InetSocketAddress;
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
import org.springframework.web.socket.handler.SessionLimitExceededException;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.core.JacksonException;
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
    private final TentativasDeSenha tentativas;
    private final JsonMapper json;

    public SinalizacaoHandler(Salas salas, SenhaDoGrupo senhaDoGrupo, TentativasDeSenha tentativas, JsonMapper json) {
        this.salas = salas;
        this.senhaDoGrupo = senhaDoGrupo;
        this.tentativas = tentativas;
        this.json = json;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession sessao) {
        Map<String, Object> atributos = sessao.getAttributes();
        atributos.put("id", UUID.randomUUID().toString().substring(0, 8));
        atributos.put("ficha", UUID.randomUUID().toString());
        // Envios de threads diferentes na mesma sessão precisam ser em fila.
        atributos.put("segura", new ConcurrentWebSocketSessionDecorator(sessao, 5_000, 512 * 1024));
    }

    @Override
    protected void handleTextMessage(WebSocketSession sessao, TextMessage mensagem) throws IOException {
        JsonNode msg;
        try {
            msg = json.readTree(mensagem.getPayload());
        } catch (JacksonException e) {
            msg = null;
        }
        // Lixo no lugar de JSON responde com erro, em vez de derrubar a conexão com um erro do servidor.
        if (msg == null || !msg.isObject()) {
            erro(sessao, "mensagem-invalida");
            return;
        }
        String id = (String) sessao.getAttributes().get("id");
        String sala = (String) sessao.getAttributes().get("sala");
        String tipo = msg.path("tipo").asString("");

        if (sala == null && !tipo.equals("entrar")) {
            erro(sessao, "entre-numa-sala-primeiro");
            return;
        }
        switch (tipo) {
            case "entrar" -> entrar(sessao, id, msg.path("sala").asString(""), msg.path("senha").asString(""),
                    nomeLimpo(msg.path("nome").asString("")), msg.path("ficha").asString(""));
            case "comecei" -> comecei(sessao, id, sala);
            case "parei" -> parei(id, sala);
            case "assistir" -> assistir(id, sala, msg.path("para").asString(""));
            case "deixar" -> deixar(id, sala, msg.path("para").asString(""));
            case "oferta", "resposta", "candidato" -> repassar(sessao, id, sala, (ObjectNode) msg);
            case "gravar-sala" -> gravarSala(sessao, id, sala, msg.path("ligada").asBoolean(false));
            case "medidas" -> repassarMedidas(id, sala, (ObjectNode) msg);
            // Mantém a conexão viva; a resposta mostra ao cliente que o servidor ainda está ouvindo.
            case "ping" -> enviar(segura(sessao), json.createObjectNode().put("tipo", "pong"));
            default -> erro(sessao, "tipo-desconhecido");
        }
    }

    private void entrar(WebSocketSession sessao, String id, String codigo, String senha, String nome,
            String fichaAnterior) throws IOException {
        // A senha vem antes de tudo: sem ela, a pessoa não descobre nada sobre a sala.
        String endereco = endereco(sessao);
        if (tentativas.bloqueado(endereco)) {
            log.warn("{} bloqueado: senhas erradas demais de {}", id, endereco);
            erro(sessao, "muitas-tentativas");
            sessao.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        if (!senhaDoGrupo.confere(senha)) {
            log.info("{} errou a senha", id);
            tentativas.errou(endereco);
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
        // Reconexão: se a conexão antiga da mesma pessoa ainda consta na sala, ela sai agora
        // (senão ficaria uma pessoa fantasma ocupando lugar até o servidor perceber a queda).
        String anterior = salas.donoDaFicha(codigo, fichaAnterior);
        if (anterior != null) {
            WebSocketSession antiga = salas.sessao(codigo, anterior);
            retirar(codigo, anterior);
            fecharSemErro(antiga);
        }
        String ficha = (String) sessao.getAttributes().get("ficha");
        Salas.Entrada entrada = salas.entrar(codigo, id, nome, ficha, segura(sessao));
        if (entrada == null) {
            erro(sessao, "sala-cheia");
            sessao.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        sessao.getAttributes().put("sala", codigo);
        log.info("{} entrou na sala {}", id, codigo);

        ObjectNode boasVindas = json.createObjectNode()
                .put("tipo", "bem-vindo")
                .put("id", id)
                .put("ficha", ficha);
        ArrayNode outros = boasVindas.putArray("outros");
        entrada.outros().forEach((outroId, outroNome) -> outros.addObject().put("id", outroId).put("nome", outroNome));
        ArrayNode compartilhando = boasVindas.putArray("compartilhando");
        entrada.compartilhando().forEach(compartilhando::add);
        ObjectNode plateias = boasVindas.putObject("plateias");
        entrada.plateias().forEach((quem, ids) -> ids.forEach(plateias.putArray(quem)::add));
        if (entrada.gravador() != null) {
            boasVindas.putObject("gravando").put("id", entrada.gravador()).put("nome", salas.nome(codigo, entrada.gravador()));
        }
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

    /**
     * Gravação das estatísticas da sala: uma por vez, e todo mundo vê quem está gravando.
     * As medidas de cada um passam a ir para essa pessoa (veja repassarMedidas).
     */
    private void gravarSala(WebSocketSession sessao, String id, String sala, boolean ligada) throws IOException {
        if (ligada) {
            if (!salas.comecarAGravar(sala, id)) {
                erro(sessao, "sala-ja-gravando");
                return;
            }
            avisarGravacao(sala, id, true);
        } else if (salas.pararDeGravar(sala, id)) {
            avisarGravacao(sala, id, false);
        }
    }

    private void avisarGravacao(String sala, String id, boolean ligada) throws IOException {
        ObjectNode aviso = json.createObjectNode()
                .put("tipo", "gravacao-da-sala")
                .put("ligada", ligada)
                .put("id", id)
                .put("nome", salas.nome(sala, id));
        for (WebSocketSession pessoa : salas.todos(sala)) {
            enviar(pessoa, aviso);
        }
    }

    /**
     * As medidas de um segundo (o que a pessoa transmite e o que assiste) vão só para quem está gravando.
     * Sem gravação na sala, são descartadas: ninguém recebe medidas que não pediu.
     */
    private void repassarMedidas(String id, String sala, ObjectNode msg) throws IOException {
        String gravador = salas.gravador(sala);
        if (gravador == null || gravador.equals(id)) {
            return;
        }
        msg.put("de", id);
        enviar(salas.sessao(sala, gravador), msg);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession sessao, CloseStatus status) throws IOException {
        String id = (String) sessao.getAttributes().get("id");
        String sala = (String) sessao.getAttributes().get("sala");
        if (sala != null) {
            retirar(sala, id);
        }
    }

    /** Tira a pessoa da sala e avisa quem ficou. Se ela já tinha saído, não faz nada. */
    private void retirar(String sala, String id) throws IOException {
        Salas.Saida saida = salas.sair(sala, id);
        if (saida == null) {
            return;
        }
        log.info("{} saiu da sala {}", id, sala);
        ObjectNode saiu = json.createObjectNode().put("tipo", "saiu").put("id", id);
        for (WebSocketSession restante : saida.restantes()) {
            enviar(restante, saiu);
        }
        for (Map.Entry<String, List<String>> mudou : saida.plateiasQueMudaram().entrySet()) {
            avisarPlateia(sala, mudou.getKey(), mudou.getValue());
        }
        if (saida.gravacaoAcabou()) {
            ObjectNode aviso = json.createObjectNode().put("tipo", "gravacao-da-sala").put("ligada", false).put("id", id);
            for (WebSocketSession restante : saida.restantes()) {
                enviar(restante, aviso);
            }
        }
    }

    private static void fecharSemErro(WebSocketSession sessao) {
        if (sessao == null) {
            return;
        }
        try {
            sessao.close(CloseStatus.GOING_AWAY);
        } catch (IOException | RuntimeException e) {
            // a conexão antiga já estava morta: era exatamente o que queríamos
        }
    }

    /**
     * O nome aparece para os outros: sem caracteres de controle nem os que invertem a direção do texto
     * (que bagunçariam a lista da sala), sem espaços nas pontas, até 20 caracteres sem partir um emoji
     * ao meio, e "Amigo" se vier vazio.
     */
    static String nomeLimpo(String nome) {
        String limpo = nome.replaceAll("[\\p{Cc}\\x{202A}-\\x{202E}\\x{2066}-\\x{2069}]", "").strip();
        if (limpo.codePointCount(0, limpo.length()) > 20) {
            limpo = limpo.substring(0, limpo.offsetByCodePoints(0, 20)).strip();
        }
        return limpo.isEmpty() ? "Amigo" : limpo;
    }

    /** O endereço de quem conectou (o do X-Forwarded-For atrás de proxy), para o freio de senhas erradas. */
    private static String endereco(WebSocketSession sessao) {
        InetSocketAddress remoto = sessao.getRemoteAddress();
        if (remoto == null) {
            return "?";
        }
        return remoto.getAddress() != null ? remoto.getAddress().getHostAddress() : remoto.getHostString();
    }

    private WebSocketSession segura(WebSocketSession sessao) {
        return (WebSocketSession) sessao.getAttributes().get("segura");
    }

    private void erro(WebSocketSession sessao, String motivo) throws IOException {
        enviar(segura(sessao), json.createObjectNode().put("tipo", "erro").put("motivo", motivo));
    }

    /**
     * Uma conexão pode fechar entre o isOpen e o envio (duas pessoas saindo juntas), ou ser derrubada por estar
     * lenta demais para receber (fila cheia): essa falha fica só com ela. Sem isso, a exceção voltaria para quem
     * mandou a mensagem, e o Spring derrubaria também a conexão dela.
     */
    private void enviar(WebSocketSession destino, JsonNode msg) {
        if (destino == null || !destino.isOpen()) {
            return;
        }
        try {
            destino.sendMessage(new TextMessage(json.writeValueAsString(msg)));
        } catch (IOException | IllegalStateException | SessionLimitExceededException e) {
            log.debug("não deu para enviar para uma conexão que fechou: {}", e.getMessage());
        }
    }
}
