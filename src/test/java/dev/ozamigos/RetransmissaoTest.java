package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;

/** Os freios da retransmissão, com uma Cloudflare falsa e um relógio que o teste adianta. */
class RetransmissaoTest {

    private static final class Relogio extends Clock {
        Instant agora = Instant.parse("2026-10-19T12:00:00Z");

        @Override
        public Instant instant() {
            return agora;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zona) {
            return this;
        }
    }

    private final class CloudflareFalsa implements Retransmissao.Cloudflare {
        int geradas;
        final List<String> revogadas = new ArrayList<>();
        long periodo;
        final Map<String, Long> hoje = new HashMap<>();
        boolean fora;

        @Override
        public Credencial gerar(Duration validade) {
            String usuario = "u" + (++geradas);
            ArrayNode servidores = json.createArrayNode();
            servidores.addObject().put("username", usuario).put("credential", "x").putArray("urls").add("turn:turn.exemplo:3478");
            return new Credencial(usuario, servidores);
        }

        @Override
        public void revogar(String usuario) {
            revogadas.add(usuario);
        }

        @Override
        public Consumo consumo(LocalDate desde, LocalDate dia) throws IOException {
            if (fora) {
                throw new IOException("fora do ar");
            }
            return new Consumo(periodo, Map.copyOf(hoje));
        }
    }

    private final JsonMapper json = JsonMapper.builder().build();
    private final Relogio relogio = new Relogio();
    private final CloudflareFalsa cloudflare = new CloudflareFalsa();
    private final Retransmissao retransmissao = new Retransmissao(cloudflare, json, relogio, false);
    private final Map<String, List<ArrayNode>> avisos = new HashMap<>();

    private ArrayNode entrar(String id, String endereco) {
        return retransmissao.entrou(id, endereco, servidores -> avisos.computeIfAbsent(id, i -> new ArrayList<>()).add(servidores));
    }

    private void passarMinutos(long minutos) {
        relogio.agora = relogio.agora.plus(Duration.ofMinutes(minutos));
        retransmissao.passo();
    }

    @Test
    void desligadaSemAsVariaveis() {
        Retransmissao desligada = new Retransmissao(null, json, relogio, false);

        assertThat(desligada.entrou("a", "1.1.1.1", s -> {})).isNull();
    }

    @Test
    void quemSaiTemACredencialCanceladaDepoisDeDoisMinutos() {
        ArrayNode servidores = entrar("ana", "1.1.1.1");
        assertThat(servidores.path(0).path("username").asString()).isEqualTo("u1");

        retransmissao.saiu("ana");
        passarMinutos(1);
        assertThat(cloudflare.revogadas).isEmpty(); // a sinalização pode voltar logo

        passarMinutos(1);
        assertThat(cloudflare.revogadas).containsExactly("u1");
    }

    @Test
    void umEnderecoQuePassaDoLimiteDoDiaFicaSemAteAmanha() {
        entrar("abusa", "6.6.6.6");
        entrar("amiga", "1.1.1.1");

        cloudflare.hoje.put("u1", Retransmissao.LIMITE_POR_ENDERECO);
        passarMinutos(5);

        assertThat(cloudflare.revogadas).containsExactly("u1");
        assertThat(avisos.get("abusa")).singleElement().satisfies(lista -> assertThat(lista.isEmpty()).isTrue());
        assertThat(avisos).doesNotContainKey("amiga");
        assertThat(entrar("abusa2", "6.6.6.6")).isNull(); // reconectar não adianta
        assertThat(entrar("outro", "2.2.2.2")).isNotNull();

        // No dia seguinte, volta.
        relogio.agora = Instant.parse("2026-10-20T00:01:00Z");
        cloudflare.hoje.clear();
        retransmissao.passo();
        assertThat(entrar("abusa3", "6.6.6.6")).isNotNull();
    }

    @Test
    void passandoDoLimiteDoPeriodoDesligaParaTodosEReligaQuandoCabe() {
        entrar("ana", "1.1.1.1");
        entrar("beto", "2.2.2.2");

        cloudflare.periodo = Retransmissao.LIMITE_DO_PERIODO;
        passarMinutos(5);

        assertThat(cloudflare.revogadas).containsExactlyInAnyOrder("u1", "u2");
        assertThat(entrar("caio", "3.3.3.3")).isNull();

        cloudflare.periodo = Retransmissao.LIMITE_DO_PERIODO - Retransmissao.GB;
        passarMinutos(5);
        // Quem ficou sem recebe de novo, pelo aviso.
        assertThat(avisos.get("ana")).last().satisfies(lista -> assertThat(lista.isEmpty()).isFalse());
    }

    @Test
    void semConseguirLerOConsumoNinguemRecebeCredencialNova() {
        assertThat(entrar("ana", "1.1.1.1")).isNotNull();

        cloudflare.fora = true;
        relogio.agora = relogio.agora.plus(Retransmissao.CONSUMO_VALE_POR);

        assertThat(entrar("beto", "2.2.2.2")).isNull();
    }

    @Test
    void cadaEnderecoTemUmNumeroDeCredenciaisPorJanela() {
        for (int i = 0; i < Retransmissao.CREDENCIAIS_POR_ENDERECO; i++) {
            assertThat(entrar("p" + i, "1.1.1.1")).isNotNull();
        }

        assertThat(entrar("mais", "1.1.1.1")).isNull();
        assertThat(entrar("outro", "2.2.2.2")).isNotNull();
    }
}
