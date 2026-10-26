package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
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

/** A sinalização de ponta a ponta no servidor: clientes WebSocket de verdade contra o Tomcat numa porta aleatória. */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = "ozamigos.senha=teste")
class SinalizacaoTest {

    @LocalServerPort
    private int porta;

    @Autowired
    private JsonMapper json;

    private final List<Cliente> abertos = new ArrayList<>();
    // Cada teste numa sala só dele: o servidor é o mesmo para todos os testes da classe.
    private final String sala = "sala" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);

    @AfterEach
    void fecharTodos() throws Exception {
        for (Cliente c : abertos) {
            if (c.sessao.isOpen()) {
                c.sessao.close();
            }
        }
    }

    @Test
    void senhaErradaRecusaEFechaAConexao() throws Exception {
        Cliente intruso = conectar();

        intruso.enviar("{\"tipo\":\"entrar\",\"sala\":\"" + sala + "\",\"senha\":\"chute\",\"nome\":\"X\"}");

        assertThat(intruso.esperar("erro").path("motivo").asString()).isEqualTo("senha-errada");
        assertThat(intruso.fechou.poll(5, TimeUnit.SECONDS)).isEqualTo(CloseStatus.POLICY_VIOLATION.getCode());
    }

    @Test
    void forjarOXForwardedForNaoEscapaDoFreioDeSenhas() throws Exception {
        // Cada tentativa finge vir de outro lugar pelo X-Forwarded-For, mas a Cloudflare diz o endereço de verdade.
        String enderecoReal = "cf-" + sala;
        String chute = "{\"tipo\":\"entrar\",\"sala\":\"" + sala + "\",\"senha\":\"chute\",\"nome\":\"X\"}";
        for (int i = 0; i < TentativasDeSenha.LIMITE; i++) {
            Cliente tentativa = conectar(enderecoReal, "198.51.100." + i);
            tentativa.enviar(chute);
            assertThat(tentativa.esperar("erro").path("motivo").asString()).isEqualTo("senha-errada");
        }

        Cliente mais = conectar(enderecoReal, "198.51.100.200");
        mais.enviar(chute);

        assertThat(mais.esperar("erro").path("motivo").asString()).isEqualTo("muitas-tentativas");
    }

    @Test
    void oChatChegaATodosDaSalaComQuemMandouCarimbadoESoNela() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        Cliente beto = entrar(sala, "Beto");
        Cliente caio = entrar(sala + "x", "Caio");

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
    void oBemVindoTrazUmaRetransmissaoParaOVideoEOutraParaAVoz() throws Exception {
        // De um endereço só dele: os outros testes, todos de localhost, gastam os pedidos de credenciais da janela.
        Cliente ana = conectar("cf-" + sala, "198.51.100.1");
        ana.enviar("{\"tipo\":\"entrar\",\"sala\":\"" + sala + "\",\"senha\":\"teste\",\"nome\":\"Ana\"}");

        JsonNode boasVindas = ana.esperar("bem-vindo");

        String video = boasVindas.path("retransmissao").path(0).path("username").asString();
        String voz = boasVindas.path("retransmissaoDaVoz").path(0).path("username").asString();
        assertThat(video).startsWith("u");
        assertThat(voz).startsWith("u").isNotEqualTo(video);
        assertThat(boasVindas.has("limiteDoVideo")).isFalse();
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
        Cliente ana = conectar();

        ana.enviar("{\"tipo\":\"oferta\",\"para\":\"qualquer\",\"sdp\":\"x\"}");

        assertThat(ana.esperar("erro").path("motivo").asString()).isEqualTo("entre-numa-sala-primeiro");
    }

    @Test
    void quemChegaConheceQuemJaEstaEQuemEstaSabeQuemChegou() throws Exception {
        Cliente ana = entrar(sala, "Ana");
        String idDaAna = ana.id;

        Cliente beto = conectar();
        beto.enviar("{\"tipo\":\"entrar\",\"sala\":\"" + sala + "\",\"senha\":\"teste\",\"nome\":\"  Beto  \"}");
        JsonNode boasVindas = beto.esperar("bem-vindo");

        assertThat(boasVindas.path("outros").get(0).path("id").asString()).isEqualTo(idDaAna);
        assertThat(boasVindas.path("outros").get(0).path("nome").asString()).isEqualTo("Ana");
        JsonNode entrou = ana.esperar("entrou");
        assertThat(entrou.path("nome").asString()).isEqualTo("Beto"); // nome limpo pelo servidor
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
        Cliente estranho = entrar(sala + "b", "Estranho");

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

        Cliente anaDeNovo = conectar();
        anaDeNovo.enviar("{\"tipo\":\"entrar\",\"sala\":\"" + sala + "\",\"senha\":\"teste\",\"nome\":\"Ana\",\"ficha\":\""
                + ana.ficha + "\"}");
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
    void umGrupoCriadoNaHoraTemASenhaDeleESoVeQuemEstaNele() throws Exception {
        String grupo = "g-" + sala.toLowerCase();
        Cliente semGrupo = conectar();
        semGrupo.enviar(entrarNoGrupo(grupo, "nossa", false));
        assertThat(semGrupo.esperar("erro").path("motivo").asString()).isEqualTo("grupo-nao-existe");

        Cliente ana = conectar();
        ana.enviar(entrarNoGrupo(grupo, "nossa", true));
        ana.id = ana.esperar("bem-vindo").path("id").asString();
        // A senha do grupo fixo não abre o grupo, e a do grupo não abre o grupo fixo.
        Cliente comAFixa = conectar();
        comAFixa.enviar(entrarNoGrupo(grupo, "teste", false));
        assertThat(comAFixa.esperar("erro").path("motivo").asString()).isEqualTo("senha-errada");
        Cliente outroNome = conectar();
        outroNome.enviar(entrarNoGrupo(grupo, "outra", true));
        assertThat(outroNome.esperar("erro").path("motivo").asString()).isEqualTo("grupo-em-uso");

        Cliente beto = conectar();
        beto.enviar(entrarNoGrupo(grupo, "nossa", false));
        assertThat(beto.esperar("bem-vindo").path("outros").get(0).path("id").asString()).isEqualTo(ana.id);
        // Quem está numa sala do grupo fixo com o mesmo código não está no grupo.
        Cliente fixo = entrar(Grupos.sala(grupo).replaceAll("[^A-Za-z0-9]", ""), "Fixo");
        fixo.enviar("{\"tipo\":\"chat\",\"texto\":\"oi\"}");
        fixo.esperar("chat");
        assertThat(ana.recebeu("chat")).isFalse();
    }

    private static String entrarNoGrupo(String grupo, String senha, boolean criar) {
        return "{\"tipo\":\"entrar\",\"grupo\":\"" + grupo + "\",\"senha\":\"" + senha + "\",\"nome\":\"X\",\"criar\":" + criar + "}";
    }

    @Test
    void nomeSemControleNemInversaoECortadoSemPartirEmoji() {
        assertThat(SinalizacaoHandler.nomeLimpo("  Ana‮\u0007  ")).isEqualTo("Ana");
        assertThat(SinalizacaoHandler.nomeLimpo("\u0000 ")).isEqualTo("Amigo");
        assertThat(SinalizacaoHandler.nomeLimpo("😀".repeat(21))).isEqualTo("😀".repeat(20));
    }

    private Cliente entrar(String sala, String nome) throws Exception {
        Cliente c = conectar();
        c.enviar("{\"tipo\":\"entrar\",\"sala\":\"" + sala + "\",\"senha\":\"teste\",\"nome\":\"" + nome + "\"}");
        JsonNode boasVindas = c.esperar("bem-vindo");
        c.id = boasVindas.path("id").asString();
        c.ficha = boasVindas.path("ficha").asString();
        return c;
    }

    private Cliente conectar() throws Exception {
        return conectar(new WebSocketHttpHeaders());
    }

    /** Como se viesse pela Cloudflare (CF-Connecting-IP), com um X-Forwarded-For qualquer, como um forjado. */
    private Cliente conectar(String daCloudflare, String forjado) throws Exception {
        WebSocketHttpHeaders cabecalhos = new WebSocketHttpHeaders();
        cabecalhos.add("CF-Connecting-IP", daCloudflare);
        cabecalhos.add("X-Forwarded-For", forjado);
        return conectar(cabecalhos);
    }

    private Cliente conectar(WebSocketHttpHeaders cabecalhos) throws Exception {
        Cliente c = new Cliente();
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
