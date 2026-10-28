package dev.ozamigos;

import java.net.InetSocketAddress;

import org.springframework.http.HttpHeaders;

import jakarta.servlet.http.HttpServletRequest;

/**
 * O endereço de quem conectou, para os freios (logins, convites, credenciais da retransmissão). Uma regra só, para o
 * WebSocket e para as páginas: no Render, a Cloudflare fica na frente e escreve no CF-Connecting-IP o endereço de
 * verdade (o que o visitante mandar nesse cabeçalho, ela troca). O endereço remoto do Spring vem do X-Forwarded-For, que
 * começa pelo que o visitante quiser: forjando-o a cada tentativa, dava para escapar de um freio. Sem a Cloudflare
 * (no PC, nos testes), vale o endereço remoto. <b>Se o servidor sair de trás da Cloudflare, troque a regra aqui.</b>
 */
final class Enderecos {

    private Enderecos() {}

    static String de(HttpHeaders cabecalhos, InetSocketAddress remoto) {
        String daCloudflare = daCloudflare(cabecalhos.getFirst("CF-Connecting-IP"));
        if (daCloudflare != null) {
            return daCloudflare;
        }
        if (remoto == null) {
            return "?";
        }
        return remoto.getAddress() != null ? remoto.getAddress().getHostAddress() : remoto.getHostString();
    }

    static String de(HttpServletRequest pedido) {
        String daCloudflare = daCloudflare(pedido.getHeader("CF-Connecting-IP"));
        return daCloudflare != null ? daCloudflare : pedido.getRemoteAddr();
    }

    private static String daCloudflare(String cabecalho) {
        return cabecalho != null && !cabecalho.isBlank() ? cabecalho.strip() : null;
    }
}
