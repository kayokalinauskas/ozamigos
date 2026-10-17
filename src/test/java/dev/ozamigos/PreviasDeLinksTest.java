package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;

class PreviasDeLinksTest {

    /** A internet de mentira: cada endereço responde o que o teste mandar, e anota o que foi pedido. */
    static class InternetFalsa implements Buscador {
        final Map<String, Resposta> respostas;
        final List<String> pedidos = new ArrayList<>();

        InternetFalsa(Map<String, Resposta> respostas) {
            this.respostas = respostas;
        }

        @Override
        public synchronized Resposta buscar(URI endereco, int maximoDeBytes) {
            pedidos.add(endereco.toString());
            return respostas.getOrDefault(endereco.toString(), new Resposta(404, "", new byte[0], null));
        }
    }

    static Buscador.Resposta texto(String corpo) {
        return new Buscador.Resposta(200, "text/html", corpo.getBytes(StandardCharsets.UTF_8), null);
    }

    static byte[] png(int largura, int altura) throws Exception {
        BufferedImage imagem = new BufferedImage(largura, altura, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = imagem.createGraphics();
        g.setColor(new Color(40, 90, 160));
        g.fillRect(0, 0, largura, altura);
        g.dispose();
        ByteArrayOutputStream saida = new ByteArrayOutputStream();
        ImageIO.write(imagem, "png", saida);
        return saida.toByteArray();
    }

    @Test
    void reconheceSoOsLinksDeVideoDosSitesConhecidos() {
        assertThat(PreviasDeLinks.reconhecer("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42").site()).isEqualTo("YouTube");
        assertThat(PreviasDeLinks.reconhecer("https://youtu.be/dQw4w9WgXcQ")).isNotNull();
        assertThat(PreviasDeLinks.reconhecer("https://m.youtube.com/shorts/aqz-KE-bpKQ")).isNotNull();
        assertThat(PreviasDeLinks.reconhecer("https://clips.twitch.tv/AwkwardHelplessSalamander").busca())
                .hasToString("https://clips.twitch.tv/AwkwardHelplessSalamander");
        assertThat(PreviasDeLinks.reconhecer("https://www.twitch.tv/gaules/clip/Abc-123?filter=clips").busca())
                .hasToString("https://www.twitch.tv/gaules/clip/Abc-123"); // remontado só com as partes conferidas
        assertThat(PreviasDeLinks.reconhecer("https://www.tiktok.com/@alguem/video/6718335390845095173").site()).isEqualTo("TikTok");
        assertThat(PreviasDeLinks.reconhecer("https://medal.tv/games/valorant/clips/abc123").site()).isEqualTo("Medal");

        // Nada fora da lista, nem disfarçado dela.
        assertThat(PreviasDeLinks.reconhecer("https://youtube.com.golpe.com/watch?v=x")).isNull();
        assertThat(PreviasDeLinks.reconhecer("https://golpe.com/?u=https://youtube.com/watch?v=x")).isNull();
        assertThat(PreviasDeLinks.reconhecer("https://usuario@youtube.com/watch?v=x")).isNull();
        assertThat(PreviasDeLinks.reconhecer("https://youtube.com:8080/watch?v=x")).isNull();
        assertThat(PreviasDeLinks.reconhecer("https://www.youtube.com/@canal")).isNull(); // um canal, não um vídeo
        assertThat(PreviasDeLinks.reconhecer("https://www.twitch.tv/gaules")).isNull();
        assertThat(PreviasDeLinks.reconhecer("ftp://youtube.com/watch?v=x")).isNull();
    }

    @Test
    void oPrimeiroLinkSaiSemAPontuacaoColadaNoFim() {
        assertThat(PreviasDeLinks.primeiroLink("olha isso: https://youtu.be/abc!! e https://x.com")).isEqualTo("https://youtu.be/abc");
        assertThat(PreviasDeLinks.primeiroLink("(https://youtu.be/abc)")).isEqualTo("https://youtu.be/abc");
        assertThat(PreviasDeLinks.primeiroLink("sem link")).isNull();
    }

    @Test
    void aPreviaDoYoutubeVemDoOembedComAMiniaturaReduzidaEFicaGuardada() throws Exception {
        String link = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        InternetFalsa internet = new InternetFalsa(Map.of(
                "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
                texto("{\"title\":\"Never Gonna Give You Up\",\"author_name\":\"Rick Astley\",\"thumbnail_url\":\"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg\"}"),
                "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                new Buscador.Resposta(200, "image/png", png(1280, 720), null)));
        PreviasDeLinks previas = new PreviasDeLinks(internet, JsonMapper.builder().build());

        PreviasDeLinks.Previa previa = previas.buscar(link).get(5, TimeUnit.SECONDS).orElseThrow();

        assertThat(previa.site()).isEqualTo("YouTube");
        assertThat(previa.titulo()).isEqualTo("Never Gonna Give You Up");
        assertThat(previa.autor()).isEqualTo("Rick Astley");
        assertThat(previa.miniatura()).startsWith("data:image/jpeg;base64,").hasSizeLessThanOrEqualTo(PreviasDeLinks.TETO_DA_MINIATURA);
        BufferedImage miniatura = ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(previa.miniatura().substring(23))));
        assertThat(miniatura.getWidth()).isEqualTo(400);
        assertThat(miniatura.getHeight()).isEqualTo(225);

        previas.buscar(link).get(5, TimeUnit.SECONDS); // o mesmo link de novo: não busca outra vez
        assertThat(internet.pedidos).hasSize(2);
    }

    @Test
    void seOYoutubeRecusaOOembedOCartaoSaiComAMiniaturaPublicaDoVideo() throws Exception {
        InternetFalsa internet = new InternetFalsa(Map.of(
                "https://i.ytimg.com/vi/hkm-8j0osQI/hqdefault.jpg", new Buscador.Resposta(200, "image/png", png(480, 360), null)));
        PreviasDeLinks previas = new PreviasDeLinks(internet, JsonMapper.builder().build());

        PreviasDeLinks.Previa previa = previas.buscar("https://www.youtube.com/watch?v=hkm-8j0osQI").get(5, TimeUnit.SECONDS).orElseThrow();

        assertThat(previa.titulo()).isNull(); // o oEmbed respondeu 404 (a internet falsa não o conhece)
        assertThat(previa.miniatura()).startsWith("data:image/jpeg;base64,");
    }

    @Test
    void imagemDeUmEnderecoForaDaListaNaoEhBuscadaEAPaginaSoSegueRedirecionamentoPermitido() throws Exception {
        InternetFalsa internet = new InternetFalsa(Map.of(
                "https://clips.twitch.tv/ClipeBom",
                texto("<meta property=\"og:title\" content=\"Que jogada &amp; que sorte - Twitch\"/><meta content=\"http://169.254.169.254/x.png\" property=\"og:image\">"),
                "https://clips.twitch.tv/ClipeQueRedireciona",
                new Buscador.Resposta(302, "", new byte[0], "https://192.168.0.1/admin")));
        PreviasDeLinks previas = new PreviasDeLinks(internet, JsonMapper.builder().build());

        Optional<PreviasDeLinks.Previa> boa = previas.buscar("https://clips.twitch.tv/ClipeBom").get(5, TimeUnit.SECONDS);
        Optional<PreviasDeLinks.Previa> desviada = previas.buscar("https://clips.twitch.tv/ClipeQueRedireciona").get(5, TimeUnit.SECONDS);

        assertThat(boa.orElseThrow().titulo()).isEqualTo("Que jogada & que sorte");
        assertThat(boa.orElseThrow().miniatura()).isNull();
        assertThat(desviada).isEmpty();
        assertThat(internet.pedidos).containsExactly("https://clips.twitch.tv/ClipeBom", "https://clips.twitch.tv/ClipeQueRedireciona");
    }
}
