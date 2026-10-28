package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;

/**
 * A sinalização de ponta a ponta no servidor: clientes WebSocket de verdade contra o Tomcat numa porta aleatória. As
 * salas são as dos servidores salvos, então cada pessoa é uma conta de verdade no banco, membro do servidor do teste.
 */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class SinalizacaoTest extends ComBanco {

    @LocalServerPort
    private int porta;

    @Autowired
    private JsonMapper json;
    @Autowired
    private VidaDoBanco vida;
    @Autowired
    private Contas contas;
    @Autowired
    private Sessoes sessoes;
    @Autowired
    private Servidores servidores;

    private final List<Cliente> abertos = new ArrayList<>();
    // Cada teste num servidor só dele (o servidor do Spring é o mesmo para todos os testes da classe).
    private String sala;
    /** O dono de cada servidor do teste: é quem convida os membros. */
    private final Map<String, UUID> donos = new HashMap<>();

    @BeforeEach
    void servidorDoTeste() throws InterruptedException {
        esperarPronto(vida);
        sala = outroServidor();
    }

    @AfterEach
    void fecharTodos() throws Exception {
        for (Cliente c : abertos) {
            if (c.sessao.isOpen()) {
                c.sessao.close();
            }
        }
    }

    @Test
    void semContaNinguemEntraEAConexaoFecha() throws Exception {
        Cliente convidado = conectar(null);

        convidado.enviar(pedidoDeEntrada(sala, ""));

        assertThat(convidado.esperar("erro").path("motivo").asString()).isEqualTo("sem-conta");
        assertThat(convidado.fechou.poll(5, TimeUnit.SECONDS)).isEqualTo(CloseStatus.POLICY_VIOLATION.getCode());
    }

    @Test
    void oChatChegaATodosDaSalaComQuemMandouCarimbadoESoNela() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        Cliente beto = entrar(sala, "Beto");
        Cliente caio = entrar(outroServidor(), "Caio");

        ana.enviar("{\"tipo\":\"chat\",\"texto\":\"  bora\\njogar?  \",\"de\":\"forjado\"}");

        for (Cliente quem : List.of(ana, beto)) {
            JsonNode msg = quem.esperar("chat");
            assertThat(msg.path("de").asString()).isEqualTo(ana.id); // quem mandou é o servidor que diz
            assertThat(msg.path("texto").asString()).isEqualTo("bora jogar?");
        }
        assertThat(caio.recebeu("chat")).isFalse();
    }

    /** Sem internet nos testes: o "YouTube" responde só o título e o canal. */
    @TestConfiguration
    static class SemInternet {
        @Bean
        @Primary
        Buscador buscadorFalso() {
            return (endereco, maximo) -> endereco.getHost().equals("www.youtube.com")
                    ? new Buscador.Resposta(200, "application/json", "{\"title\":\"A jogada\",\"author_name\":\"Canal\"}".getBytes(StandardCharsets.UTF_8), null)
                    : new Buscador.Resposta(404, "", new byte[0], null);
        }

        /** Uma Cloudflare falsa, com o consumo zerado: a retransmissão fica ligada nos testes. */
        @Bean
        @Primary
        Retransmissao retransmissaoFalsa(JsonMapper json) {
            AtomicInteger geradas = new AtomicInteger();
            Retransmissao.Cloudflare cloudflare = new Retransmissao.Cloudflare() {
                @Override
                public Credencial gerar(Duration validade) {
                    String usuario = "u" + geradas.incrementAndGet();
                    ArrayNode servidores = json.createArrayNode();
                    servidores.addObject().put("username", usuario).put("credential", "x").putArray("urls").add("turn:turn.exemplo:3478");
                    return new Credencial(usuario, servidores);
                }

                @Override
                public void revogar(String usuario) {}

                @Override
                public Consumo consumo(LocalDate desde, LocalDate hoje) {
                    return new Consumo(0, Map.of());
                }
            };
            return new Retransmissao(cloudflare, json, Clock.systemUTC(), false);
        }
    }

    @Test
    void umLinkDeVideoNoChatTrazAPreviaParaTodosDaSala() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        Cliente beto = entrar(sala, "Beto");

        ana.enviar("{\"tipo\":\"chat\",\"texto\":\"olha https://youtu.be/dQw4w9WgXcQ\"}");

        for (Cliente quem : List.of(ana, beto)) {
            JsonNode previa = quem.esperar("previa");
            assertThat(previa.path("url").asString()).isEqualTo("https://youtu.be/dQw4w9WgXcQ");
            assertThat(previa.path("site").asString()).isEqualTo("YouTube");
            assertThat(previa.path("titulo").asString()).isEqualTo("A jogada");
            assertThat(previa.path("autor").asString()).isEqualTo("Canal");
        }
    }

    @Test
    void oChatTemFreioContraQuemMandaRapidoDemais() throws Exception {
        Cliente ana = entrar(sala, "Ana");

        for (int i = 0; i <= SinalizacaoHandler.CHAT_RAJADA; i++) {
            ana.enviar("{\"tipo\":\"chat\",\"texto\":\"oi " + i + "\"}");
        }

        assertThat(ana.esperar("erro").path("motivo").asString()).isEqualTo("chat-rapido-demais");
    }

    @Test
    void oTextoDoChatPerdeOQueBagunçaATelaENaoPassaDoLimite() {
        assertThat(SinalizacaoHandler.textoDoChat("‮oi ")).isEqualTo("oi");
        assertThat(SinalizacaoHandler.textoDoChat("   ")).isEmpty();
        String longo = "😀".repeat(SinalizacaoHandler.CHAT_MAXIMO + 10);
        String cortado = SinalizacaoHandler.textoDoChat(longo);
        assertThat(cortado.codePointCount(0, cortado.length())).isEqualTo(SinalizacaoHandler.CHAT_MAXIMO);
    }

    @Test
    void semEntrarNumaSalaNadaEhRepassado() throws Exception {
        Cliente ana = conectar(null);

        ana.enviar("{\"tipo\":\"oferta\",\"para\":\"qualquer\",\"sdp\":\"x\"}");

        assertThat(ana.esperar("erro").path("motivo").asString()).isEqualTo("entre-numa-sala-primeiro");
    }

    @Test
    void quemChegaConheceQuemJaEstaEQuemEstaSabeQuemChegou() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        String idDaAna = ana.id;

        Cliente beto = conectar(membro("  Beto  ", sala));
        beto.enviar(pedidoDeEntrada(sala, ""));
        JsonNode boasVindas = beto.esperar("bem-vindo");

        assertThat(boasVindas.path("outros").get(0).path("id").asString()).isEqualTo(idDaAna);
        assertThat(boasVindas.path("outros").get(0).path("nome").asString()).isEqualTo("Ana");
        JsonNode entrou = ana.esperar("entrou");
        assertThat(entrou.path("nome").asString()).isEqualTo("Beto"); // o nome da conta, limpo
    }

    @Test
    void ofertaVaiSoParaODestinatarioComORemetenteCarimbadoPeloServidor() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        Cliente beto = entrar(sala, "Beto");
        Cliente caio = entrar(sala, "Caio");

        ana.enviar("{\"tipo\":\"oferta\",\"para\":\"" + beto.id + "\",\"de\":\"forjado\",\"sdp\":\"v=0\"}");

        JsonNode oferta = beto.esperar("oferta");
        assertThat(oferta.path("de").asString()).isEqualTo(ana.id);
        assertThat(oferta.path("sdp").asString()).isEqualTo("v=0");
        assertThat(oferta.has("para")).isFalse();
        assertThat(caio.recebeu("oferta")).isFalse();
    }

    @Test
    void naoRepassaParaQuemEstaEmOutraSala() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        Cliente estranho = entrar(outroServidor(), "Estranho");

        ana.enviar("{\"tipo\":\"oferta\",\"para\":\"" + estranho.id + "\",\"sdp\":\"v=0\"}");

        assertThat(ana.esperar("erro").path("motivo").asString()).isEqualTo("destinatario-nao-esta-na-sala");
        assertThat(estranho.recebeu("oferta")).isFalse();
    }

    @Test
    void quemSaiEhAvisadoParaQuemFica() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        Cliente beto = entrar(sala, "Beto");

        beto.sessao.close();

        assertThat(ana.esperar("saiu").path("id").asString()).isEqualTo(beto.id);
    }

    @Test
    void duasPessoasSaindoJuntasQuemFicaSabeDasDuas() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        Cliente beto = entrar(sala, "Beto");
        Cliente caio = entrar(sala, "Caio");

        ana.sessao.close();
        beto.sessao.close();

        List<String> sairam = List.of(caio.esperar("saiu").path("id").asString(), caio.esperar("saiu").path("id").asString());
        assertThat(sairam).containsExactlyInAnyOrder(ana.id, beto.id);
    }

    @Test
    void reconexaoComAFichaTiraAConexaoAntigaDaSala() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        Cliente beto = entrar(sala, "Beto");

        Cliente anaDeNovo = conectar(ana.cookie);
        anaDeNovo.enviar(pedidoDeEntrada(sala, ana.ficha));
        JsonNode boasVindas = anaDeNovo.esperar("bem-vindo");

        assertThat(beto.esperar("saiu").path("id").asString()).isEqualTo(ana.id); // sem Ana fantasma
        assertThat(boasVindas.path("outros")).hasSize(1);
        assertThat(ana.fechou.poll(5, TimeUnit.SECONDS)).isNotNull();
    }

    @Test
    void mensagemQueNaoEhJsonRespondeComErroSemDerrubarAConexao() throws Exception {
        Cliente ana = entrar(sala, "Ana");

        ana.enviar("isso não é json");
        ana.enviar("[1,2]");

        assertThat(ana.esperar("erro").path("motivo").asString()).isEqualTo("mensagem-invalida");
        assertThat(ana.esperar("erro").path("motivo").asString()).isEqualTo("mensagem-invalida");
        ana.enviar("{\"tipo\":\"ping\"}");
        ana.esperar("pong");
    }

    @Test
    void chamarAAtencaoChegaSoAQuemFoiChamadoEAteCincoVezesPorMinuto() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        Cliente beto = entrar(sala, "Beto");
        Cliente caio = entrar(sala, "Caio");

        ana.enviar("{\"tipo\":\"chamar\",\"para\":\"" + beto.id + "\",\"de\":\"forjado\"}");
        assertThat(beto.esperar("chamado").path("de").asString()).isEqualTo(ana.id);
        assertThat(caio.recebeu("chamado")).isFalse();

        for (int i = 1; i < SinalizacaoHandler.CHAMADAS_POR_JANELA; i++) {
            ana.enviar("{\"tipo\":\"chamar\",\"para\":\"" + beto.id + "\"}");
            beto.esperar("chamado");
        }
        ana.enviar("{\"tipo\":\"chamar\",\"para\":\"" + beto.id + "\"}");
        assertThat(ana.esperar("erro").path("motivo").asString()).isEqualTo("chamar-cedo-demais");
        assertThat(beto.recebeu("chamado")).isFalse();
        // O freio é por pessoa chamada: o Caio ainda pode ser chamado.
        ana.enviar("{\"tipo\":\"chamar\",\"para\":\"" + caio.id + "\"}");
        caio.esperar("chamado");
    }

    @Test
    void nomeSemControleNemInversaoECortadoSemPartirEmoji() {
        assertThat(SinalizacaoHandler.nomeLimpo("  Ana‮\u0007  ")).isEqualTo("Ana");
        assertThat(SinalizacaoHandler.nomeLimpo("\u0000 ")).isEqualTo("Amigo");
        assertThat(SinalizacaoHandler.nomeLimpo("😀".repeat(21))).isEqualTo("😀".repeat(20));
    }

    /** Uma conta nova, membro do servidor, já na sala dele. */
    private Cliente entrar(String servidor, String nome) throws Exception {
        Cliente c = conectar(membro(nome, servidor));
        c.enviar(pedidoDeEntrada(servidor, ""));
        JsonNode boasVindas = c.esperar("bem-vindo");
        c.id = boasVindas.path("id").asString();
        c.ficha = boasVindas.path("ficha").asString();
        return c;
    }

    /** Uma conta nova, membro do servidor por um convite; devolve o cookie da sessão dela. */
    private String membro(String nome, String servidor) {
        UUID conta = contas.entrar("google", UUID.randomUUID().toString(), nome).id();
        servidores.aceitar(servidores.convidar(servidor, donos.get(servidor), null, null), conta);
        return Sessoes.COOKIE + "=" + sessoes.criar(conta, "navegador");
    }

    /** Um servidor novo, de um dono novo: as salas não se misturam. */
    private String outroServidor() {
        UUID outro = contas.entrar("google", UUID.randomUUID().toString(), "Dono").id();
        String codigo = servidores.criar(outro, "Servidor do teste");
        donos.put(codigo, outro);
        return codigo;
    }

    private static String pedidoDeEntrada(String servidor, String ficha) {
        return "{\"tipo\":\"entrar\",\"servidor\":\"" + servidor + "\",\"ficha\":\"" + ficha + "\"}";
    }

    /** Com o cookie da sessão (null: sem conta). */
    private Cliente conectar(String cookie) throws Exception {
        WebSocketHttpHeaders cabecalhos = new WebSocketHttpHeaders();
        if (cookie != null) {
            cabecalhos.add("Cookie", cookie);
        }
        Cliente c = new Cliente();
        c.cookie = cookie;
        c.sessao = new StandardWebSocketClient()
                .execute(c, cabecalhos, URI.create("ws://localhost:" + porta + "/sinal"))
                .get(5, TimeUnit.SECONDS);
        abertos.add(c);
        return c;
    }

    private class Cliente extends TextWebSocketHandler {
        final BlockingQueue<JsonNode> recebidas = new LinkedBlockingQueue<>();
        final BlockingQueue<Integer> fechou = new LinkedBlockingQueue<>();
        WebSocketSession sessao;
        String cookie;
        String id;
        String ficha;

        @Override
        protected void handleTextMessage(WebSocketSession s, TextMessage m) {
            recebidas.add(json.readTree(m.getPayload()));
        }

        @Override
        public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
            fechou.add(status.getCode());
        }

        void enviar(String texto) throws Exception {
            sessao.sendMessage(new TextMessage(texto));
        }

        /** A próxima mensagem do tipo pedido (até 5 s), pulando as outras. */
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

        /** Se chegou alguma mensagem desse tipo em meio segundo. */
        boolean recebeu(String tipo) throws InterruptedException {
            Thread.sleep(500);
            return recebidas.stream().anyMatch(m -> m.path("tipo").asString().equals(tipo));
        }
    }
}
