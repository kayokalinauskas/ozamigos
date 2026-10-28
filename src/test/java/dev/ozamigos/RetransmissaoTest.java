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
        int revogarFalha; // quantas vezes o cancelamento ainda vai falhar

        @Override
        public Credencial gerar(Duration validade) {
            String usuario = "u" + (++geradas);
            ArrayNode servidores = json.createArrayNode();
            servidores.addObject().put("username", usuario).put("credential", "x").putArray("urls").add("turn:turn.exemplo:3478");
            return new Credencial(usuario, servidores);
        }

        @Override
        public void revogar(String usuario) throws IOException {
            if (revogarFalha > 0) {
                revogarFalha--;
                throw new IOException("fora do ar");
            }
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
    private final Map<String, List<Retransmissao.Credenciais>> avisos = new HashMap<>();

    /** Cada pessoa com a própria conta: os limites dos testes são os do endereço. */
    private Retransmissao.Credenciais entrar(String id, String endereco) {
        return entrar(id, endereco, "conta-" + id);
    }

    private Retransmissao.Credenciais entrar(String id, String endereco, String conta) {
        return retransmissao.entrou(id, "Nome de " + id, endereco, conta, credenciais -> avisos.computeIfAbsent(id, i -> new ArrayList<>()).add(credenciais));
    }

    private static String usuario(ArrayNode servidores) {
        return servidores.path(0).path("username").asString("");
    }

    private void passarMinutos(long minutos) {
        relogio.agora = relogio.agora.plus(Duration.ofMinutes(minutos));
        retransmissao.passo();
    }

    @Test
    void desligadaSemAsVariaveis() {
        Retransmissao desligada = new Retransmissao(null, json, relogio, false);

        assertThat(desligada.entrou("a", "Ana", "1.1.1.1", "conta-a", c -> {})).isNull();
    }

    @Test
    void soQuemTemContaRecebe() {
        assertThat(retransmissao.entrou("convidado", "Convidado", "1.1.1.1", null, c -> {})).isNull();
        passarMinutos(5);

        assertThat(cloudflare.geradas).isZero();
        assertThat(entrar("ana", "1.1.1.1")).isNotNull();
    }

    @Test
    void oLimiteDaContaVaiJuntoParaOutraRede() {
        entrar("kayo", "6.6.6.6", "conta-kayo"); // u1 voz, u2 vídeo

        cloudflare.hoje.put("u2", Retransmissao.LIMITE_DE_VIDEO_POR_ENDERECO);
        passarMinutos(5);

        // Do 4G, outro endereço: a conta continua sem o vídeo. Outra conta naquele endereço também.
        Retransmissao.Credenciais do4g = entrar("kayo-4g", "7.7.7.7", "conta-kayo");
        assertThat(do4g.video().isEmpty()).isTrue();
        assertThat(do4g.limiteDoVideo()).isEqualTo("seu");
        assertThat(entrar("outra", "6.6.6.6", "conta-outra").video().isEmpty()).isTrue();
        assertThat(entrar("longe", "8.8.8.8", "conta-longe").video().isEmpty()).isFalse();
    }

    @Test
    void cadaPessoaRecebeUmaCredencialParaAVozEOutraParaOVideo() {
        Retransmissao.Credenciais credenciais = entrar("ana", "1.1.1.1");

        assertThat(usuario(credenciais.voz())).isEqualTo("u1");
        assertThat(usuario(credenciais.video())).isEqualTo("u2");
        assertThat(credenciais.limiteDoVideo()).isNull();
    }

    @Test
    void quemSaiTemAsCredenciaisCanceladasDepoisDeDoisMinutos() {
        entrar("ana", "1.1.1.1");

        retransmissao.saiu("ana");
        passarMinutos(1);
        assertThat(cloudflare.revogadas).isEmpty(); // a sinalização pode voltar logo

        passarMinutos(1);
        assertThat(cloudflare.revogadas).containsExactlyInAnyOrder("u1", "u2");
    }

    @Test
    void quemPassaDoLimiteDeVideoDoDiaFicaSemOVideoAteAmanhaMasContinuaComAVoz() {
        entrar("assiste", "6.6.6.6"); // u1 voz, u2 vídeo
        entrar("amiga", "1.1.1.1");

        cloudflare.hoje.put("u2", Retransmissao.LIMITE_DE_VIDEO_POR_ENDERECO);
        passarMinutos(5);

        assertThat(cloudflare.revogadas).containsExactly("u2");
        assertThat(avisos.get("assiste")).singleElement().satisfies(c -> {
            assertThat(usuario(c.voz())).isEqualTo("u1");
            assertThat(c.video().isEmpty()).isTrue();
            assertThat(c.limiteDoVideo()).isEqualTo("seu"); // a página explica que foi o uso dela
        });
        assertThat(avisos).doesNotContainKey("amiga");
        // Reconectar não traz o vídeo de volta.
        Retransmissao.Credenciais deNovo = entrar("assiste2", "6.6.6.6");
        assertThat(deNovo.video().isEmpty()).isTrue();
        assertThat(deNovo.voz().isEmpty()).isFalse();

        // No dia seguinte (UTC), o vídeo volta, também para quem ficou na sala.
        relogio.agora = Instant.parse("2026-10-20T00:01:00Z");
        cloudflare.hoje.clear();
        retransmissao.passo();
        assertThat(avisos.get("assiste")).last().satisfies(c -> assertThat(c.video().isEmpty()).isFalse());
    }

    @Test
    void passarDoLimiteDeVozNaoEConversaECortaTudo() {
        entrar("copiou", "6.6.6.6");

        cloudflare.hoje.put("u1", Retransmissao.LIMITE_DE_VOZ_POR_ENDERECO);
        passarMinutos(5);

        assertThat(cloudflare.revogadas).containsExactlyInAnyOrder("u1", "u2");
        assertThat(entrar("copiou2", "6.6.6.6")).isNull();
    }

    @Test
    void pertoDoTetoOVideoParaParaTodosENoTetoAVozTambem() {
        entrar("ana", "1.1.1.1");
        entrar("beto", "2.2.2.2"); // u3 voz, u4 vídeo

        cloudflare.periodo = Retransmissao.LIMITE_DO_PERIODO_DO_VIDEO;
        passarMinutos(5);
        assertThat(cloudflare.revogadas).containsExactlyInAnyOrder("u2", "u4");
        assertThat(avisos.get("ana")).last().satisfies(c -> {
            assertThat(c.voz().isEmpty()).isFalse();
            assertThat(c.limiteDoVideo()).isEqualTo("geral");
        });

        cloudflare.periodo = Retransmissao.LIMITE_DO_PERIODO;
        passarMinutos(5);
        assertThat(cloudflare.revogadas).containsExactlyInAnyOrder("u1", "u2", "u3", "u4");
        assertThat(entrar("caio", "3.3.3.3")).isNull();

        cloudflare.periodo = Retransmissao.LIMITE_DO_PERIODO_DO_VIDEO - Retransmissao.GB;
        passarMinutos(5);
        // Quem ficou sem recebe de novo, pelo aviso.
        assertThat(avisos.get("ana")).last().satisfies(c -> {
            assertThat(c.voz().isEmpty()).isFalse();
            assertThat(c.video().isEmpty()).isFalse();
        });
    }

    @Test
    void semConseguirLerOConsumoNinguemRecebeCredencialNova() {
        assertThat(entrar("ana", "1.1.1.1")).isNotNull();

        cloudflare.fora = true;
        relogio.agora = relogio.agora.plus(Retransmissao.CONSUMO_VALE_POR);

        assertThat(entrar("beto", "2.2.2.2")).isNull();
    }

    @Test
    void quemEntraAntesDeOConsumoSerLidoRecebeAsCredenciaisPeloAvisoQuandoEleFor() {
        cloudflare.fora = true; // a primeira leitura falha (o servidor acabou de acordar)
        assertThat(entrar("ana", "1.1.1.1")).isNull();

        cloudflare.fora = false;
        passarMinutos(1);

        assertThat(avisos.get("ana")).singleElement().satisfies(c -> assertThat(usuario(c.video())).isEqualTo("u2"));
        passarMinutos(1);
        assertThat(cloudflare.geradas).isEqualTo(2); // uma de cada, sem pedir de novo a cada passo
    }

    @Test
    void oCancelamentoQueFalhaETentadoDeNovo() {
        entrar("ana", "1.1.1.1");
        retransmissao.saiu("ana");
        cloudflare.revogarFalha = 1;

        passarMinutos(2);
        assertThat(cloudflare.revogadas).hasSize(1); // uma das duas falhou

        passarMinutos(1);
        assertThat(cloudflare.revogadas).containsExactlyInAnyOrder("u1", "u2");
    }

    @Test
    void umaCredencialDeAntesDoReinicioUsadaHojeECancelada() {
        entrar("ana", "1.1.1.1");
        cloudflare.hoje.put("de-antes", Retransmissao.GB); // emitida pelo servidor antes de reiniciar

        passarMinutos(5);
        passarMinutos(5);

        assertThat(cloudflare.revogadas).containsExactly("de-antes"); // uma vez só, e as da Ana continuam
    }

    @Test
    void oConsumoNoLogVemEmMbAbaixoDeUmGb() {
        assertThat(Retransmissao.quanto(12_400_000)).isEqualTo("12 MB");
        assertThat(Retransmissao.quanto(2_440_000_000L)).isEqualTo("2.4 GB");
    }

    @Test
    void cadaEnderecoTemUmNumeroDePedidosDeCredenciaisPorJanela() {
        for (int i = 0; i < Retransmissao.CREDENCIAIS_POR_ENDERECO; i++) {
            assertThat(entrar("p" + i, "1.1.1.1")).isNotNull();
        }

        assertThat(entrar("mais", "1.1.1.1")).isNull();
        assertThat(entrar("outro", "2.2.2.2")).isNotNull();
    }
}
