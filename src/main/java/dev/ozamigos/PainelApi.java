package dev.ozamigos;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

/**
 * O painel do dono ({@code GET /api/painel}): as salas abertas agora (quem está em cada uma, quem transmite e quem
 * assiste), o consumo da retransmissão, os números do banco, os servidores, as contas, os banimentos e o registro das
 * ações. E as ações: apagar um servidor, banir e desbanir.
 *
 * <p>Para quem não é dono (Painel.ehDono), o mesmo 404 de um endereço que não existe: o painel não se revela. Quem tem
 * conta e pede assim mesmo vai para o log (alguém procurando o painel). As ações pedem também um login recente
 * ({@link #LOGIN_RECENTE}; senão 403 {@code login-antigo}): um cookie roubado vê o painel, mas não apaga nem bane.
 */
@RestController
public class PainelApi {

    private static final Logger log = LoggerFactory.getLogger(PainelApi.class);

    static final Duration LOGIN_RECENTE = Duration.ofMinutes(10);

    record Confirmacao(Boolean confirmar) {}

    record Identidade(String provedor, String idExterno) {}

    private final Painel painel;
    private final Sessoes sessoes;
    private final Contas contas;
    private final Salas salas;
    private final Retransmissao retransmissao;
    /** Quem não é dono e pede o painel: no log, uma vez a cada 10 minutos por conta. */
    private final Freio avisados = new Freio(1, Duration.ofMinutes(10));
    /** As ações do dono: gente de verdade não passa disso, e um engano em série para aqui. */
    private final Freio acoes = new Freio(30, Duration.ofMinutes(1));
    private final SinalizacaoHandler sinalizacao;
    private final Servidores servidores;

    public PainelApi(Painel painel, Sessoes sessoes, Contas contas, Salas salas, Retransmissao retransmissao,
            SinalizacaoHandler sinalizacao, Servidores servidores) {
        this.sinalizacao = sinalizacao;
        this.servidores = servidores;
        this.painel = painel;
        this.sessoes = sessoes;
        this.contas = contas;
        this.salas = salas;
        this.retransmissao = retransmissao;
    }

    /** O dono que fez o pedido, ou a recusa: sem banco, 503; para quem não é dono, o 404 de sempre. */
    private record Dono(UUID id, ResponseEntity<?> recusa) {}

    private Dono dono(HttpServletRequest pedido) {
        if (!contas.disponivel()) {
            return new Dono(null, ContaApi.semConta(contas));
        }
        Optional<UUID> conta = sessoes.usuario(Sessoes.segredoDe(pedido));
        if (!painel.ehDono(conta)) {
            if (conta.isPresent() && avisados.passa(conta.get().toString())) {
                log.warn("Conta {} pediu o painel do dono sem ser dona", conta.get());
            }
            return new Dono(null, ContaApi.erro(HttpStatus.NOT_FOUND, "nao-existe"));
        }
        return new Dono(conta.get(), null);
    }

    /** O dono, para uma ação: também com login recente e dentro do freio. */
    private Dono donoParaAgir(HttpServletRequest pedido) {
        Dono dono = dono(pedido);
        if (dono.recusa() != null) {
            return dono;
        }
        if (!sessoes.recente(Sessoes.segredoDe(pedido), LOGIN_RECENTE)) {
            return new Dono(null, ContaApi.erro(HttpStatus.FORBIDDEN, "login-antigo"));
        }
        if (!acoes.passa(dono.id().toString())) {
            return new Dono(null, ContaApi.erro(HttpStatus.TOO_MANY_REQUESTS, "muitas-tentativas"));
        }
        return dono;
    }

    @GetMapping("/api/painel")
    public ResponseEntity<?> ver(HttpServletRequest pedido) {
        Dono dono = dono(pedido);
        if (dono.recusa() != null) {
            return dono.recusa();
        }
        Map<String, Object> corpo = new LinkedHashMap<>();
        corpo.put("agora", Instant.now());
        corpo.put("salas", salasAbertas());
        corpo.put("retransmissao", retransmissao());
        corpo.put("banco", painel.numeros());
        corpo.put("servidores", painel.servidores());
        corpo.put("contas", painel.contas());
        corpo.put("banimentos", painel.banimentos());
        corpo.put("registro", painel.registro());
        corpo.put("loginRecente", sessoes.recente(Sessoes.segredoDe(pedido), LOGIN_RECENTE));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(corpo);
    }

    /** Apaga um servidor de qualquer pessoa; quem está na sala sai com {@code servidor-apagado}. */
    @DeleteMapping("/api/painel/servidores/{codigo}")
    public ResponseEntity<?> apagarServidor(@PathVariable String codigo, @RequestBody(required = false) Confirmacao confirmacao,
            HttpServletRequest pedido) {
        Dono dono = donoParaAgir(pedido);
        if (dono.recusa() != null) {
            return dono.recusa();
        }
        if (confirmacao == null || !Boolean.TRUE.equals(confirmacao.confirmar())) {
            return ContaApi.erro(HttpStatus.BAD_REQUEST, "confirme");
        }
        Optional<String> nome = Servidores.CODIGO.matcher(codigo).matches() ? servidores.apagarPeloPainel(codigo) : Optional.empty();
        if (nome.isEmpty()) {
            return ContaApi.erro(HttpStatus.NOT_FOUND, "servidor-nao-existe");
        }
        painel.registrar(dono.id(), "apagar-servidor", codigo, nome.get());
        sinalizacao.tirarDoServidor(codigo, null, "servidor-apagado");
        log.info("Painel: a conta {} apagou o servidor {}", dono.id(), codigo);
        return ResponseEntity.noContent().build();
    }

    /** Bane uma conta: sai das salas, perde as sessões e não entra mais (nem com o mesmo Google ou Discord numa conta nova). */
    @PostMapping("/api/painel/contas/{id}/banir")
    public ResponseEntity<?> banir(@PathVariable String id, @RequestBody(required = false) Confirmacao confirmacao,
            HttpServletRequest pedido) {
        Dono dono = donoParaAgir(pedido);
        if (dono.recusa() != null) {
            return dono.recusa();
        }
        if (confirmacao == null || !Boolean.TRUE.equals(confirmacao.confirmar())) {
            return ContaApi.erro(HttpStatus.BAD_REQUEST, "confirme");
        }
        UUID conta;
        try {
            conta = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return ContaApi.erro(HttpStatus.NOT_FOUND, "conta-nao-existe");
        }
        if (painel.ehDono(Optional.of(conta))) {
            return ContaApi.erro(HttpStatus.BAD_REQUEST, "dono-nao-se-bane"); // nem a si, nem outro dono
        }
        Optional<String> nome = painel.banir(dono.id(), conta);
        if (nome.isEmpty()) {
            return ContaApi.erro(HttpStatus.NOT_FOUND, "conta-nao-existe");
        }
        sinalizacao.tirarDosServidores(conta, "sem-conta");
        log.info("Painel: a conta {} baniu a conta {}", dono.id(), conta);
        return ResponseEntity.noContent().build();
    }

    /** Desfaz o banimento de uma conta do Google ou do Discord (e das outras da mesma conta). */
    @PostMapping("/api/painel/desbanir")
    public ResponseEntity<?> desbanir(@RequestBody(required = false) Identidade identidade, HttpServletRequest pedido) {
        Dono dono = donoParaAgir(pedido);
        if (dono.recusa() != null) {
            return dono.recusa();
        }
        if (identidade == null || identidade.provedor() == null || identidade.idExterno() == null) {
            return ContaApi.erro(HttpStatus.BAD_REQUEST, "pedido-invalido");
        }
        if (painel.desbanir(dono.id(), identidade.provedor(), identidade.idExterno()).isEmpty()) {
            return ContaApi.erro(HttpStatus.NOT_FOUND, "nao-banida");
        }
        log.info("Painel: a conta {} desbaniu uma conta do {}", dono.id(), identidade.provedor());
        return ResponseEntity.noContent().build();
    }

    /** As salas abertas, com o nome do servidor de cada uma; as mais cheias primeiro. */
    private List<Map<String, Object>> salasAbertas() {
        Map<String, List<Salas.NoAr>> retrato = salas.retrato();
        String prefixo = Servidores.sala("");
        List<String> codigos = retrato.keySet().stream().filter(c -> c.startsWith(prefixo)).map(c -> c.substring(prefixo.length())).toList();
        Map<String, String> nomes = painel.nomesDosServidores(codigos);
        List<Map<String, Object>> abertas = new ArrayList<>();
        retrato.forEach((chave, pessoas) -> {
            String codigo = chave.startsWith(prefixo) ? chave.substring(prefixo.length()) : null;
            Map<String, Object> sala = new LinkedHashMap<>();
            sala.put("codigo", codigo);
            sala.put("nome", codigo == null ? chave : nomes.getOrDefault(codigo, codigo));
            sala.put("pessoas", pessoas);
            abertas.add(sala);
        });
        abertas.sort((a, b) -> Integer.compare(((List<?>) b.get("pessoas")).size(), ((List<?>) a.get("pessoas")).size()));
        return abertas;
    }

    private Map<String, Object> retransmissao() {
        Map<String, Object> corpo = new LinkedHashMap<>();
        corpo.put("ligada", retransmissao.ligada());
        Retransmissao.Resumo resumo = retransmissao.resumo();
        if (resumo != null) {
            corpo.put("lidoEm", resumo.lidoEm());
            corpo.put("periodo", resumo.periodo());
            corpo.put("hoje", resumo.hoje());
            corpo.put("hojeVideo", resumo.hojeVideo());
            corpo.put("hojeVoz", resumo.hojeVoz());
            corpo.put("esgotada", resumo.esgotada());
            corpo.put("videoEsgotado", resumo.videoEsgotado());
            Map<String, Map<String, Long>> porConta = new LinkedHashMap<>();
            resumo.porConta().forEach((id, usos) -> porConta.put(id, Map.of("video", usos[0], "voz", usos[1])));
            corpo.put("porConta", porConta);
        }
        corpo.put("limites", Map.of(
                "periodo", Retransmissao.LIMITE_DO_PERIODO, "dia", Retransmissao.LIMITE_DO_DIA,
                "periodoDoVideo", Retransmissao.LIMITE_DO_PERIODO_DO_VIDEO, "diaDoVideo", Retransmissao.LIMITE_DO_DIA_DO_VIDEO,
                "videoPorPessoa", Retransmissao.LIMITE_DE_VIDEO_POR_ENDERECO, "vozPorPessoa", Retransmissao.LIMITE_DE_VOZ_POR_ENDERECO,
                "diasDoPeriodo", Retransmissao.DIAS_DO_PERIODO));
        return corpo;
    }
}
