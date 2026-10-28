package dev.ozamigos;

import java.io.Serializable;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;

import jakarta.servlet.http.HttpServletRequest;

/**
 * O começo do login: {@code /conta/entrar/google} (ou {@code discord}) guarda para onde a pessoa volta e, no app, a
 * porta e o estado do login pelo navegador (CodigosDoApp); então segue para o provedor, pelo Spring Security. A volta
 * é do AoEntrar. {@code /conta/ligar/...} faz o mesmo para ligar mais um provedor a quem já tem conta.
 *
 * <p>Erros voltam para a entrada com {@code ?erro-de-login=<motivo>}, ou, no app, para a porta dele com
 * {@code erro=<motivo>}.
 */
@Controller
public class Login {

    /** O login em andamento, na sessão HTTP (só durante a ida ao provedor). */
    record Pedido(String voltar, Integer portaDoApp, String estado, UUID ligarA) implements Serializable {}

    static final String PEDIDO = "ozamigos.login";
    /** Para onde voltar: um caminho deste servidor, nunca outro site (//outro.site é outro site). */
    private static final Pattern VOLTAR = Pattern.compile("/(?![/\\\\])[A-Za-z0-9/_.?=&%-]{0,200}");
    private static final Pattern ESTADO = Pattern.compile("[A-Za-z0-9_-]{16,64}");

    private final ProvedoresDeLogin provedores;
    private final Contas contas;
    private final Sessoes sessoes;
    /** Cada endereço começa até 20 logins a cada 10 minutos (cada um é uma ida ao Google ou ao Discord). */
    private final Freio comecos = new Freio(20, Duration.ofMinutes(10));

    public Login(ProvedoresDeLogin provedores, Contas contas, Sessoes sessoes) {
        this.provedores = provedores;
        this.contas = contas;
        this.sessoes = sessoes;
    }

    @GetMapping("/conta/entrar/{provedor}")
    public String entrar(@PathVariable String provedor, @RequestParam(defaultValue = "/") String voltar,
            @RequestParam(required = false) Integer app, @RequestParam(required = false) String estado,
            HttpServletRequest pedido) {
        return comecar(provedor, voltar, app, estado, null, pedido);
    }

    @GetMapping("/conta/ligar/{provedor}")
    public String ligar(@PathVariable String provedor, @RequestParam(defaultValue = "/") String voltar,
            HttpServletRequest pedido) {
        Optional<UUID> usuario = sessoes.usuario(Sessoes.segredoDe(pedido));
        if (usuario.isEmpty()) {
            return "redirect:/?erro-de-login=sem-conta";
        }
        return comecar(provedor, voltar, null, null, usuario.get(), pedido);
    }

    private String comecar(String provedor, String voltar, Integer app, String estado, UUID ligarA,
            HttpServletRequest pedido) {
        boolean doApp = app != null;
        if (doApp && (app < 1024 || app > 65535 || estado == null || !ESTADO.matcher(estado).matches())) {
            return "redirect:/?erro-de-login=pedido-invalido";
        }
        String destino = VOLTAR.matcher(voltar).matches() ? voltar : "/";
        String erro = null;
        if (!provedores.existe(provedor) || !contas.disponivel()) {
            erro = "indisponivel";
        } else if (!comecos.passa(endereco(pedido))) {
            erro = "muitas-tentativas";
        }
        if (erro != null) {
            return "redirect:" + (doApp ? voltaDoApp(app, estado, "erro", erro) : comErro(destino, erro));
        }
        // Uma sessão HTTP nova para cada login: nada de um login anterior pela metade vale para este.
        var antiga = pedido.getSession(false);
        if (antiga != null) {
            antiga.invalidate();
        }
        pedido.getSession(true).setAttribute(PEDIDO, new Pedido(destino, app, estado, ligarA));
        return "redirect:/oauth2/authorization/" + provedor;
    }

    /** O endereço da página do app que recebe o código (ou o erro), no próprio PC. */
    static String voltaDoApp(int porta, String estado, String campo, String valor) {
        return "http://127.0.0.1:" + porta + "/login?" + campo + "=" + valor + "&estado=" + estado;
    }

    static String comErro(String voltar, String erro) {
        return voltar + (voltar.contains("?") ? "&" : "?") + "erro-de-login=" + erro;
    }

    /** O endereço de quem pediu, pela mesma regra do WebSocket (o CF-Connecting-IP da Cloudflare, senão o remoto). */
    static String endereco(HttpServletRequest pedido) {
        String daCloudflare = pedido.getHeader("CF-Connecting-IP");
        if (daCloudflare != null && !daCloudflare.isBlank()) {
            return daCloudflare.strip();
        }
        return pedido.getRemoteAddr();
    }
}
