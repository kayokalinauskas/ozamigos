package dev.ozamigos;

import java.io.IOException;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Contra CSRF (outro site fazendo a página de alguém agir na conta dele): as ações da API ({@code /api/**} que não são
 * leitura) só passam com o cabeçalho {@code Origin} igual ao deste servidor. Todo navegador manda o Origin nesses
 * pedidos, e uma página não consegue forjá-lo. O cookie SameSite=Lax (Sessoes) já barra quase tudo; esta é a segunda
 * camada. O WebSocket tem a mesma regra pelo Spring (sem setAllowedOrigins).
 *
 * <p>A origem deste servidor vem do pedido já com os cabeçalhos do proxy aplicados ({@code server.forward-headers-strategy}):
 * no Render, {@code https://} e o domínio público.
 */
@Component
public class ProtecaoDaApi extends OncePerRequestFilter {

    private static final Set<String> LEITURAS = Set.of("GET", "HEAD", "OPTIONS");

    @Override
    protected boolean shouldNotFilter(HttpServletRequest pedido) {
        return !pedido.getRequestURI().startsWith("/api/") || LEITURAS.contains(pedido.getMethod());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest pedido, HttpServletResponse resposta, FilterChain cadeia)
            throws ServletException, IOException {
        String origem = pedido.getHeader("Origin");
        if (origem == null || !origem.equals(origemDoServidor(pedido))) {
            recusar(resposta, HttpStatus.FORBIDDEN, "origem");
            return;
        }
        cadeia.doFilter(pedido, resposta);
    }

    /** A recusa de um filtro, no formato dos erros da API ({@code {erro}}), sem cache. Também a do LimitesDaApi. */
    static void recusar(HttpServletResponse resposta, HttpStatus status, String motivo) throws IOException {
        resposta.setStatus(status.value());
        resposta.setContentType(MediaType.APPLICATION_JSON_VALUE);
        resposta.setHeader("Cache-Control", "no-store");
        resposta.getWriter().write("{\"erro\":\"" + motivo + "\"}");
    }

    static String origemDoServidor(HttpServletRequest pedido) {
        String esquema = pedido.getScheme();
        int porta = pedido.getServerPort();
        boolean portaPadrao = ("https".equals(esquema) && porta == 443) || ("http".equals(esquema) && porta == 80);
        return esquema + "://" + pedido.getServerName() + (portaPadrao ? "" : ":" + porta);
    }
}
