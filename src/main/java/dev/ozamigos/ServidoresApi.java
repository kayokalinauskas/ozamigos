package dev.ozamigos;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Os servidores salvos pela API (as regras de quem pode o quê ficam em Servidores; aqui só se traduz para HTTP). Tudo
 * pede conta; as ações (POST, PUT, PATCH, DELETE) só valem vindas da própria página (ProtecaoDaApi). Expulsar alguém e
 * apagar o servidor tiram as pessoas da sala na hora (SinalizacaoHandler).
 *
 * <p>Erros: os de ContaApi ({@code sem-conta}, {@code contas-indisponiveis}, {@code muitas-tentativas}) e os de
 * {@link Servidores.Motivo}.
 */
@RestController
public class ServidoresApi {

    record Nome(String nome) {}

    record Mudanca(String nome, Boolean membrosConvidam) {}

    record NovoConvite(Integer horas, Integer usos) {}

    record NovoPapel(String papel) {}

    record NovoDono(String para) {}

    record Confirmacao(Boolean confirmar) {}

    /** O ícone mandado pela pessoa, antes de reduzir: maior que isso nem é lido. */
    static final int ICONE_MAXIMO = 2_000_000;

    private final Servidores servidores;
    private final Contas contas;
    private final Sessoes sessoes;
    private final SinalizacaoHandler sinalizacao;
    /**
     * Convites abertos e aceitos por endereço: os códigos são longos demais para chutar, mas um freio não custa nada.
     * Quem recebe um link abre e aceita uma vez; 30 em 10 minutos sobram.
     */
    private final Freio convitesPorEndereco = new Freio(30, Duration.ofMinutes(10));

    public ServidoresApi(Servidores servidores, Contas contas, Sessoes sessoes, SinalizacaoHandler sinalizacao) {
        this.servidores = servidores;
        this.contas = contas;
        this.sessoes = sessoes;
        this.sinalizacao = sinalizacao;
    }

    @GetMapping("/api/servidores")
    public ResponseEntity<?> meus(HttpServletRequest pedido) {
        return comConta(pedido, usuario -> Map.of("servidores", servidores.meus(usuario).stream().map(ServidoresApi::emJson).toList()));
    }

    @PostMapping("/api/servidores")
    public ResponseEntity<?> criar(@RequestBody Nome nome, HttpServletRequest pedido) {
        return comConta(pedido, usuario -> Map.of("codigo", servidores.criar(usuario, nome.nome())));
    }

    @GetMapping("/api/servidores/{codigo}")
    public ResponseEntity<?> ver(@PathVariable String codigo, HttpServletRequest pedido) {
        return comConta(pedido, usuario -> emJson(servidores.ver(codigo, usuario)));
    }

    /** O nome (dono e admin) e se os membros convidam (só o dono); o que não vier fica como está. */
    @PatchMapping("/api/servidores/{codigo}")
    public ResponseEntity<?> mudar(@PathVariable String codigo, @RequestBody Mudanca mudanca, HttpServletRequest pedido) {
        return comConta(pedido, usuario -> {
            if (mudanca.nome() != null) {
                servidores.renomear(codigo, usuario, mudanca.nome());
            }
            if (mudanca.membrosConvidam() != null) {
                servidores.membrosConvidam(codigo, usuario, mudanca.membrosConvidam());
            }
            return emJson(servidores.ver(codigo, usuario));
        });
    }

    /** Apaga o servidor (só o dono). Pede {@code {"confirmar": true}}, como apagar a conta. */
    @DeleteMapping("/api/servidores/{codigo}")
    public ResponseEntity<?> apagar(@PathVariable String codigo, @RequestBody(required = false) Confirmacao confirmacao,
            HttpServletRequest pedido) {
        if (confirmacao == null || !Boolean.TRUE.equals(confirmacao.confirmar())) {
            return ContaApi.erro(HttpStatus.BAD_REQUEST, "confirme");
        }
        return comConta(pedido, usuario -> {
            servidores.apagar(codigo, usuario);
            sinalizacao.tirarDoServidor(codigo, null, "servidor-apagado");
            return null;
        });
    }

    /** O ícone novo: a imagem no corpo (PNG, JPEG, WebP...), até ICONE_MAXIMO. */
    @PutMapping("/api/servidores/{codigo}/icone")
    public ResponseEntity<?> trocarIcone(@PathVariable String codigo, HttpServletRequest pedido) {
        // A imagem só é lida depois de conferida a conta: sem ela, ninguém faz o servidor ler 2 MB.
        return comConta(pedido, usuario -> {
            byte[] imagem;
            try {
                imagem = pedido.getInputStream().readNBytes(ICONE_MAXIMO + 1);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            if (imagem.length == 0 || imagem.length > ICONE_MAXIMO) {
                throw new Servidores.Recusa(Servidores.Motivo.ICONE_INVALIDO);
            }
            return mapaCom("icone", servidores.trocarIcone(codigo, usuario, imagem));
        });
    }

    @DeleteMapping("/api/servidores/{codigo}/icone")
    public ResponseEntity<?> tirarIcone(@PathVariable String codigo, HttpServletRequest pedido) {
        return comConta(pedido, usuario -> mapaCom("icone", servidores.trocarIcone(codigo, usuario, null)));
    }

    /** O ícone, com a versão no endereço: pode ficar no cache por um ano. */
    @GetMapping("/api/servidores/{codigo}/icone")
    public ResponseEntity<byte[]> icone(@PathVariable String codigo) {
        if (!contas.disponivel()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        return servidores.icone(codigo)
                .map(icone -> ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG)
                        .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
                        .body(icone))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /** Passa a posse (só o dono): {@code {"para": "<conta>"}}; quem era dono vira admin. */
    @PostMapping("/api/servidores/{codigo}/dono")
    public ResponseEntity<?> passarPosse(@PathVariable String codigo, @RequestBody NovoDono novo, HttpServletRequest pedido) {
        Optional<UUID> para = uuid(novo.para());
        if (para.isEmpty()) {
            return ContaApi.erro(HttpStatus.BAD_REQUEST, Servidores.Motivo.PEDIDO_INVALIDO.texto);
        }
        return comConta(pedido, usuario -> {
            servidores.passarPosse(codigo, usuario, para.get());
            return emJson(servidores.ver(codigo, usuario));
        });
    }

    /** Admin ou membro (só o dono): {@code {"papel": "admin" | "membro"}}. */
    @PatchMapping("/api/servidores/{codigo}/membros/{conta}")
    public ResponseEntity<?> mudarPapel(@PathVariable String codigo, @PathVariable String conta, @RequestBody NovoPapel papel,
            HttpServletRequest pedido) {
        Optional<UUID> alvo = uuid(conta);
        Servidores.Papel novo = "admin".equals(papel.papel()) ? Servidores.Papel.ADMIN
                : "membro".equals(papel.papel()) ? Servidores.Papel.MEMBRO : null;
        if (alvo.isEmpty() || novo == null) {
            return ContaApi.erro(HttpStatus.BAD_REQUEST, Servidores.Motivo.PEDIDO_INVALIDO.texto);
        }
        return comConta(pedido, usuario -> {
            servidores.mudarPapel(codigo, usuario, alvo.get(), novo);
            return emJson(servidores.ver(codigo, usuario));
        });
    }

    /** A própria conta: sair do servidor. Outra: expulsar (dono, ou admin tirando um membro), e ela sai da sala na hora. */
    @DeleteMapping("/api/servidores/{codigo}/membros/{conta}")
    public ResponseEntity<?> tirar(@PathVariable String codigo, @PathVariable String conta, HttpServletRequest pedido) {
        Optional<UUID> alvo = uuid(conta);
        if (alvo.isEmpty()) {
            return ContaApi.erro(HttpStatus.BAD_REQUEST, Servidores.Motivo.PEDIDO_INVALIDO.texto);
        }
        return comConta(pedido, usuario -> {
            if (alvo.get().equals(usuario)) {
                servidores.sair(codigo, usuario);
            } else {
                servidores.expulsar(codigo, usuario, alvo.get());
                sinalizacao.tirarDoServidor(codigo, alvo.get(), "expulso");
            }
            return null;
        });
    }

    /** Quem foi expulso e não volta por convite (dono e admin). */
    @GetMapping("/api/servidores/{codigo}/bloqueados")
    public ResponseEntity<?> bloqueados(@PathVariable String codigo, HttpServletRequest pedido) {
        return comConta(pedido, usuario -> Map.of("bloqueados", servidores.bloqueados(codigo, usuario).stream().map(bloqueado -> {
            Map<String, Object> json = new LinkedHashMap<>();
            json.put("conta", bloqueado.conta().toString());
            json.put("nome", bloqueado.nome());
            json.put("foto", bloqueado.foto());
            json.put("desde", bloqueado.desde().toString());
            json.put("porQuem", bloqueado.porQuem());
            return json;
        }).toList()));
    }

    /** Desbloqueia (dono e admin): a pessoa pode voltar por um convite. */
    @DeleteMapping("/api/servidores/{codigo}/bloqueados/{conta}")
    public ResponseEntity<?> desbloquear(@PathVariable String codigo, @PathVariable String conta, HttpServletRequest pedido) {
        Optional<UUID> alvo = uuid(conta);
        if (alvo.isEmpty()) {
            return ContaApi.erro(HttpStatus.BAD_REQUEST, Servidores.Motivo.PEDIDO_INVALIDO.texto);
        }
        return comConta(pedido, usuario -> {
            servidores.desbloquear(codigo, usuario, alvo.get());
            return null;
        });
    }

    @GetMapping("/api/servidores/{codigo}/convites")
    public ResponseEntity<?> convites(@PathVariable String codigo, HttpServletRequest pedido) {
        return comConta(pedido, usuario -> Map.of("convites", servidores.convites(codigo, usuario).stream().map(convite -> {
            Map<String, Object> json = new LinkedHashMap<>();
            json.put("codigo", convite.codigo());
            json.put("expiraEm", convite.expiraEm() == null ? null : convite.expiraEm().toString());
            json.put("usosMaximos", convite.usosMaximos());
            json.put("usos", convite.usos());
            json.put("criadoPor", convite.criadoPor());
            return json;
        }).toList()));
    }

    /** Um convite novo: {@code horas} (até 30 dias) e {@code usos} (até 100), cada um opcional (sem: sem limite). */
    @PostMapping("/api/servidores/{codigo}/convites")
    public ResponseEntity<?> convidar(@PathVariable String codigo, @RequestBody NovoConvite novo, HttpServletRequest pedido) {
        return comConta(pedido, usuario -> Map.of("codigo", servidores.convidar(codigo, usuario,
                novo.horas() == null ? null : Duration.ofHours(novo.horas()), novo.usos())));
    }

    @DeleteMapping("/api/servidores/{codigo}/convites/{convite}")
    public ResponseEntity<?> apagarConvite(@PathVariable String codigo, @PathVariable String convite, HttpServletRequest pedido) {
        return comConta(pedido, usuario -> {
            servidores.apagarConvite(codigo, usuario, convite);
            return null;
        });
    }

    /** O que o convite mostra antes de aceitar, mesmo sem conta (a página pede o login depois). */
    @GetMapping("/api/convites/{convite}")
    public ResponseEntity<?> previa(@PathVariable String convite, HttpServletRequest pedido) {
        if (!contas.disponivel()) {
            return ContaApi.erro(HttpStatus.SERVICE_UNAVAILABLE, "contas-indisponiveis");
        }
        if (!convitesPorEndereco.passa(Enderecos.de(pedido))) {
            return ContaApi.erro(HttpStatus.TOO_MANY_REQUESTS, "muitas-tentativas");
        }
        return servidores.previa(convite)
                .<ResponseEntity<?>>map(previa -> {
                    Map<String, Object> json = new LinkedHashMap<>();
                    json.put("nome", previa.nome());
                    json.put("icone", previa.icone());
                    json.put("membros", previa.membros());
                    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(json);
                })
                .orElseGet(() -> ContaApi.erro(Servidores.Motivo.CONVITE_INVALIDO.status, Servidores.Motivo.CONVITE_INVALIDO.texto));
    }

    /** Aceita o convite: vira membro. Devolve o código do servidor, para a página entrar nele. */
    @PostMapping("/api/convites/{convite}")
    public ResponseEntity<?> aceitar(@PathVariable String convite, HttpServletRequest pedido) {
        if (contas.disponivel() && !convitesPorEndereco.passa(Enderecos.de(pedido))) {
            return ContaApi.erro(HttpStatus.TOO_MANY_REQUESTS, "muitas-tentativas");
        }
        return comConta(pedido, usuario -> Map.of("servidor", servidores.aceitar(convite, usuario)));
    }

    @ExceptionHandler(Servidores.Recusa.class)
    ResponseEntity<Map<String, String>> recusa(Servidores.Recusa recusa) {
        return ContaApi.erro(recusa.motivo.status, recusa.motivo.texto);
    }

    private interface Acao {
        /** O corpo da resposta, ou null para 204. */
        Object fazer(UUID usuario);
    }

    /** Roda a ação com a conta da sessão; sem ela, 401 (ou 503 sem banco). */
    private ResponseEntity<?> comConta(HttpServletRequest pedido, Acao acao) {
        if (!contas.disponivel()) {
            return ContaApi.erro(HttpStatus.SERVICE_UNAVAILABLE, "contas-indisponiveis");
        }
        Optional<UUID> usuario = sessoes.usuario(Sessoes.segredoDe(pedido));
        if (usuario.isEmpty()) {
            return ContaApi.erro(HttpStatus.UNAUTHORIZED, "sem-conta");
        }
        Object corpo = acao.fazer(usuario.get());
        return corpo == null ? ResponseEntity.noContent().build() : ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(corpo);
    }

    private static Map<String, Object> emJson(Servidores.Resumo resumo) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("codigo", resumo.codigo());
        json.put("nome", resumo.nome());
        json.put("icone", resumo.icone());
        json.put("papel", resumo.papel().noBanco());
        json.put("membros", resumo.membros());
        return json;
    }

    private static Map<String, Object> emJson(Servidores.Servidor servidor) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("codigo", servidor.codigo());
        json.put("nome", servidor.nome());
        json.put("icone", servidor.icone());
        json.put("papel", servidor.papel().noBanco());
        json.put("membrosConvidam", servidor.membrosConvidam());
        List<Map<String, Object>> membros = servidor.membros().stream().map(membro -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("conta", membro.conta().toString());
            m.put("nome", membro.nome());
            m.put("foto", membro.foto());
            m.put("papel", membro.papel().noBanco());
            return m;
        }).toList();
        json.put("membros", membros);
        return json;
    }

    private static Map<String, Object> mapaCom(String chave, Object valor) {
        Map<String, Object> mapa = new LinkedHashMap<>();
        mapa.put(chave, valor); // Map.of não aceita null (sem ícone)
        return mapa;
    }

    private static Optional<UUID> uuid(String texto) {
        try {
            return texto == null ? Optional.empty() : Optional.of(UUID.fromString(texto));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
