package dev.ozamigos;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * As prévias dos links de vídeo do chat (título, canal e uma miniatura). Quem busca é o servidor, uma vez para a sala
 * inteira: assim nenhum amigo manda o próprio IP ao site só por receber um link. Só sites de uma lista fechada, e só
 * as imagens dos endereços deles: o servidor nunca busca um endereço qualquer que alguém escreveu no chat (seria uma
 * porta para ele atacar outros endereços, inclusive os da rede dele). A miniatura vai reduzida, dentro da mensagem:
 * ninguém da sala busca nada no site. O link nunca vai para o registro do servidor (é texto do chat).
 */
@Component
public class PreviasDeLinks {

    private static final Logger log = LoggerFactory.getLogger(PreviasDeLinks.class);

    /** aoVivo: um canal da Twitch ou da Kick transmitindo agora (o cartão mostra "AO VIVO"). */
    public record Previa(String url, String site, String titulo, String autor, String miniatura, boolean aoVivo) {}

    enum Fonte { OEMBED, PAGINA, CANAL_DA_TWITCH, CANAL_DA_KICK }

    /**
     * Um link de um site conhecido: onde buscar a prévia dele. Se o oEmbed falhar, paginaReserva é a página de onde
     * tirar as metatags (a do vídeo do YouTube), e imagemReserva a imagem que vale se nem ela der (a miniatura pública
     * do vídeo). Os dois podem ser null. video: o id do vídeo do YouTube (para a API), ou null.
     */
    record Link(String url, String site, URI busca, Fonte fonte, URI paginaReserva, String imagemReserva, String video) {}

    /** imagens: as candidatas, na ordem; vale a primeira que abrir (a da live da Kick, por exemplo, às vezes é recusada). */
    private record Dados(String titulo, String autor, List<String> imagens, boolean aoVivo) {
        Dados(String titulo, String autor, String imagem) {
            this(titulo, autor, imagem, false);
        }

        Dados(String titulo, String autor, String imagem, boolean aoVivo) {
            this(titulo, autor, imagem == null ? List.of() : List.of(imagem), aoVivo);
        }
    }

    private record Guardada(CompletableFuture<Optional<Previa>> previa, long ate) {}

    private static final Pattern LINK = Pattern.compile("https?://\\S+");
    private static final Pattern META = Pattern.compile("<meta\\s[^>]*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern ATRIBUTO = Pattern.compile("([a-zA-Z:-]+)\\s*=\\s*(\"([^\"]*)\"|'([^']*)')");
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,100}");
    private static final Pattern VIDEO_DO_YOUTUBE = Pattern.compile("[A-Za-z0-9_-]{6,20}");
    private static final Pattern CANAL_DA_TWITCH = Pattern.compile("[A-Za-z0-9_]{3,25}");
    private static final Pattern CANAL_DA_KICK = Pattern.compile("[A-Za-z0-9_-]{3,25}");
    // Páginas dos sites com cara de canal ("twitch.tv/directory"), que não são canais.
    private static final List<String> NAO_SAO_CANAIS = List.of("directory", "videos", "settings", "search", "downloads", "jobs", "turbo",
            "prime", "subscriptions", "inventory", "wallet", "drops", "friends", "messages", "login", "signup", "p", "store", "browse",
            "following", "categories", "category", "terms-of-service", "privacy-policy", "community-guidelines", "dashboard", "help");
    // A live na Twitch, na descrição da página, em inglês ou em português (o servidor pede pt-BR):
    // "Título da live | Streaming League of Legends for 3991 viewers." ou "... | Transmitindo ... para 3991 viewers."
    private static final Pattern LIVE_NA_TWITCH = Pattern.compile(
            "^(.*?)\\s*\\|\\s*(?:Streaming|Transmitindo) (.+?) (?:for|para) [\\d,.]+ (?:viewers|espectadores)\\.?$", Pattern.DOTALL);
    private static final Pattern TITULO_DA_TWITCH = Pattern.compile("\\s+-\\s+(?:(Live on|Ao vivo na) )?Twitch$");

    static final int MAXIMO_DO_OEMBED = 100_000;
    static final int MAXIMO_DA_PAGINA = 3_000_000; // a página de um vídeo do YouTube tem ~1,3 MB
    static final int MAXIMO_DA_IMAGEM = 3_000_000;
    /** Imagens maiores que isso (em pixels) nem são abertas: uma "bomba" de 50000×50000 encheria a memória. */
    static final long PIXELS_NO_MAXIMO = 40_000_000;
    static final int LADO_DA_MINIATURA = 400;
    /** A miniatura vai dentro da mensagem do WebSocket: pequena. */
    static final int TETO_DA_MINIATURA = 48_000;
    static final long VALIDADE_MS = TimeUnit.HOURS.toMillis(1);
    static final long VALIDADE_DA_FALHA_MS = TimeUnit.MINUTES.toMillis(2);
    static final int GUARDADAS = 200;
    private static final int REDIRECIONAMENTOS = 3;

    // As páginas que o servidor pode abrir (para as metatags de prévia) e de onde podem vir as imagens.
    private static final List<String> PAGINAS = List.of("youtube.com", "twitch.tv", "clips.twitch.tv", "medal.tv", "kick.com");
    // O canal, na página de um vídeo do YouTube (as metatags og: não trazem).
    private static final Pattern CANAL_DO_YOUTUBE = Pattern.compile("<link itemprop=\"name\" content=\"([^\"]{1,200})\"");
    private static final List<String> IMAGENS = List.of("ytimg.com", "jtvnw.net", "streamable.com", "tiktokcdn.com", "tiktokcdn-us.com", "medal.tv", "kick.com");

    private final Buscador buscador;
    private final JsonMapper json;
    /** A chave da API de dados do YouTube (YOUTUBE_API_KEY): sem ela, o YouTube vai pelo oEmbed e pela página. */
    private final String chaveDoYoutube;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    // Poucas buscas ao mesmo tempo: várias salas mandando links juntas não viram uma enxurrada de pedidos.
    private final Semaphore aoMesmoTempo = new Semaphore(4);
    private final Map<String, Guardada> guardadas = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Guardada> mais) {
            return size() > GUARDADAS;
        }
    };

    @Autowired
    public PreviasDeLinks(Buscador buscador, JsonMapper json, @Value("${ozamigos.youtube.chave:}") String chaveDoYoutube) {
        this.buscador = buscador;
        this.json = json;
        this.chaveDoYoutube = chaveDoYoutube == null ? "" : chaveDoYoutube.strip();
        // Os leitores de imagem extras (o de WebP, para a Kick) são achados agora, no carregador de classes do app:
        // numa thread virtual, o ImageIO poderia não enxergá-los dentro do jar do Spring Boot.
        ImageIO.scanForPlugins();
    }

    PreviasDeLinks(Buscador buscador, JsonMapper json) {
        this(buscador, json, "");
    }

    /** O primeiro link do texto (sem pontuação colada no fim, como "olha isso: https://...!"), ou null. */
    static String primeiroLink(String texto) {
        Matcher m = LINK.matcher(texto);
        if (!m.find()) {
            return null;
        }
        String link = m.group();
        while (!link.isEmpty() && ".,;:!?)]}>'\"".indexOf(link.charAt(link.length() - 1)) >= 0) {
            link = link.substring(0, link.length() - 1);
        }
        return link;
    }

    /** O link é de um site conhecido? Devolve onde buscar a prévia, ou null. */
    static Link reconhecer(String endereco) {
        URI uri;
        try {
            uri = new URI(endereco);
        } catch (URISyntaxException e) {
            return null;
        }
        String esquema = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!esquema.equals("https") && !esquema.equals("http")) {
            return null;
        }
        if (uri.getHost() == null || uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 80 && uri.getPort() != 443)) {
            return null;
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if (host.startsWith("www.")) {
            host = host.substring(4);
        } else if (host.startsWith("m.")) {
            host = host.substring(2);
        }
        String caminho = uri.getRawPath() == null ? "" : uri.getRawPath();
        String[] partes = caminho.replaceAll("^/+|/+$", "").split("/");
        String consulta = uri.getRawQuery() == null ? "" : uri.getRawQuery();

        switch (host) {
            case "youtube.com" -> {
                String video = null;
                Matcher v = Pattern.compile("(?:^|&)v=([A-Za-z0-9_-]{6,20})(?:&|$)").matcher(consulta);
                if (caminho.equals("/watch") && v.find()) {
                    video = v.group(1);
                } else if (partes.length == 2 && (partes[0].equals("shorts") || partes[0].equals("live")) && VIDEO_DO_YOUTUBE.matcher(partes[1]).matches()) {
                    video = partes[1];
                }
                return video == null ? null : youtube(endereco, video);
            }
            case "youtu.be" -> {
                return partes.length == 1 && VIDEO_DO_YOUTUBE.matcher(partes[0]).matches() ? youtube(endereco, partes[0]) : null;
            }
            case "streamable.com" -> {
                return partes.length == 1 && ID.matcher(partes[0]).matches() ? oembed(endereco, "Streamable", "https://api.streamable.com/oembed.json?url=") : null;
            }
            case "tiktok.com" -> {
                boolean video = partes.length == 3 && partes[0].startsWith("@") && partes[1].equals("video") && partes[2].matches("\\d{1,30}");
                return video ? oembed(endereco, "TikTok", "https://www.tiktok.com/oembed?url=") : null;
            }
            case "clips.twitch.tv" -> {
                return partes.length == 1 && ID.matcher(partes[0]).matches() ? pagina(endereco, "Twitch", "https://clips.twitch.tv/" + partes[0]) : null;
            }
            case "twitch.tv" -> {
                if (partes.length == 3 && ID.matcher(partes[0]).matches() && partes[1].equals("clip") && ID.matcher(partes[2]).matches()) {
                    return pagina(endereco, "Twitch", "https://www.twitch.tv/" + partes[0] + "/clip/" + partes[2]);
                }
                if (partes.length == 2 && partes[0].equals("videos") && partes[1].matches("\\d{1,20}")) {
                    return pagina(endereco, "Twitch", "https://www.twitch.tv/videos/" + partes[1]);
                }
                if (partes.length == 1 && CANAL_DA_TWITCH.matcher(partes[0]).matches() && !NAO_SAO_CANAIS.contains(partes[0].toLowerCase(Locale.ROOT))) {
                    String canal = partes[0].toLowerCase(Locale.ROOT);
                    return new Link(endereco, "Twitch", URI.create("https://www.twitch.tv/" + canal), Fonte.CANAL_DA_TWITCH, null, null, null);
                }
                return null;
            }
            case "kick.com" -> {
                if (partes.length == 1 && CANAL_DA_KICK.matcher(partes[0]).matches() && !NAO_SAO_CANAIS.contains(partes[0].toLowerCase(Locale.ROOT))) {
                    String canal = partes[0].toLowerCase(Locale.ROOT);
                    return new Link(endereco, "Kick", URI.create("https://kick.com/api/v2/channels/" + canal), Fonte.CANAL_DA_KICK, null, null, null);
                }
                return null;
            }
            case "medal.tv" -> {
                int clipes = List.of(partes).indexOf("clips");
                boolean clipe = clipes >= 0 && clipes == partes.length - 2 && ID.matcher(partes[partes.length - 1]).matches()
                        && List.of(partes).subList(0, clipes).stream().allMatch(p -> ID.matcher(p).matches());
                return clipe ? pagina(endereco, "Medal", "https://medal.tv/" + String.join("/", partes)) : null;
            }
            default -> {
                return null;
            }
        }
    }

    private static Link oembed(String endereco, String site, String api) {
        return new Link(endereco, site, URI.create(api + URLEncoder.encode(endereco, StandardCharsets.UTF_8)), Fonte.OEMBED, null, null, null);
    }

    /**
     * O YouTube, em degraus. Primeiro a API de dados (com a chave): é a feita para servidores, e não bloqueia. Sem
     * ela, o oEmbed, que o YouTube recusa nos vídeos cujo dono desligou a incorporação em outros sites (401) e, de vez
     * em quando, a pedidos de datacenter (o Render divide os IPs com muitos serviços). Depois a página do vídeo (as
     * metatags que o Discord também lê) e, sem nada, a miniatura pública do vídeo, que fica num endereço fixo.
     */
    private static Link youtube(String endereco, String video) {
        String api = "https://www.youtube.com/oembed?format=json&url=";
        return new Link(endereco, "YouTube", URI.create(api + URLEncoder.encode(endereco, StandardCharsets.UTF_8)), Fonte.OEMBED,
                URI.create("https://www.youtube.com/watch?v=" + video), "https://i.ytimg.com/vi/" + video + "/hqdefault.jpg", video);
    }

    // A página é remontada com as partes conferidas, não com o endereço que veio no chat.
    private static Link pagina(String endereco, String site, String pagina) {
        return new Link(endereco, site, URI.create(pagina), Fonte.PAGINA, null, null, null);
    }

    /**
     * A prévia do link, buscada uma vez e guardada por uma hora (uma falha, por 2 minutos). Pedidos do mesmo link ao
     * mesmo tempo esperam a mesma busca. Vazio se o link não for de um site conhecido ou se o site não responder.
     */
    public CompletableFuture<Optional<Previa>> buscar(String endereco) {
        Link link = reconhecer(endereco);
        if (link == null) {
            return CompletableFuture.completedFuture(Optional.empty());
        }
        long agora = System.currentTimeMillis();
        synchronized (guardadas) {
            Guardada guardada = guardadas.get(link.url());
            if (guardada != null && guardada.ate() > agora) {
                return guardada.previa();
            }
            CompletableFuture<Optional<Previa>> previa = CompletableFuture
                    .supplyAsync(() -> montar(link), executor)
                    .completeOnTimeout(Optional.empty(), 20, TimeUnit.SECONDS);
            guardadas.put(link.url(), new Guardada(previa, agora + VALIDADE_MS));
            previa.thenAccept(resultado -> {
                if (resultado.isEmpty()) {
                    synchronized (guardadas) {
                        guardadas.computeIfPresent(link.url(), (url, g) -> g.previa() == previa ? new Guardada(previa, System.currentTimeMillis() + VALIDADE_DA_FALHA_MS) : g);
                    }
                }
            });
            return previa;
        }
    }

    /*
     * Os motivos de uma prévia não sair vão para o registro com o site e o motivo (o código HTTP ou o tipo do erro),
     * nunca com o link, que é texto do chat: sem isso, uma falha só no servidor de produção (o YouTube recusando
     * pedidos de datacenter, por exemplo) não deixava rastro nenhum.
     */
    private Optional<Previa> montar(Link link) {
        aoMesmoTempo.acquireUninterruptibly();
        try {
            Dados dados = null;
            if (link.video() != null && !chaveDoYoutube.isEmpty()) {
                try {
                    dados = daApiDoYoutube(link.video());
                } catch (IOException | RuntimeException e) {
                    log.info("a API do YouTube não respondeu: {}", e.getClass().getSimpleName());
                }
            }
            if (dados == null) {
                try {
                    dados = switch (link.fonte()) {
                        case OEMBED -> doOembed(link);
                        case PAGINA -> daPagina(link.busca(), link.site());
                        case CANAL_DA_TWITCH -> canalDaTwitch(link);
                        case CANAL_DA_KICK -> canalDaKick(link);
                    };
                } catch (IOException | RuntimeException e) {
                    log.info("a prévia de um link do {} não saiu: {}", link.site(), e.getClass().getSimpleName());
                }
            }
            if (dados == null && link.paginaReserva() != null) {
                try {
                    dados = daPagina(link.paginaReserva(), link.site());
                } catch (IOException | RuntimeException e) {
                    log.info("a página de um link do {} não saiu: {}", link.site(), e.getClass().getSimpleName());
                }
            }
            if (dados == null && link.imagemReserva() != null) {
                dados = new Dados(null, null, link.imagemReserva());
            }
            if (dados == null) {
                return Optional.empty();
            }
            String miniatura = null;
            for (String imagem : dados.imagens()) {
                try {
                    miniatura = miniatura(imagem);
                } catch (VirtualMachineError e) {
                    throw e;
                } catch (Exception | Error e) {
                    // Sem a imagem (formato estranho, ou o Java do servidor sem a parte gráfica): tenta a próxima, ou vai só o título.
                    log.info("a miniatura de um link do {} não saiu: {}", link.site(), e.getClass().getName());
                }
                if (miniatura != null) {
                    break;
                }
            }
            String titulo = cortar(dados.titulo(), 200);
            if (titulo == null && miniatura == null) {
                return Optional.empty();
            }
            return Optional.of(new Previa(link.url(), link.site(), titulo, cortar(dados.autor(), 100), miniatura, dados.aoVivo()));
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Exception | Error e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            log.info("a prévia de um link do {} não saiu: {}", link.site(), e.getClass().getName()); // sem o link: é texto do chat
            return Optional.empty();
        } finally {
            aoMesmoTempo.release();
        }
    }

    private Dados doOembed(Link link) throws IOException, InterruptedException {
        Buscador.Resposta resposta = buscador.buscar(link.busca(), MAXIMO_DO_OEMBED);
        if (resposta.status() != 200) {
            log.info("a prévia de um link do {} não saiu: HTTP {}", link.site(), resposta.status());
            return null;
        }
        JsonNode dados = json.readTree(resposta.corpo());
        return new Dados(texto(dados, "title"), texto(dados, "author_name"), texto(dados, "thumbnail_url"));
    }

    /** A API de dados do YouTube: título, canal, a maior miniatura e se é uma live acontecendo. Null se não der. */
    private Dados daApiDoYoutube(String video) throws IOException, InterruptedException {
        URI api = URI.create("https://www.googleapis.com/youtube/v3/videos?part=snippet&id=" + video + "&key="
                + URLEncoder.encode(chaveDoYoutube, StandardCharsets.UTF_8));
        Buscador.Resposta resposta = buscador.buscar(api, MAXIMO_DO_OEMBED);
        if (resposta.status() != 200) {
            // 403: a cota do dia acabou ou a chave não vale. Sem a chave no registro (ela está no endereço).
            log.info("a API do YouTube não respondeu: HTTP {}", resposta.status());
            return null;
        }
        JsonNode trecho = json.readTree(resposta.corpo()).path("items").path(0).path("snippet");
        if (trecho.isMissingNode()) {
            return null; // vídeo apagado ou privado
        }
        String imagem = null;
        for (String tamanho : List.of("maxres", "standard", "high", "medium", "default")) {
            imagem = texto(trecho.path("thumbnails").path(tamanho), "url");
            if (imagem != null) {
                break;
            }
        }
        boolean aoVivo = "live".equals(texto(trecho, "liveBroadcastContent"));
        return new Dados(texto(trecho, "title"), texto(trecho, "channelTitle"), imagem, aoVivo);
    }

    /**
     * Um canal da Twitch, pela página dele: "Fulano - Live on Twitch" no título quando está ao vivo, com o título da
     * live e o jogo na descrição, e a imagem da live num endereço fixo. Offline, o nome e a foto do canal.
     */
    private Dados canalDaTwitch(Link link) throws IOException, InterruptedException {
        Buscador.Resposta resposta = buscarSeguindo(link.busca(), MAXIMO_DA_PAGINA, PAGINAS);
        if (resposta == null || resposta.status() != 200) {
            log.info("a página de um canal da Twitch não saiu: {}", resposta == null ? "redirecionamento fora da lista" : "HTTP " + resposta.status());
            return null;
        }
        Map<String, String> metas = metatags(new String(resposta.corpo(), StandardCharsets.UTF_8));
        String titulo = metas.getOrDefault("og:title", "");
        Matcher fim = TITULO_DA_TWITCH.matcher(titulo);
        boolean aoVivo = fim.find() && fim.group(1) != null;
        String nome = TITULO_DA_TWITCH.matcher(titulo).replaceFirst("").strip();
        if (nome.isEmpty() || nome.equals("Twitch")) {
            return null; // a página genérica: o canal não existe
        }
        String canal = link.busca().getPath().substring(1);
        if (aoVivo) {
            Matcher live = LIVE_NA_TWITCH.matcher(metas.getOrDefault("og:description", ""));
            String daLive = live.matches() ? live.group(1).strip() : null;
            String jogo = live.matches() ? live.group(2).strip() : null;
            return new Dados(daLive == null || daLive.isEmpty() ? nome : daLive, jogo == null ? nome : nome + " · " + jogo,
                    "https://static-cdn.jtvnw.net/previews-ttv/live_user_" + canal + "-640x360.jpg", true);
        }
        String foto = metas.get("og:image");
        return new Dados(nome, "Canal da Twitch", foto != null && foto.contains("ttv-static-metadata") ? null : foto);
    }

    /** Um canal da Kick, pela API pública do site: a live (título, jogo e imagem) ou, offline, o nome e a foto. */
    private Dados canalDaKick(Link link) throws IOException, InterruptedException {
        Buscador.Resposta resposta = buscarSeguindo(link.busca(), MAXIMO_DO_OEMBED * 3, PAGINAS);
        if (resposta == null || resposta.status() != 200) {
            log.info("o canal da Kick não respondeu: {}", resposta == null ? "redirecionamento fora da lista" : "HTTP " + resposta.status());
            return null;
        }
        JsonNode canal = json.readTree(resposta.corpo());
        String nome = texto(canal.path("user"), "username");
        if (nome == null) {
            return null;
        }
        // A imagem da live (a Kick às vezes recusa a quem não está no site), o banner do canal (16:9) e a foto.
        List<String> imagens = new ArrayList<>();
        JsonNode live = canal.path("livestream");
        boolean aoVivo = live.isObject() && live.path("is_live").asBoolean(false);
        for (String imagem : new String[] {
                aoVivo ? texto(live.path("thumbnail"), "url") : null,
                texto(canal.path("offline_banner_image"), "src"),
                texto(canal.path("banner_image"), "url"),
                texto(canal.path("user"), "profile_pic")}) {
            if (imagem != null) {
                imagens.add(imagem);
            }
        }
        if (aoVivo) {
            String jogo = texto(live.path("categories").path(0), "name");
            String titulo = texto(live, "session_title");
            return new Dados(titulo == null ? nome : titulo, jogo == null ? nome : nome + " · " + jogo, imagens, true);
        }
        return new Dados(nome, "Canal da Kick", imagens, false);
    }

    private static String texto(JsonNode no, String campo) {
        JsonNode valor = no.get(campo);
        return valor != null && valor.isString() && !valor.asString().isBlank() ? valor.asString() : null;
    }

    /** As metatags de prévia (og:title, og:image) da página, seguindo redirecionamentos só dentro dos sites conhecidos. */
    private Dados daPagina(URI pagina, String site) throws IOException, InterruptedException {
        Buscador.Resposta resposta = buscarSeguindo(pagina, MAXIMO_DA_PAGINA, PAGINAS);
        if (resposta == null || resposta.status() != 200) {
            log.info("a página de um link do {} não saiu: {}", site, resposta == null ? "redirecionamento fora da lista" : "HTTP " + resposta.status());
            return null;
        }
        String html = new String(resposta.corpo(), StandardCharsets.UTF_8);
        Map<String, String> metas = metatags(html);
        String titulo = metas.get("og:title");
        if (titulo != null) {
            titulo = titulo.replaceFirst("\\s+-\\s+(Twitch|Medal)$", "").strip();
            if (titulo.isEmpty() || titulo.equals("Twitch") || titulo.equals("Clip") || titulo.equals("VOD")) {
                titulo = null; // a página genérica do site (clipe apagado ou privado)
            }
        }
        String imagem = metas.get("og:image");
        if (imagem != null && imagem.contains("ttv-static-metadata")) {
            imagem = null; // o logotipo da Twitch, não a imagem do clipe
        }
        Matcher canal = CANAL_DO_YOUTUBE.matcher(html);
        String autor = site.equals("YouTube") && canal.find() ? desfazerEntidades(canal.group(1)) : null;
        return titulo == null && imagem == null ? null : new Dados(titulo, autor, imagem);
    }

    static Map<String, String> metatags(String html) {
        Map<String, String> metas = new LinkedHashMap<>();
        Matcher meta = META.matcher(html);
        while (meta.find()) {
            String nome = null;
            String conteudo = null;
            Matcher atributo = ATRIBUTO.matcher(meta.group());
            while (atributo.find()) {
                String chave = atributo.group(1).toLowerCase(Locale.ROOT);
                String valor = atributo.group(3) != null ? atributo.group(3) : atributo.group(4);
                if (chave.equals("property") || chave.equals("name")) {
                    nome = valor.toLowerCase(Locale.ROOT);
                } else if (chave.equals("content")) {
                    conteudo = valor;
                }
            }
            if (nome != null && conteudo != null) {
                metas.putIfAbsent(nome, desfazerEntidades(conteudo));
            }
        }
        return metas;
    }

    private static String desfazerEntidades(String texto) {
        Matcher m = Pattern.compile("&(#x[0-9a-fA-F]+|#\\d+|amp|lt|gt|quot|apos);").matcher(texto);
        StringBuilder saida = new StringBuilder();
        while (m.find()) {
            String e = m.group(1);
            String troca = switch (e) {
                case "amp" -> "&";
                case "lt" -> "<";
                case "gt" -> ">";
                case "quot" -> "\"";
                case "apos" -> "'";
                default -> {
                    int codigo = e.startsWith("#x") ? Integer.parseInt(e.substring(2), 16) : Integer.parseInt(e.substring(1));
                    yield Character.isValidCodePoint(codigo) ? new String(Character.toChars(codigo)) : "";
                }
            };
            m.appendReplacement(saida, Matcher.quoteReplacement(troca));
        }
        m.appendTail(saida);
        return saida.toString();
    }

    /** Busca seguindo até 3 redirecionamentos, cada um conferido: https e um dos hosts permitidos. */
    private Buscador.Resposta buscarSeguindo(URI endereco, int maximo, List<String> permitidos) throws IOException, InterruptedException {
        URI atual = endereco;
        for (int i = 0; i <= REDIRECIONAMENTOS; i++) {
            if (!permitido(atual, permitidos)) {
                return null;
            }
            Buscador.Resposta resposta = buscador.buscar(atual, maximo);
            if (resposta.status() < 300 || resposta.status() >= 400 || resposta.redirecionaPara() == null) {
                return resposta;
            }
            try {
                atual = atual.resolve(new URI(resposta.redirecionaPara()));
            } catch (URISyntaxException e) {
                return null;
            }
        }
        return null;
    }

    static boolean permitido(URI endereco, List<String> hosts) {
        if (!"https".equalsIgnoreCase(endereco.getScheme()) || endereco.getHost() == null || endereco.getRawUserInfo() != null) {
            return false;
        }
        if (endereco.getPort() != -1 && endereco.getPort() != 443) {
            return false;
        }
        String host = endereco.getHost().toLowerCase(Locale.ROOT);
        return hosts.stream().anyMatch(h -> host.equals(h) || host.endsWith("." + h));
    }

    /** A imagem da prévia, reduzida (até 400 px de lado) e em JPEG, como data URL. Null se não der. */
    private String miniatura(String endereco) throws IOException, InterruptedException {
        URI uri;
        try {
            uri = new URI(endereco.startsWith("//") ? "https:" + endereco : endereco);
        } catch (URISyntaxException e) {
            return null;
        }
        Buscador.Resposta resposta = buscarSeguindo(uri, MAXIMO_DA_IMAGEM, IMAGENS);
        if (resposta == null || resposta.status() != 200) {
            return null;
        }
        return reduzir(resposta.corpo());
    }

    static String reduzir(byte[] bytes) throws IOException {
        BufferedImage imagem;
        try (ImageInputStream entrada = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> leitores = ImageIO.getImageReaders(entrada);
            if (!leitores.hasNext()) {
                return null; // um formato que o Java não abre (WebP, por exemplo): a prévia vai sem imagem
            }
            ImageReader leitor = leitores.next();
            try {
                leitor.setInput(entrada, true, true);
                int lado = Math.max(leitor.getWidth(0), leitor.getHeight(0));
                if ((long) leitor.getWidth(0) * leitor.getHeight(0) > PIXELS_NO_MAXIMO) {
                    return null;
                }
                // Lê já reduzida (pulando pixels), até o dobro do lado da miniatura, que a redução bicúbica de baixo
                // acaba de afinar. Inteira, uma imagem de 40 MP ocupava ~160 MB na memória do servidor (com até 4 prévias
                // ao mesmo tempo, num servidor de 512 MB); assim, cabe em ~1 MB.
                ImageReadParam parametros = leitor.getDefaultReadParam();
                int passo = Math.max(1, lado / (LADO_DA_MINIATURA * 2));
                parametros.setSourceSubsampling(passo, passo, 0, 0);
                imagem = leitor.read(0, parametros);
            } finally {
                leitor.dispose();
            }
        }
        double escala = Math.min(1.0, (double) LADO_DA_MINIATURA / Math.max(imagem.getWidth(), imagem.getHeight()));
        int largura = Math.max(1, (int) Math.round(imagem.getWidth() * escala));
        int altura = Math.max(1, (int) Math.round(imagem.getHeight() * escala));
        BufferedImage pequena = new BufferedImage(largura, altura, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = pequena.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.drawImage(imagem, 0, 0, largura, altura, null);
        } finally {
            g.dispose();
        }
        for (float qualidade : new float[] {0.82f, 0.65f, 0.5f}) {
            byte[] jpeg = emJpeg(pequena, qualidade);
            String dados = "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(jpeg);
            if (dados.length() <= TETO_DA_MINIATURA) {
                return dados;
            }
        }
        return null;
    }

    private static byte[] emJpeg(BufferedImage imagem, float qualidade) throws IOException {
        ImageWriter escritor = ImageIO.getImageWritersByFormatName("jpeg").next();
        ByteArrayOutputStream saida = new ByteArrayOutputStream();
        try (MemoryCacheImageOutputStream destino = new MemoryCacheImageOutputStream(saida)) {
            escritor.setOutput(destino);
            ImageWriteParam parametros = escritor.getDefaultWriteParam();
            parametros.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            parametros.setCompressionQuality(qualidade);
            escritor.write(null, new IIOImage(imagem, null, null), parametros);
        } finally {
            escritor.dispose();
        }
        return saida.toByteArray();
    }

    private static String cortar(String texto, int maximo) {
        if (texto == null) {
            return null;
        }
        String limpo = texto.replaceAll("[\\p{Cc}\\p{Cf}]", " ").replaceAll("\\s+", " ").strip();
        if (limpo.isEmpty()) {
            return null;
        }
        return limpo.codePointCount(0, limpo.length()) > maximo ? limpo.substring(0, limpo.offsetByCodePoints(0, maximo)).strip() + "…" : limpo;
    }
}
