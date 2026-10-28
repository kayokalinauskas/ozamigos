package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;

/** O endereço dos freios: o da Cloudflare, nunca o X-Forwarded-For que o visitante escreve como quiser. */
class EnderecosTest {

    @Test
    void forjarOXForwardedForNaoMudaOEndereco() {
        HttpHeaders cabecalhos = new HttpHeaders();
        cabecalhos.add("CF-Connecting-IP", " 203.0.113.9 ");
        cabecalhos.add("X-Forwarded-For", "198.51.100.1");

        assertThat(Enderecos.de(cabecalhos, new InetSocketAddress("10.0.0.1", 443))).isEqualTo("203.0.113.9");
        assertThat(Enderecos.de(new HttpHeaders(), new InetSocketAddress("10.0.0.1", 443))).isEqualTo("10.0.0.1"); // fora da Cloudflare
    }
}
