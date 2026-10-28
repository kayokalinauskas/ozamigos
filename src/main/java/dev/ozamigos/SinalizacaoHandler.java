package dev.ozamigos;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
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

import jakarta.annotation.PreDestroy;

/**
 * O servidor de sinalização: põe as pessoas em salas e repassa as mensagens
 * do WebRTC (oferta, resposta e candidatos) de um navegador para o outro.
 * O vídeo nunca passa por aqui.
 */
@Component
public class SinalizacaoHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(SinalizacaoHandler.class);
    /** O chat da sala: até tantos caracteres por mensagem, e no máximo CHAT_RAJADA mensagens a cada CHAT_JANELA_MS. */
    static final int CHAT_MAXIMO = 500;
    static final int CHAT_RAJADA = 5;
    static final long CHAT_JANELA_MS = 3_000;
    /**
     * Chamar a atenção de alguém: até CHAMADAS_POR_JANELA a cada CHAMADAS_JANELA_MS, para cada pessoa chamada (a mesma
     * regra está no cliente). Era uma por minuto; o dono preferiu até 5 (18/10/2026).
     */
    static final int CHAMADAS_POR_JANELA = 5;
    static final long CHAMADAS_JANELA_MS = 60_000;
    /**
     * Conexões abertas ao mesmo tempo por endereço, e quanto uma conexão pode ficar sem entrar numa sala (a página
     * manda o "entrar" assim que abre). Sem isso, qualquer um abria conexões sem conta que ficavam abertas para sempre.
     */
    static final int CONEXOES_POR_ENDERECO = 20;
    static final long SEM_SALA_NO_MAXIMO_MS = 10_000;

    private final Salas salas;
    private final JsonMapper json;
    private final PreviasDeLinks previas;
    private final Retransmissao retransmissao;
    private final Servidores servidores;
    private final Contas contas;
    /**
     * Uma trava por servidor (64 repartidas pelo código), só para a entrada na sala e a expulsão não se cruzarem; a
     * consulta ao banco (se a pessoa é membro) fica de fora, para um banco lento não enfileirar as entradas.
     */
    private final Object[] travasDosServidores = new Object[64];
    /**
     * Quando cada conta saiu de cada servidor à força (expulsa, saiu, o servidor apagado: a chave sem conta), na hora do
     * {@code System.nanoTime()}: quem foi conferido como membro antes disso não entra. Só o último minuto.
     */
    private final Map<String, Long> tiradosEm = new ConcurrentHashMap<>();
    private static final long LEMBRAR_TIRADOS_NS = 60_000_000_000L;
    /** As conexões abertas de cada endereço (só na memória, enquanto estão abertas). */
    private final Map<String, Integer> conexoesPorEndereco = new ConcurrentHashMap<>();
    private final ScheduledExecutorService relogio =
            Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().name("sinal").factory());

    public SinalizacaoHandler(Salas salas, JsonMapper json, PreviasDeLinks previas, Retransmissao retransmissao,
            Servidores servidores, Contas contas) {
        this.salas = salas;
        this.servidores = servidores;
        this.contas = contas;
        for (int i = 0; i < travasDosServidores.length; i++) {
            travasDosServidores[i] = new Object();
        }
        this.retransmissao = retransmissao;
        this.json = json;
        this.previas = previas;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession sessao) {
        Map<String, Object> atributos = sessao.getAttributes();
        atributos.put("id", UUID.randomUUID().toString().substring(0, 8));
        atributos.put("ficha", UUID.randomUUID().toString());
        // Envios de threads diferentes na mesma sessão precisam ser em fila.
        atributos.put("segura", new ConcurrentWebSocketSessionDecorator(sessao, 5_000, 512 * 1024));
        String endereco = Enderecos.de(sessao.getHandshakeHeaders(), sessao.getRemoteAddress());
        if (conexoesPorEndereco.merge(endereco, 1, Integer::sum) > CONEXOES_POR_ENDERECO) {
            conexoesPorEndereco.computeIfPresent(endereco, (e, n) -> n > 1 ? n - 1 : null);
            fecharSemErro(sessao); // a página tenta de novo depois de esperar
            return;
        }
        atributos.put("endereco", endereco); // conta na saída
        relogio.schedule(() -> {
            if (sessao.isOpen() && !sessao.getAttributes().containsKey("sala")) {
                fecharSemErro(sessao);
            }
        }, SEM_SALA_NO_MAXIMO_MS, TimeUnit.MILLISECONDS);
    }

    @PreDestroy
    void parar() {
        relogio.shutdownNow();
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
            // Sem `servidor` e com `senha`: uma página de antes de 28/10/2026, aberta durante o deploy (veja entrar).
            case "entrar" -> entrar(sessao, id, msg.path("servidor").asString(""), msg.path("ficha").asString(""),
                    !msg.has("servidor") && msg.has("senha"));
            case "comecei" -> comecei(sessao, id, sala);
            case "parei" -> parei(id, sala);
            case "assistir" -> assistir(id, sala, msg.path("para").asString(""));
            case "deixar" -> deixar(id, sala, msg.path("para").asString(""));
            case "oferta", "resposta", "candidato" -> repassar(sessao, id, sala, (ObjectNode) msg);
            case "gravar-sala" -> gravarSala(sessao, id, sala, msg.path("ligada").asBoolean(false));
            case "medidas" -> repassarMedidas(id, sala, (ObjectNode) msg);
            case "chat" -> chat(sessao, id, sala, msg.path("texto").asString(""));
            case "chamar" -> chamar(sessao, id, sala, msg.path("para").asString(""));
            // Mantém a conexão viva; a resposta mostra ao cliente que o servidor ainda está ouvindo.
            case "ping" -> enviar(segura(sessao), json.createObjectNode().put("tipo", "pong"));
            default -> erro(sessao, "tipo-desconhecido");
        }
    }

    /**
     * Entra na sala de um servidor salvo (Servidores): só com a conta (o cookie da sessão, lido na abertura do WebSocket:
     * ContaNoWebSocket) e sendo membro. Sem senha: quem entra é decidido pelos convites (decisão do dono, 28/10/2026:
     * as salas com senha, o grupo fixo e os grupos criados na hora saíram). A entrada na sala acontece segurando a trava
     * do servidor, a mesma da expulsão (tirarDoServidor), e não entra quem foi tirado depois de conferido.
     *
     * <p>{@code pedidoAntigo}: a página de antes das contas, ainda aberta, reconectando depois do deploy. Recebe
     * {@code senha-errada}, a recusa que ela conhece: volta para a entrada dela e para de tentar (com um motivo que ela
     * não conhece, tentaria de novo a cada 10 s, para sempre). Recarregando, vem a página nova.
     */
    private void entrar(WebSocketSession sessao, String id, String servidor, String fichaAnterior, boolean pedidoAntigo)
            throws IOException {
        if (pedidoAntigo) {
            recusar(sessao, "senha-errada");
            return;
        }
        Salas.Conta conta = (Salas.Conta) sessao.getAttributes().get(ContaNoWebSocket.CONTA);
        long conferidoEm = System.nanoTime();
        String recusa = recusaDoServidor(servidor, conta);
        if (recusa != null) {
            recusar(sessao, recusa);
            return;
        }
        synchronized (trava(servidor)) {
            if (tiradoDepois(servidor, conta.id(), conferidoEm)) {
                recusar(sessao, "servidor-nao-existe");
                return;
            }
            entrarJa(sessao, id, servidor, conta, fichaAnterior);
        }
    }

    private boolean tiradoDepois(String servidor, String conta, long conferidoEm) {
        for (String chave : new String[] {servidor + "|" + conta, servidor + "|*"}) {
            Long quando = tiradosEm.get(chave);
            if (quando != null && quando - conferidoEm > 0) {
                return true;
            }
        }
        return false;
    }

    private Object trava(String servidor) {
        return travasDosServidores[Math.floorMod(servidor.hashCode(), travasDosServidores.length)];
    }

    private void entrarJa(WebSocketSession sessao, String id, String servidor, Salas.Conta conta, String fichaAnterior)
            throws IOException {
        if (sessao.getAttributes().containsKey("sala")) {
            erro(sessao, "ja-esta-numa-sala");
            return;
        }
        // O nome é o da conta: ninguém entra com o nome de outra pessoa.
        String nome = (String) sessao.getAttributes().get(ContaNoWebSocket.NOME);
        String endereco = Enderecos.de(sessao.getHandshakeHeaders(), sessao.getRemoteAddress());
        String codigo = Servidores.sala(servidor);
        // Reconexão: se a conexão antiga da mesma pessoa ainda consta na sala, ela sai agora
        // (senão ficaria uma pessoa fantasma ocupando lugar até o servidor perceber a queda).
        String anterior = salas.donoDaFicha(codigo, fichaAnterior);
        if (anterior != null) {
            WebSocketSession antiga = salas.sessao(codigo, anterior);
            retirar(codigo, anterior);
            fecharSemErro(antiga);
        }
        String ficha = (String) sessao.getAttributes().get("ficha");
        Salas.Entrada entrada = salas.entrar(codigo, id, nome, conta, ficha, segura(sessao));
        if (entrada == null) {
            erro(sessao, "sala-cheia");
            sessao.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        sessao.getAttributes().put("sala", codigo);
        log.info("{} ({}) entrou num servidor", id, nome); // o nome do servidor é escolhido pelas pessoas: não vai para o log

        ObjectNode boasVindas = json.createObjectNode()
                .put("tipo", "bem-vindo")
                .put("id", id)
                .put("ficha", ficha)
                .put("nome", nome);
        contaEm(boasVindas, conta);
        ArrayNode outros = boasVindas.putArray("outros");
        entrada.outros().forEach((outroId, outro) -> {
            ObjectNode pessoa = outros.addObject().put("id", outroId).put("nome", outro.nome());
            if (outro.conta() != null) {
                contaEm(pessoa, outro.conta());
            }
        });
        ArrayNode compartilhando = boasVindas.putArray("compartilhando");
        entrada.compartilhando().forEach(compartilhando::add);
        ObjectNode plateias = boasVindas.putObject("plateias");
        entrada.plateias().forEach((quem, ids) -> ids.forEach(plateias.putArray(quem)::add));
        // A retransmissão vem já no bem-vindo: a pessoa liga a voz para todos logo que o recebe.
        // "retransmissao" é a do vídeo: a página de antes (aberta antes do deploy) a usa também na voz, como antes.
        WebSocketSession segura = segura(sessao);
        Retransmissao.Credenciais credenciais = retransmissao.entrou(id, nome, endereco, conta.id(),
                novas -> enviar(segura, mensagemDaRetransmissao(novas)));
        if (credenciais != null) {
            boasVindas.set("retransmissao", credenciais.video());
            boasVindas.set("retransmissaoDaVoz", credenciais.voz());
            if (credenciais.limiteDoVideo() != null) {
                boasVindas.put("limiteDoVideo", credenciais.limiteDoVideo());
            }
        }
        if (entrada.gravador() != null) {
            boasVindas.putObject("gravando").put("id", entrada.gravador()).put("nome", salas.nome(codigo, entrada.gravador()));
        }
        enviar(segura(sessao), boasVindas);

        // Só quem já estava quando entrei: quem entrou depois (ao mesmo tempo, como todos voltando depois de um
        // deploy) já me recebeu na lista do "bem-vindo", e com o "entrou" também me via duas vezes.
        ObjectNode entrou = json.createObjectNode().put("tipo", "entrou").put("id", id).put("nome", nome);
        contaEm(entrou, conta);
        for (WebSocketSession outro : entrada.avisar()) {
            enviar(outro, entrou);
        }
    }

    /**
     * Por que a pessoa não entra na sala do servidor salvo, ou null: entra. Quem não é membro recebe o mesmo de um
     * servidor que não existe. Com o banco fora do ar, ninguém entra (os grupos e o grupo fixo continuam funcionando).
     */
    private String recusaDoServidor(String servidor, Salas.Conta conta) {
        if (conta == null) {
            return "sem-conta";
        }
        if (!contas.disponivel()) {
            return "servidores-indisponiveis";
        }
        try {
            return servidores.papel(servidor, UUID.fromString(conta.id())).isPresent() ? null : "servidor-nao-existe";
        } catch (DataAccessException e) {
            contas.bancoFalhou();
            log.warn("Servidores: o banco não respondeu ({})", e.getMostSpecificCause().getMessage());
            return "servidores-indisponiveis";
        }
    }

    /**
     * Tira da sala de um servidor salvo as conexões de uma conta (expulsa), ou todas ({@code conta} null: o servidor
     * foi apagado). Cada uma recebe o motivo e fecha; a saída segue o caminho de sempre (afterConnectionClosed).
     */
    public void tirarDoServidor(String servidor, UUID conta, String motivo) {
        ObjectNode aviso = json.createObjectNode().put("tipo", "erro").put("motivo", motivo);
        synchronized (trava(servidor)) {
            long agora = System.nanoTime();
            tiradosEm.values().removeIf(quando -> agora - quando > LEMBRAR_TIRADOS_NS);
            tiradosEm.put(servidor + "|" + (conta == null ? "*" : conta), agora);
            for (WebSocketSession pessoa : salas.daConta(Servidores.sala(servidor), conta == null ? null : conta.toString())) {
                enviar(pessoa, aviso);
                try {
                    pessoa.close(CloseStatus.POLICY_VIOLATION);
                } catch (IOException | RuntimeException e) {
                    // já tinha fechado: era o que queríamos
                }
            }
        }
    }

    /** Tira a conta das salas de todos os servidores salvos em que ela está (a conta foi apagada). */
    public void tirarDosServidores(UUID conta, String motivo) {
        for (String sala : salas.salasDaConta(conta.toString(), Servidores.sala(""))) {
            tirarDoServidor(sala.substring(Servidores.sala("").length()), conta, motivo);
        }
    }

    /** A conta de uma pessoa, nas mensagens: o id (que reconhece a pessoa na página) e a foto, se tiver. */
    private static void contaEm(ObjectNode pessoa, Salas.Conta conta) {
        pessoa.put("conta", conta.id());
        if (conta.foto() != null) {
            pessoa.put("foto", conta.foto());
        }
    }

    /**
     * As credenciais da retransmissão que valem agora: as do vídeo em {@code servidores} (o nome de antes, que a página
     * de antes usa para tudo) e as da voz em {@code voz}. A lista vazia: aquele uso foi cortado, e as conexões novas dele
     * vão só direto; {@code limiteDoVideo} diz por quê.
     */
    private ObjectNode mensagemDaRetransmissao(Retransmissao.Credenciais credenciais) {
        ObjectNode mensagem = json.createObjectNode().put("tipo", "retransmissao");
        mensagem.set("servidores", credenciais.video());
        mensagem.set("voz", credenciais.voz());
        if (credenciais.limiteDoVideo() != null) {
            mensagem.put("limiteDoVideo", credenciais.limiteDoVideo());
        }
        return mensagem;
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

    /**
     * O chat da sala só repassa: a mensagem vai para todos da sala (quem mandou também, e é assim que ela sabe que
     * chegou) e o servidor não guarda nada. Quem entra depois não vê o que foi dito antes. O texto nunca vai para o
     * registro do servidor.
     */
    private void chat(WebSocketSession sessao, String id, String sala, String texto) throws IOException {
        String limpo = textoDoChat(texto);
        if (limpo.isEmpty()) {
            return;
        }
        if (!cabeNoChat(sessao)) {
            erro(sessao, "chat-rapido-demais");
            return;
        }
        ObjectNode mensagem = json.createObjectNode().put("tipo", "chat").put("de", id).put("texto", limpo);
        for (WebSocketSession pessoa : salas.todos(sala)) {
            enviar(pessoa, mensagem);
        }
        // Um link de vídeo (YouTube, Twitch...): a prévia vai para a sala logo depois, quando o servidor a tiver.
        String link = PreviasDeLinks.primeiroLink(limpo);
        if (link != null) {
            previas.buscar(link).thenAccept(previa -> previa.ifPresent(p -> mandarPrevia(sala, p)));
        }
    }

    private void mandarPrevia(String sala, PreviasDeLinks.Previa previa) {
        ObjectNode mensagem = json.createObjectNode().put("tipo", "previa").put("url", previa.url()).put("site", previa.site());
        if (previa.titulo() != null) {
            mensagem.put("titulo", previa.titulo());
        }
        if (previa.autor() != null) {
            mensagem.put("autor", previa.autor());
        }
        if (previa.miniatura() != null) {
            mensagem.put("miniatura", previa.miniatura());
        }
        if (previa.aoVivo()) {
            mensagem.put("aoVivo", true);
        }
        for (WebSocketSession pessoa : salas.todos(sala)) {
            enviar(pessoa, mensagem);
        }
    }

    /**
     * Chamar a atenção de alguém da sala (quem voltou para o PC chamando quem está com o som desligado): vai só para
     * essa pessoa, que ouve um som mesmo com o som do Ozamigos desligado. Por isso o freio é aqui, e não só no cliente:
     * até CHAMADAS_POR_JANELA a cada CHAMADAS_JANELA_MS para cada pessoa chamada.
     */
    private void chamar(WebSocketSession sessao, String id, String sala, String para) throws IOException {
        WebSocketSession destino = para.equals(id) ? null : salas.sessao(sala, para);
        if (destino == null) {
            erro(sessao, "destinatario-nao-esta-na-sala");
            return;
        }
        @SuppressWarnings("unchecked")
        Map<String, Deque<Long>> chamadas = (Map<String, Deque<Long>>) sessao.getAttributes().computeIfAbsent("chamadas", c -> new HashMap<String, Deque<Long>>());
        long agora = System.nanoTime();
        synchronized (chamadas) {
            Deque<Long> recentes = chamadas.computeIfAbsent(para, p -> new ArrayDeque<>());
            while (!recentes.isEmpty() && agora - recentes.peekFirst() >= CHAMADAS_JANELA_MS * 1_000_000) {
                recentes.removeFirst();
            }
            if (recentes.size() >= CHAMADAS_POR_JANELA) {
                erro(sessao, "chamar-cedo-demais");
                return;
            }
            recentes.addLast(agora);
        }
        enviar(destino, json.createObjectNode().put("tipo", "chamado").put("de", id));
    }

    /** Mais uma mensagem cabe na rajada desta pessoa? Guarda a hora das últimas na própria sessão. */
    private static boolean cabeNoChat(WebSocketSession sessao) {
        @SuppressWarnings("unchecked")
        Deque<Long> ultimas = (Deque<Long>) sessao.getAttributes().computeIfAbsent("chat", chave -> new ArrayDeque<Long>());
        long agora = System.nanoTime();
        synchronized (ultimas) {
            while (!ultimas.isEmpty() && agora - ultimas.peekFirst() > CHAT_JANELA_MS * 1_000_000) {
                ultimas.removeFirst();
            }
            if (ultimas.size() >= CHAT_RAJADA) {
                return false;
            }
            ultimas.addLast(agora);
            return true;
        }
    }

    /**
     * O texto do chat como os outros vão ver: sem caracteres de controle (quebras de linha viram espaço) nem os que
     * invertem a direção do texto, sem espaços nas pontas, e até CHAT_MAXIMO caracteres sem partir um emoji ao meio.
     */
    static String textoDoChat(String texto) {
        return semControles(texto.replaceAll("[\\r\\n\\t]+", " "), CHAT_MAXIMO);
    }

    /**
     * Sem caracteres de controle nem os que invertem a direção do texto, sem espaços nas pontas, e até {@code maximo}
     * caracteres sem partir um emoji ao meio: a regra de tudo o que uma pessoa escreve e as outras veem (chat, nomes).
     */
    static String semControles(String texto, int maximo) {
        String limpo = texto.replaceAll("[\\p{Cc}\\x{202A}-\\x{202E}\\x{2066}-\\x{2069}]", "").strip();
        if (limpo.codePointCount(0, limpo.length()) > maximo) {
            limpo = limpo.substring(0, limpo.offsetByCodePoints(0, maximo)).strip();
        }
        return limpo;
    }

    @Override
    public void afterConnectionClosed(WebSocketSession sessao, CloseStatus status) throws IOException {
        String id = (String) sessao.getAttributes().get("id");
        String sala = (String) sessao.getAttributes().get("sala");
        String endereco = (String) sessao.getAttributes().get("endereco");
        if (endereco != null) {
            conexoesPorEndereco.computeIfPresent(endereco, (e, n) -> n > 1 ? n - 1 : null);
        }
        retransmissao.saiu(id);
        if (sala != null) {
            retirar(sala, id);
        }
    }

    /** Tira a pessoa da sala e avisa quem ficou. Se ela já tinha saído, não faz nada. */
    private void retirar(String sala, String id) throws IOException {
        // O nome vai para o log junto com o id (pedido do dono, 26/10/2026; a política de privacidade fala dele). Já
        // limpo por nomeLimpo: sem quebras de linha nem caracteres de controle, ninguém escreve linhas falsas no log.
        String nome = salas.nome(sala, id);
        Salas.Saida saida = salas.sair(sala, id);
        if (saida == null) {
            return;
        }
        log.info("{} ({}) saiu de um servidor", id, nome);
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
        String limpo = semControles(nome, 20);
        return limpo.isEmpty() ? "Amigo" : limpo;
    }

    private WebSocketSession segura(WebSocketSession sessao) {
        return (WebSocketSession) sessao.getAttributes().get("segura");
    }

    /** Recusado na entrada: o motivo, e a conexão fecha (abrir outra é o "tentar de novo"). */
    private void recusar(WebSocketSession sessao, String motivo) throws IOException {
        erro(sessao, motivo);
        sessao.close(CloseStatus.POLICY_VIOLATION);
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
