package dev.ozamigos;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;

/**
 * A foto do perfil: baixada do Google ou do Discord no login, só quando mudou, e reduzida aqui a um JPEG de
 * {@value #LADO} px (até {@value #TETO} bytes, a regra da tabela usuarios). Quem está na sala vê a foto pelo Ozamigos
 * ({@code /api/fotos}), nunca pelo provedor. Em segundo plano: o login não espera a foto.
 *
 * <p>O endereço vem da resposta do provedor, mas mesmo assim só sai para os servidores de imagens dele ({@link #HOSTS}),
 * pelo mesmo Buscador das prévias (sem cookies, com tamanho máximo, sem seguir redirecionamentos para fora).
 */
@Component
public class FotosDoPerfil {

    private static final Logger log = LoggerFactory.getLogger(FotosDoPerfil.class);

    static final int LADO = 128;
    static final int TETO = 16 * 1024;
    static final int MAXIMO_BAIXADO = 2_000_000;
    static final List<String> HOSTS = List.of("googleusercontent.com", "cdn.discordapp.com");

    private final Buscador buscador;
    private final Contas contas;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    /** Poucas ao mesmo tempo: depois de um deploy, todos entram de novo juntos. */
    private final Semaphore vagas = new Semaphore(2);

    public FotosDoPerfil(Buscador buscador, Contas contas) {
        this.buscador = buscador;
        this.contas = contas;
    }

    /** A foto que o provedor mandou agora (ou nenhuma), comparada com a guardada ({@code origemAtual}). */
    public void atualizar(UUID usuario, String endereco, String origemAtual) {
        if (Objects.equals(endereco, origemAtual)) {
            return;
        }
        executor.execute(() -> {
            try {
                vagas.acquire();
                try {
                    contas.guardarFoto(usuario, endereco == null ? null : baixar(endereco), endereco);
                } finally {
                    vagas.release();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                // Sem foto, a pessoa aparece com as iniciais, como antes. O endereço não vai para o log.
                log.info("A foto de perfil de {} não veio: {}", usuario, e.getClass().getSimpleName());
            }
        });
    }

    /** O JPEG reduzido, ou null (formato desconhecido, grande demais, ou fora dos servidores de imagens). */
    byte[] baixar(String endereco) throws Exception {
        URI uri;
        try {
            uri = new URI(endereco);
        } catch (URISyntaxException e) {
            return null;
        }
        if (!"https".equals(uri.getScheme()) || !PreviasDeLinks.permitido(uri, HOSTS)) {
            return null;
        }
        Buscador.Resposta resposta = buscador.buscar(uri, MAXIMO_BAIXADO);
        if (resposta.status() != 200) {
            return null;
        }
        return Imagens.jpegReduzido(resposta.corpo(), LADO, TETO, true);
    }

    @PreDestroy
    void parar() {
        executor.shutdownNow();
    }
}
