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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

/**
 * O painel do dono ({@code GET /api/painel}): as salas abertas agora (quem está em cada uma, quem transmite e quem
 * assiste), o consumo da retransmissão, os números do banco, os servidores e as contas. Só leitura.
 *
 * <p>Para quem não é dono (Painel.ehDono), o mesmo 404 de um endereço que não existe: o painel não se revela. Quem tem
 * conta e pede assim mesmo vai para o log (alguém procurando o painel).
 */
@RestController
public class PainelApi {

    private static final Logger log = LoggerFactory.getLogger(PainelApi.class);

    private final Painel painel;
    private final Sessoes sessoes;
    private final Contas contas;
    private final Salas salas;
    private final Retransmissao retransmissao;
    /** Quem não é dono e pede o painel: no log, uma vez a cada 10 minutos por conta. */
    private final Freio avisados = new Freio(1, Duration.ofMinutes(10));

    public PainelApi(Painel painel, Sessoes sessoes, Contas contas, Salas salas, Retransmissao retransmissao) {
        this.painel = painel;
        this.sessoes = sessoes;
        this.contas = contas;
        this.salas = salas;
        this.retransmissao = retransmissao;
    }

    @GetMapping("/api/painel")
    public ResponseEntity<?> ver(HttpServletRequest pedido) {
        if (!contas.disponivel()) {
            return ContaApi.semConta(contas);
        }
        Optional<UUID> conta = sessoes.usuario(Sessoes.segredoDe(pedido));
        if (!painel.ehDono(conta)) {
            if (conta.isPresent() && avisados.passa(conta.get().toString())) {
                log.warn("Conta {} pediu o painel do dono sem ser dona", conta.get());
            }
            return ContaApi.erro(HttpStatus.NOT_FOUND, "nao-existe");
        }
        Map<String, Object> corpo = new LinkedHashMap<>();
        corpo.put("agora", Instant.now());
        corpo.put("salas", salasAbertas());
        corpo.put("retransmissao", retransmissao());
        corpo.put("banco", painel.numeros());
        corpo.put("servidores", painel.servidores());
        corpo.put("contas", painel.contas());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(corpo);
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
