package dev.ozamigos;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Os limites de todo pedido, antes de qualquer outra coisa (e antes de conferir a conta), contra quem quer derrubar o
 * servidor sem nem ter conta:
 * <ul>
 * <li><b>Tamanho do corpo:</b> até {@link #CORPO_MAXIMO} (o JSON das ações é pequeno), e o ícone de um servidor até
 * {@link ServidoresApi#ICONE_MAXIMO}. Sem isso, o servidor lia um corpo de qualquer tamanho antes de saber de quem era, e
 * alguns pedidos enormes enchiam a memória (512 MB no Render).</li>
 * <li><b>Pedidos à API (e aberturas do WebSocket) por endereço:</b> até {@code ozamigos.limite.api-por-minuto} por minuto. Fotos, ícones e a sessão
 * consultam o banco, de 5 conexões; sem um freio, uma enxurrada esgotava as conexões, e uma falha deixa o banco de fora
 * por 30 s para todos (Contas.bancoFalhou).</li>
 * </ul>
 * O endereço só fica na memória, no minuto em que conta (a política de privacidade fala disso).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class LimitesDaApi extends OncePerRequestFilter {

    static final int CORPO_MAXIMO = 16 * 1024;
    /** O ícone: o que o ServidoresApi aceita, mais a folga para ele mesmo responder "grande demais". */
    static final int CORPO_DO_ICONE = ServidoresApi.ICONE_MAXIMO + 1;

    private final Contador porEndereco;

    public LimitesDaApi(@Value("${ozamigos.limite.api-por-minuto:300}") int porMinuto) {
        this.porEndereco = new Contador(porMinuto, 60_000, Contador.CHAVES_NO_MAXIMO, Clock.systemUTC());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest pedido, HttpServletResponse resposta, FilterChain cadeia)
            throws ServletException, IOException {
        // A abertura do WebSocket também consulta o banco (a sessão, ContaNoWebSocket): abrir e fechar sem parar contaria
        // tanto quanto uma enxurrada na API.
        String caminho = pedido.getRequestURI();
        if ((caminho.startsWith("/api/") || caminho.equals("/sinal")) && !porEndereco.passa(Enderecos.de(pedido))) {
            ProtecaoDaApi.recusar(resposta, HttpStatus.TOO_MANY_REQUESTS, "muitas-tentativas");
            return;
        }
        long maximo = maximoDoCorpo(pedido);
        if (pedido.getContentLengthLong() > maximo) {
            ProtecaoDaApi.recusar(resposta, HttpStatus.CONTENT_TOO_LARGE, "grande-demais");
            return;
        }
        // Sem o tamanho no cabeçalho (o corpo em pedaços), o limite vale na leitura. Leituras não têm corpo, e o WebSocket
        // abre por um GET: esses passam como vieram.
        boolean comCorpo = !Set.of("GET", "HEAD", "OPTIONS").contains(pedido.getMethod());
        cadeia.doFilter(comCorpo ? new CorpoLimitado(pedido, maximo) : pedido, resposta);
    }

    /** O corpo passou do limite no meio da leitura (sem o tamanho no cabeçalho). */
    static final class GrandeDemais extends IOException {
        GrandeDemais() {
            super("corpo do pedido grande demais");
        }
    }

    /**
     * Um corpo que não deu para ler vira o erro da API ({@code {erro}}), e não a página de erro do Spring: 413
     * {@code grande-demais} quando passou do limite em pedaços (GrandeDemais), senão 400 {@code pedido-invalido}.
     */
    @RestControllerAdvice
    static class CorpoIlegivel {
        @ExceptionHandler(HttpMessageNotReadableException.class)
        ResponseEntity<?> corpoIlegivel(HttpMessageNotReadableException erro) {
            for (Throwable causa = erro; causa != null; causa = causa.getCause()) {
                if (causa instanceof GrandeDemais) {
                    return ContaApi.erro(HttpStatus.CONTENT_TOO_LARGE, "grande-demais");
                }
            }
            return ContaApi.erro(HttpStatus.BAD_REQUEST, "pedido-invalido");
        }
    }

    private static long maximoDoCorpo(HttpServletRequest pedido) {
        return "PUT".equals(pedido.getMethod()) && pedido.getRequestURI().matches("/api/servidores/[^/]+/icone")
                ? CORPO_DO_ICONE : CORPO_MAXIMO;
    }

    /**
     * Até {@code limite} vezes por chave em cada janela fixa. Ao contrário do Freio (que guarda cada vez, para janelas
     * de minutos com poucas vezes), aqui cada chave é um número: muitas chaves numa enxurrada não enchem a memória.
     */
    static final class Contador {

        /**
         * Mais que isso, as chaves de janelas que já passaram saem (no máximo uma limpeza por segundo: com o mapa cheio,
         * limpar a cada endereço novo seria uma varredura inteira por pedido, dentro da trava). Ainda cheio, os endereços
         * novos dividem uma contagem só ({@link #EXCEDENTE}): numa enxurrada de endereços, eles não passam sem contar.
         */
        static final int CHAVES_NO_MAXIMO = 50_000;
        static final String EXCEDENTE = "*";

        private final int limite;
        private final long janelaMs;
        private final int chavesNoMaximo;
        private final Clock relogio;
        private final Map<String, long[]> contagens = new HashMap<>(); // {início da janela, vezes}
        private long ultimaLimpeza; // 0: a primeira limpeza pode na hora (Long.MIN_VALUE estourava a conta e nunca limpava)

        Contador(int limite, long janelaMs, int chavesNoMaximo, Clock relogio) {
            this.limite = limite;
            this.janelaMs = janelaMs;
            this.chavesNoMaximo = chavesNoMaximo;
            this.relogio = relogio;
        }

        synchronized boolean passa(String chave) {
            long agora = relogio.millis();
            long[] contagem = contagens.get(chave);
            if (contagem == null) {
                if (contagens.size() >= chavesNoMaximo && agora - ultimaLimpeza >= 1_000) {
                    ultimaLimpeza = agora;
                    contagens.values().removeIf(c -> agora - c[0] >= janelaMs);
                }
                if (contagens.size() >= chavesNoMaximo) {
                    contagem = contagens.computeIfAbsent(EXCEDENTE, c -> new long[] {agora, 0});
                } else {
                    contagem = new long[] {agora, 0};
                    contagens.put(chave, contagem);
                }
            }
            if (agora - contagem[0] >= janelaMs) {
                contagem[0] = agora;
                contagem[1] = 0;
            }
            if (contagem[1] >= limite) {
                return false;
            }
            contagem[1]++;
            return true;
        }
    }

    /** O corpo do pedido, que para de ser lido passando de {@code maximo} bytes. */
    private static final class CorpoLimitado extends HttpServletRequestWrapper {

        private final long maximo;
        private ServletInputStream corpo;

        CorpoLimitado(HttpServletRequest pedido, long maximo) {
            super(pedido);
            this.maximo = maximo;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (corpo == null) {
                ServletInputStream original = super.getInputStream();
                corpo = new ServletInputStream() {
                    private long lidos;

                    @Override
                    public int read() throws IOException {
                        int b = original.read();
                        if (b >= 0) {
                            contar(1);
                        }
                        return b;
                    }

                    @Override
                    public int read(byte[] destino, int inicio, int tamanho) throws IOException {
                        int n = original.read(destino, inicio, tamanho);
                        if (n > 0) {
                            contar(n);
                        }
                        return n;
                    }

                    private void contar(int n) throws IOException {
                        lidos += n;
                        if (lidos > maximo) {
                            throw new GrandeDemais();
                        }
                    }

                    @Override
                    public boolean isFinished() {
                        return original.isFinished();
                    }

                    @Override
                    public boolean isReady() {
                        return original.isReady();
                    }

                    @Override
                    public void setReadListener(ReadListener ouvinte) {
                        original.setReadListener(ouvinte);
                    }
                };
            }
            return corpo;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            String codificacao = getCharacterEncoding();
            return new BufferedReader(new InputStreamReader(getInputStream(),
                    codificacao == null ? StandardCharsets.UTF_8 : Charset.forName(codificacao)));
        }
    }
}
