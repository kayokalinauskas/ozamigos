package dev.ozamigos;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;

/**
 * A conta de quem está na página: quem é, o nome, a foto, sair, apagar tudo e os provedores ligados; e a troca do
 * código do login do app pela sessão (CodigosDoApp). As ações (POST, PATCH, DELETE) só valem vindas da própria página
 * (ProtecaoDaApi). Nada daqui é guardado em cache.
 *
 * <p>Erros: 401 {@code sem-conta} (sem sessão), 503 {@code contas-indisponiveis} (sem banco, ou ele fora do ar), 409
 * {@code ultima} (o último provedor não sai: para isso, apagar a conta), 429 {@code muitas-tentativas}.
 */
@RestController
public class ContaApi {

    record NovoNome(String nome) {}

    record Codigo(String codigo) {}

    record Confirmacao(Boolean confirmar) {}

    private final Contas contas;
    private final Sessoes sessoes;
    private final ProvedoresDeLogin provedores;
    private final CodigosDoApp codigos;
    /** Trocas de código por endereço: uma por login de verdade, então 20 a cada 10 minutos sobram. */
    private final Freio trocas = new Freio(20, Duration.ofMinutes(10));

    public ContaApi(Contas contas, Sessoes sessoes, ProvedoresDeLogin provedores, CodigosDoApp codigos) {
        this.contas = contas;
        this.sessoes = sessoes;
        this.provedores = provedores;
        this.codigos = codigos;
    }

    /**
     * Quem é a pessoa ({@code conta}, ou null para convidado) e com o que dá para entrar ({@code login}: vazio sem banco
     * ou sem provedores). A página pergunta isto ao abrir.
     */
    @GetMapping("/api/eu")
    public ResponseEntity<Map<String, Object>> eu(HttpServletRequest pedido) {
        Map<String, Object> corpo = new LinkedHashMap<>();
        corpo.put("login", contas.disponivel() ? provedores.disponiveis() : List.of());
        corpo.put("conta", usuario(pedido).flatMap(contas::usuario).map(ContaApi::emJson).orElse(null));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(corpo);
    }

    @PatchMapping("/api/eu")
    public ResponseEntity<?> renomear(@RequestBody NovoNome novo, HttpServletRequest pedido) {
        Optional<UUID> usuario = usuario(pedido);
        if (usuario.isEmpty()) {
            return semConta();
        }
        String nome = contas.renomear(usuario.get(), novo.nome() == null ? "" : novo.nome());
        return nome == null ? semConta() : ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("nome", nome));
    }

    @PostMapping("/api/eu/sair")
    public ResponseEntity<?> sair(HttpServletRequest pedido) {
        if (contas.disponivel()) {
            sessoes.encerrar(Sessoes.segredoDe(pedido));
        }
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, Sessoes.cookieApagado().toString()).build();
    }

    /** Apaga a conta e tudo dela, na hora (LGPD). Pede {@code {"confirmar": true}}: um clique perdido não apaga nada. */
    @DeleteMapping("/api/eu")
    public ResponseEntity<?> apagar(@RequestBody(required = false) Confirmacao confirmacao, HttpServletRequest pedido) {
        Optional<UUID> usuario = usuario(pedido);
        if (usuario.isEmpty()) {
            return semConta();
        }
        if (confirmacao == null || !Boolean.TRUE.equals(confirmacao.confirmar())) {
            return erro(HttpStatus.BAD_REQUEST, "confirme");
        }
        contas.apagar(usuario.get());
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, Sessoes.cookieApagado().toString()).build();
    }

    @DeleteMapping("/api/eu/provedores/{provedor}")
    public ResponseEntity<?> desligar(@PathVariable String provedor, HttpServletRequest pedido) {
        Optional<UUID> usuario = usuario(pedido);
        if (usuario.isEmpty()) {
            return semConta();
        }
        return switch (contas.desligar(usuario.get(), provedor)) {
            case DESLIGADA, NAO_TINHA -> ResponseEntity.noContent().build();
            case ULTIMA -> erro(HttpStatus.CONFLICT, "ultima");
        };
    }

    /**
     * Ligar mais um provedor pelo app: o navegador do sistema não tem a sessão do app, então a página pede um código de
     * uso único (2 minutos) e o leva no endereço do login ({@code /conta/ligar/...?ligacao=}).
     */
    @PostMapping("/api/eu/ligacao")
    public ResponseEntity<?> codigoDeLigacao(HttpServletRequest pedido) {
        Optional<UUID> usuario = usuario(pedido);
        if (usuario.isEmpty()) {
            return semConta();
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(Map.of("ligacao", codigos.criar(usuario.get(), CodigosDoApp.Uso.LIGACAO)));
    }

    /** O app troca o código que recebeu na porta local (CodigosDoApp) pela sessão, no cookie da janela dele. */
    @PostMapping("/api/conta/codigo")
    public ResponseEntity<?> trocarCodigo(@RequestBody Codigo codigo, HttpServletRequest pedido) {
        if (!contas.disponivel()) {
            return erro(HttpStatus.SERVICE_UNAVAILABLE, "contas-indisponiveis");
        }
        if (!trocas.passa(Enderecos.de(pedido))) {
            return erro(HttpStatus.TOO_MANY_REQUESTS, "muitas-tentativas");
        }
        Optional<UUID> usuario = codigos.trocar(codigo.codigo(), CodigosDoApp.Uso.LOGIN);
        if (usuario.isEmpty()) {
            return erro(HttpStatus.BAD_REQUEST, "codigo-invalido");
        }
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, Sessoes.cookie(sessoes.criar(usuario.get(), "app")).toString()).build();
    }

    /**
     * A foto de alguém da sala. O endereço tem a versão ({@code ?v=}), então a foto pode ficar no cache por um ano: uma
     * foto nova tem endereço novo.
     */
    @GetMapping("/api/fotos/{id}")
    public ResponseEntity<byte[]> foto(@PathVariable String id) {
        UUID usuario;
        try {
            usuario = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
        if (!contas.disponivel()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        return contas.foto(usuario)
                .map(foto -> ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG)
                        .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
                        .body(foto))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /** O endereço da foto de uma conta, com a versão; null sem foto. */
    static String enderecoDaFoto(Contas.Usuario usuario) {
        return usuario.temFoto() ? "/api/fotos/" + usuario.id() + "?v=" + usuario.fotoVersao() : null;
    }

    private static Map<String, Object> emJson(Contas.Usuario usuario) {
        Map<String, Object> conta = new LinkedHashMap<>();
        conta.put("id", usuario.id().toString());
        conta.put("nome", usuario.nome());
        conta.put("foto", enderecoDaFoto(usuario));
        conta.put("provedores", usuario.provedores());
        return conta;
    }

    private Optional<UUID> usuario(HttpServletRequest pedido) {
        return sessoes.usuario(Sessoes.segredoDe(pedido));
    }

    private ResponseEntity<Map<String, String>> semConta() {
        return contas.disponivel() ? erro(HttpStatus.UNAUTHORIZED, "sem-conta")
                : erro(HttpStatus.SERVICE_UNAVAILABLE, "contas-indisponiveis");
    }

    static ResponseEntity<Map<String, String>> erro(HttpStatus status, String motivo) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(Map.of("erro", motivo));
    }
}
