package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
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
        Cliente c = new Cliente();
        c.sessao = new StandardWebSocketClient()
                .execute(c, new WebSocketHttpHeaders(), URI.create("ws://localhost:" + porta + "/sinal"))
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
