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
        assertThat(PreviasDeLinks.reconhecer("https://www.twitch.tv/Baiano").busca()).hasToString("https://www.twitch.tv/baiano"); // um canal
        assertThat(PreviasDeLinks.reconhecer("https://kick.com/gaules").busca()).hasToString("https://kick.com/api/v2/channels/gaules");
        assertThat(PreviasDeLinks.reconhecer("https://www.twitch.tv/directory")).isNull(); // página do site, não um canal
        assertThat(PreviasDeLinks.reconhecer("https://kick.com/browse")).isNull();
        assertThat(PreviasDeLinks.reconhecer("ftp://youtube.com/watch?v=x")).isNull();
    }

    @Test
    void oPrimeiroLinkSaiSemAPontuacaoColadaNoFim() {
        assertThat(PreviasDeLinks.primeiroLink("olha isso: https://youtu.be/abc!! e https://x.com")).isEqualTo("https://youtu.be/abc");
        assertThat(PreviasDeLinks.primeiroLink("(https://youtu.be/abc)")).isEqualTo("https://youtu.be/abc");
        assertThat(PreviasDeLinks.primeiroLink("sem link")).isNull();
    }

    @Test
    void umaImagemGrandeViraAMiniaturaNaProporcaoCerta() throws Exception {
        // Lida já reduzida (de 6 em 6 pixels): a miniatura sai igual, sem abrir a imagem inteira na memória.
        String dados = PreviasDeLinks.reduzir(png(4800, 2700));
        BufferedImage miniatura = ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(dados.substring(23))));
        assertThat(miniatura.getWidth()).isEqualTo(400);
        assertThat(miniatura.getHeight()).isEqualTo(225);
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
    void seOYoutubeRecusaOOembedOTituloVemDaPaginaDoVideo() throws Exception {
        // Vídeo com a incorporação desligada pelo dono: o oEmbed responde 401, a página continua com as metatags.
        InternetFalsa internet = new InternetFalsa(Map.of(
                "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2FabcDEF12345",
                new Buscador.Resposta(401, "text/html", new byte[0], null),
                "https://www.youtube.com/watch?v=abcDEF12345",
                texto("<meta property=\"og:title\" content=\"It Begins..\"><meta property=\"og:image\" content=\"https://i.ytimg.com/vi/abcDEF12345/maxresdefault.jpg\"><link itemprop=\"name\" content=\"O Canal &amp; Cia\">"),
                "https://i.ytimg.com/vi/abcDEF12345/maxresdefault.jpg", new Buscador.Resposta(200, "image/png", png(1280, 720), null)));
        PreviasDeLinks previas = new PreviasDeLinks(internet, JsonMapper.builder().build());

        PreviasDeLinks.Previa previa = previas.buscar("https://youtu.be/abcDEF12345").get(5, TimeUnit.SECONDS).orElseThrow();

        assertThat(previa.titulo()).isEqualTo("It Begins..");
        assertThat(previa.autor()).isEqualTo("O Canal & Cia");
        assertThat(previa.miniatura()).startsWith("data:image/jpeg;base64,");
    }

    @Test
    void seOYoutubeRecusaOOembedEAPaginaOCartaoSaiComAMiniaturaPublicaDoVideo() throws Exception {
        InternetFalsa internet = new InternetFalsa(Map.of(
                "https://i.ytimg.com/vi/hkm-8j0osQI/hqdefault.jpg", new Buscador.Resposta(200, "image/png", png(480, 360), null)));
        PreviasDeLinks previas = new PreviasDeLinks(internet, JsonMapper.builder().build());

        PreviasDeLinks.Previa previa = previas.buscar("https://www.youtube.com/watch?v=hkm-8j0osQI").get(5, TimeUnit.SECONDS).orElseThrow();

        assertThat(previa.titulo()).isNull(); // o oEmbed e a página responderam 404 (a internet falsa não os conhece)
        assertThat(previa.miniatura()).startsWith("data:image/jpeg;base64,");
    }

    @Test
    void comAChaveOYoutubeVemDaApiOficialSemPassarPeloOembed() throws Exception {
        InternetFalsa internet = new InternetFalsa(Map.of(
                "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=hkm-8j0osQI&key=chave-de-teste",
                texto("{\"items\":[{\"snippet\":{\"title\":\"O PENTA\",\"channelTitle\":\"Yoda SL\",\"liveBroadcastContent\":\"none\","
                        + "\"thumbnails\":{\"high\":{\"url\":\"https://i.ytimg.com/vi/hkm-8j0osQI/hqdefault.jpg\"},\"maxres\":{\"url\":\"https://i.ytimg.com/vi/hkm-8j0osQI/maxresdefault.jpg\"}}}}]}"),
                "https://i.ytimg.com/vi/hkm-8j0osQI/maxresdefault.jpg", new Buscador.Resposta(200, "image/png", png(1280, 720), null)));
        PreviasDeLinks previas = new PreviasDeLinks(internet, JsonMapper.builder().build(), "chave-de-teste");

        PreviasDeLinks.Previa previa = previas.buscar("https://www.youtube.com/watch?v=hkm-8j0osQI").get(5, TimeUnit.SECONDS).orElseThrow();

        assertThat(previa.titulo()).isEqualTo("O PENTA");
        assertThat(previa.autor()).isEqualTo("Yoda SL");
        assertThat(previa.miniatura()).startsWith("data:image/jpeg;base64,");
        assertThat(internet.pedidos).noneMatch(p -> p.contains("oembed")); // a maior miniatura, e nada de oEmbed
    }

    @Test
    void umCanalDaTwitchAoVivoMostraOTituloDaLiveOJogoEAImagemDaLive() throws Exception {
        InternetFalsa internet = new InternetFalsa(Map.of(
                "https://www.twitch.tv/baiano",
                texto("<meta property=\"og:title\" content=\"Baiano - Ao vivo na Twitch\"/><meta property=\"og:description\" "
                        + "content=\"FURIA x MVK | WORLDS 2026 | Transmitindo league of legends para 3991 viewers.\"/>"),
                "https://static-cdn.jtvnw.net/previews-ttv/live_user_baiano-640x360.jpg", new Buscador.Resposta(200, "image/png", png(640, 360), null)));
        PreviasDeLinks previas = new PreviasDeLinks(internet, JsonMapper.builder().build());

        PreviasDeLinks.Previa previa = previas.buscar("https://www.twitch.tv/baiano").get(5, TimeUnit.SECONDS).orElseThrow();

        assertThat(previa.aoVivo()).isTrue();
        assertThat(previa.titulo()).isEqualTo("FURIA x MVK | WORLDS 2026"); // o "|" do título da live fica
        assertThat(previa.autor()).isEqualTo("Baiano · league of legends");
        assertThat(previa.miniatura()).startsWith("data:image/jpeg;base64,");
    }

    @Test
    void umCanalDaKickOfflineMostraONomeEAFotoEmWebp() throws Exception {
        InternetFalsa internet = new InternetFalsa(Map.of(
                "https://kick.com/api/v2/channels/gaules",
                texto("{\"user\":{\"username\":\"Gaules\",\"profile_pic\":\"https://files.kick.com/images/user/1/foto.webp\"},\"livestream\":null}"),
                "https://files.kick.com/images/user/1/foto.webp",
                new Buscador.Resposta(200, "image/webp", Base64.getDecoder().decode(WEBP_8X8), null)));
        PreviasDeLinks previas = new PreviasDeLinks(internet, JsonMapper.builder().build());

        PreviasDeLinks.Previa previa = previas.buscar("https://kick.com/gaules").get(5, TimeUnit.SECONDS).orElseThrow();

        assertThat(previa.aoVivo()).isFalse();
        assertThat(previa.titulo()).isEqualTo("Gaules");
        assertThat(previa.autor()).isEqualTo("Canal da Kick");
        assertThat(previa.miniatura()).startsWith("data:image/jpeg;base64,"); // o WebP abriu e virou JPEG
    }

    /** Um WebP de 8×8 pixels (gerado pelo Chrome), para conferir que o leitor de WebP está no servidor. */
    private static final String WEBP_8X8 = "UklGRhoCAABXRUJQVlA4WAoAAAAgAAAABwAABwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggLAAAAHABAJ0BKggACAABQCYloAJ0AUAAAP7aJuuLmyIo/+vR//56P//PR/nAAAAA";

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
