package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;

/** A foto do perfil: só dos servidores de imagens do provedor, e sempre reduzida a um JPEG pequeno e quadrado. */
class FotosDoPerfilTest {

    private final List<URI> buscados = new ArrayList<>();
    private final FotosDoPerfil fotos = new FotosDoPerfil((endereco, maximo) -> {
        buscados.add(endereco);
        return new Buscador.Resposta(200, "image/png", png(800, 600), null);
    }, null);

    @Test
    void aFotoDoProvedorViraUmJpegQuadradoPequeno() throws Exception {
        byte[] foto = fotos.baixar("https://lh3.googleusercontent.com/a/abc=s256-c");

        BufferedImage imagem = ImageIO.read(new ByteArrayInputStream(foto));
        assertThat(imagem.getWidth()).isEqualTo(FotosDoPerfil.LADO);
        assertThat(imagem.getHeight()).isEqualTo(FotosDoPerfil.LADO);
        assertThat(foto.length).isLessThanOrEqualTo(FotosDoPerfil.TETO);
        assertThat(fotos.baixar("https://cdn.discordapp.com/avatars/1/abc.png?size=256")).isNotNull();
    }

    @Test
    void foraDosServidoresDeImagensDoProvedorNemBusca() throws Exception {
        assertThat(fotos.baixar("https://exemplo.com/foto.png")).isNull();
        assertThat(fotos.baixar("http://lh3.googleusercontent.com/a/abc")).isNull(); // sem https
        assertThat(fotos.baixar("https://googleusercontent.com.exemplo.com/a")).isNull();
        assertThat(fotos.baixar("https://127.0.0.1/a")).isNull();
        assertThat(buscados).isEmpty();
    }

    private static byte[] png(int largura, int altura) {
        try {
            ByteArrayOutputStream saida = new ByteArrayOutputStream();
            ImageIO.write(new BufferedImage(largura, altura, BufferedImage.TYPE_INT_RGB), "png", saida);
            return saida.toByteArray();
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
