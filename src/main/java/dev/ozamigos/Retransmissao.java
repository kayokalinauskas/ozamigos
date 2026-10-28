package dev.ozamigos;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;

/**
 * A retransmissão (o TURN da Cloudflare, 19/10/2026): quando dois PCs não conseguem se conectar direto (CGNAT, 4G,
 * rede de empresa, os dois lados com NAT restritivo), a voz, as imagens e o vídeo passam por ela. Só é usada quando
 * o caminho direto falha: entre quem conecta direto, nada muda e nada é gasto.
 *
 * <p>A Cloudflare dá 1.000 GB por mês e cobra o que passar (US$ 0,05/GB), não tem teto de gastos, e <b>o dono tem um
 * cartão cadastrado nela</b>: o teto é este. <b>Só quem entrou com conta recebe credenciais</b> (decisão do dono,
 * 27/10/2026; até então, qualquer pessoa numa sala; desde 28/10/2026, todos têm conta). O abuso é contido assim:
 * <ul>
 * <li>cada pessoa recebe <b>duas credenciais, uma para a voz e outra para o vídeo</b> ({@link Uso}; 26/10/2026, pedido
 * do dono): a Cloudflare mede cada uma, e quem gasta muito perde só o vídeo e continua conversando. A voz (com as
 * imagens do chat) gasta ~0,03 GB por hora; passar de {@code LIMITE_DE_VOZ_POR_ENDERECO} na voz não é conversa, é
 * abuso, e corta as duas;
 * <li>as credenciais são só de quem entrou numa sala, e são <b>canceladas</b> na Cloudflare
 * {@code REVOGAR_DEPOIS_DE_SAIR} depois de a pessoa sair (copiadas para fora do Ozamigos, só valem enquanto ela fica);
 * <li>a cada {@code CONFERIR_A_CADA}, o consumo é lido na própria Cloudflare, por credencial (então por endereço e por
 * uso). Os limites estão nas constantes abaixo: o vídeo para antes (por pessoa e no total), a voz só no teto. Os
 * limites "por endereço" valem também por conta, o que chegar primeiro: trocar de rede não renova o da pessoa, e várias
 * contas no mesmo endereço também não;
 * <li>cada endereço recebe credenciais novas no máximo {@code CREDENCIAIS_POR_ENDERECO} vezes a cada
 * {@code JANELA_DE_CREDENCIAIS};
 * <li>sem conseguir ler o consumo há {@code CONSUMO_VALE_POR}, ninguém recebe credencial nova (falha fechada).
 * </ul>
 * Desligada, o Ozamigos funciona como antes dela: só conexões diretas. O que passa do corte é no máximo o consumo de
 * alguns minutos, muito menos que a folga entre o teto e a franquia.
 */
@Component
public class Retransmissao {

    private static final Logger log = LoggerFactory.getLogger(Retransmissao.class);

    /** As duas credenciais de cada pessoa: a voz (e as imagens do chat, que vão pela conexão de voz) e o vídeo. */
    enum Uso { VOZ, VIDEO }

    /**
     * Para a página: os iceServers de cada uso (a lista vazia: sem retransmissão para ele), e por que o vídeo está sem:
     * {@code "seu"} (este endereço passou do limite do dia: a página explica que foi o uso dele) ou {@code "geral"} (o
     * total de todos chegou perto do teto). Null: o vídeo não foi cortado.
     */
    record Credenciais(ArrayNode voz, ArrayNode video, String limiteDoVideo) {}

    static final long GB = 1_000_000_000L;
    /**
     * O teto, para tudo: metade da franquia (1.000 GB), e não 800 como até 26/10/2026, quando o dono precisou cadastrar
     * um cartão na Cloudflare. A folga cobre o que escapa da vigilância (a amostragem das estatísticas, os minutos entre
     * uma leitura e outra).
     */
    static final long LIMITE_DO_PERIODO = 500 * GB;
    static final int DIAS_DO_PERIODO = 31;
    static final long LIMITE_DO_DIA = 50 * GB;
    /** O vídeo para antes do teto, para a voz de quem depende da retransmissão continuar até ele. */
    static final long LIMITE_DO_PERIODO_DO_VIDEO = 450 * GB;
    static final long LIMITE_DO_DIA_DO_VIDEO = 45 * GB;
    /** ~5 horas de uma transmissão em 720p retransmitida para uma pessoa (~2 em 1080p · 60). */
    static final long LIMITE_DE_VIDEO_POR_ENDERECO = 10 * GB;
    /** Umas 100 horas de voz: acima disso, a credencial da voz está levando outra coisa (copiada, ou vídeo). */
    static final long LIMITE_DE_VOZ_POR_ENDERECO = 3 * GB;
    static final int CREDENCIAIS_POR_ENDERECO = 10;
    static final Duration JANELA_DE_CREDENCIAIS = Duration.ofMinutes(10);
    /**
     * Mais longa que uma noite de jogo: trocar a credencial de uma conexão no meio não muda a que ela já usa. A
     * renovação ({@code RENOVAR_DEPOIS}) serve às conexões novas; quem sai tem a sua cancelada antes disso.
     */
    static final Duration VALIDADE = Duration.ofHours(12);
    static final Duration RENOVAR_DEPOIS = Duration.ofHours(6);
    /** A sinalização que cai e volta (um deploy, um soluço) não derruba na hora o que passa pela retransmissão. */
    static final Duration REVOGAR_DEPOIS_DE_SAIR = Duration.ofMinutes(2);
    static final Duration CONFERIR_A_CADA = Duration.ofMinutes(5);
    static final Duration CONSUMO_VALE_POR = Duration.ofMinutes(15);
    private static final Duration PASSO = Duration.ofSeconds(30);
    /** O consumo vai para o log de hora em hora, e também quando o de hoje sobe {@code RELATAR_A_CADA_GB}. */
    private static final Duration RELATAR_A_CADA = Duration.ofHours(1);
    private static final long RELATAR_A_CADA_GB = GB;

    /** O que o Ozamigos usa da Cloudflare (uma interface para os testes não dependerem da internet). */
    interface Cloudflare {
        /** servidores: a lista de iceServers do navegador, só com a retransmissão (o STUN já está na página). */
        record Credencial(String usuario, ArrayNode servidores) {}

        /** periodo: bytes entregues desde {@code desde}; hojePorUsuario: os de hoje (UTC), por credencial. */
        record Consumo(long periodo, Map<String, Long> hojePorUsuario) {}

        Credencial gerar(Duration validade) throws IOException, InterruptedException;

        void revogar(String usuario) throws IOException, InterruptedException;

        Consumo consumo(LocalDate desde, LocalDate hoje) throws IOException, InterruptedException;
    }

    /** Quem está numa sala agora, com as credenciais de cada uso. */
    private final class Pessoa {
        final String nome;
        final String endereco;
        /** O que conta nos limites: o endereço e a conta (não se confundem: a conta vem com prefixo). */
        final List<String> chaves;
        /** Recebe as credenciais que valem agora (as novas, ou a lista vazia de um uso cortado). */
        final Consumer<Credenciais> avisar;
        final Map<Uso, List<String>> credenciais = new EnumMap<>(Uso.class);
        final Map<Uso, ArrayNode> atuais = new EnumMap<>(Uso.class);
        final Map<Uso, Instant> ultima = new EnumMap<>(Uso.class);
        /** Credenciais estão sendo pedidas à Cloudflare para ela: a entrada e o passo não pedem duas vezes. */
        boolean emitindo;

        Pessoa(String nome, String endereco, String conta, Consumer<Credenciais> avisar) {
            this.nome = nome;
            this.endereco = endereco;
            this.chaves = List.of(endereco, "conta:" + conta);
            this.avisar = avisar;
            for (Uso uso : Uso.values()) {
                credenciais.put(uso, new ArrayList<>());
                atuais.put(uso, json.createArrayNode());
            }
        }

        Credenciais paraAPagina() {
            return new Credenciais(atuais.get(Uso.VOZ), atuais.get(Uso.VIDEO), limiteDoVideo(chaves));
        }
    }

    /** De quem é cada credencial: o endereço e a conta (para os limites) e o id e o nome da pessoa (para o log). */
    private record Emitida(List<String> chaves, Uso uso, Instant quando, String id, String nome) {}

    /**
     * A última leitura do consumo, para o painel do dono: o total do período e de hoje (UTC), por uso e por conta
     * ({@code porConta}: id → vídeo, voz). Null antes da primeira leitura.
     */
    public record Resumo(Instant lidoEm, long periodo, long hoje, long hojeVideo, long hojeVoz, Map<String, long[]> porConta,
            boolean esgotada, boolean videoEsgotado) {}

    private volatile Resumo resumo;

    private final Cloudflare cloudflare;
    private final JsonMapper json;
    private final Clock relogio;
    private final ScheduledExecutorService tarefas;
    /** Onde a leitura do consumo roda quando a entrada a pede: a thread da retransmissão (nos testes, na hora). */
    private final Executor emSegundoPlano;
    private final Object conferindo = new Object();

    private final Map<String, Pessoa> pessoas = new HashMap<>();
    /** Credencial → de que endereço e uso, para somar o consumo de hoje (cada credencial vale 12 h). */
    private final Map<String, Emitida> emitidas = new HashMap<>();
    private final Map<String, Instant> revogarEm = new HashMap<>();
    private final Map<String, Deque<Instant>> pedidos = new HashMap<>();
    /** Endereços e contas (Pessoa.chaves) que passaram do limite hoje: sem nada (abuso na voz), ou só sem o vídeo. */
    private final Set<String> bloqueados = new HashSet<>();
    private final Set<String> semVideo = new HashSet<>();
    private LocalDate diaDosBloqueios;
    private boolean esgotada;
    private boolean videoEsgotado;
    private Instant consumoEm;
    private Instant relatouEm;
    private long relatadoHoje;
    private Instant tentouEm;
    private Instant avisouFalhaEm;
    /** Credenciais com consumo hoje que este servidor não emitiu (de antes de um reinício), já canceladas. */
    private final Set<String> orfasCanceladas = new HashSet<>();

    @Autowired
    public Retransmissao(JsonMapper json,
            @Value("${ozamigos.turn.id:}") String id,
            @Value("${ozamigos.turn.token:}") String token,
            @Value("${ozamigos.cloudflare.conta:}") String conta,
            @Value("${ozamigos.cloudflare.leitura:}") String leitura) {
        this(cloudflareSeConfigurada(json, id, token, conta, leitura), json, Clock.systemUTC(), true);
    }

    Retransmissao(Cloudflare cloudflare, JsonMapper json, Clock relogio, boolean emSegundoPlano) {
        this.cloudflare = cloudflare;
        this.json = json;
        this.relogio = relogio;
        if (cloudflare != null && emSegundoPlano) {
            tarefas = Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().name("retransmissao").factory());
            tarefas.scheduleWithFixedDelay(this::passoSemFalhar, 0, PASSO.toSeconds(), TimeUnit.SECONDS);
            this.emSegundoPlano = tarefas;
        } else {
            tarefas = null;
            this.emSegundoPlano = Runnable::run;
        }
    }

    /**
     * Sem as quatro variáveis, a retransmissão fica desligada. A de leitura do consumo é obrigatória: sem ela não haveria
     * como respeitar o limite.
     */
    private static Cloudflare cloudflareSeConfigurada(JsonMapper json, String id, String token, String conta, String leitura) {
        if (vazia(id) || vazia(token) || vazia(conta) || vazia(leitura)) {
            log.info("Retransmissão desligada (faltam as variáveis OZAMIGOS_TURN_* e OZAMIGOS_CLOUDFLARE_*)");
            return null;
        }
        log.info("Retransmissão ligada");
        return new CloudflareHttp(json, id.strip(), token.strip(), conta.strip(), leitura.strip());
    }

    private static boolean vazia(String valor) {
        return valor == null || valor.isBlank();
    }

    @PreDestroy
    void parar() {
        if (tarefas != null) {
            tarefas.shutdownNow();
        }
    }

    /**
     * Alguém entrou numa sala: as credenciais dele, ou null (sem conta, desligada, limite, a Cloudflare falhou, ou o
     * consumo ainda não foi lido). {@code conta}: o id da conta, ou null para um convidado, que nunca recebe. avisar recebe as que valem depois: a primeira, quando o consumo ainda estava sendo lido; as
     * renovadas; e a lista vazia de um uso cortado.
     *
     * <p>A entrada nunca espera a leitura do consumo: ela vai para a thread da retransmissão. Lida no meio da entrada
     * (até 26/10/2026), a primeira pessoa depois de um deploy esperava o prazo inteiro da consulta à Cloudflare, que no
     * servidor recém-acordado passou de 6 s. Só o pedido das credenciais (rápido) fica na entrada.
     */
    public Credenciais entrou(String id, String nome, String endereco, String conta, Consumer<Credenciais> avisar) {
        if (cloudflare == null || conta == null) {
            return null;
        }
        if (consumoVelho(CONFERIR_A_CADA)) {
            // Lê, e o passo logo em seguida dá as credenciais a quem entrou sem elas (o passo só lê de 5 em 5 minutos).
            emSegundoPlano.execute(() -> {
                try {
                    conferir();
                } catch (RuntimeException e) {
                    log.warn("Retransmissão: falha ao ler o consumo: {}", e.toString());
                }
                passoSemFalhar();
            });
        }
        Set<Uso> usos;
        synchronized (this) {
            Pessoa pessoa = new Pessoa(nome, endereco, conta, avisar);
            pessoas.put(id, pessoa);
            usos = liberados(pessoa.chaves);
            if (usos.isEmpty() || !reservar(endereco)) {
                return null; // sem leitura valendo, o passo dá as credenciais assim que ler o consumo
            }
            pessoa.emitindo = true;
        }
        return emitir(id, usos);
    }

    /** Com as variáveis da Cloudflare: quem entra com conta pode receber credenciais (os limites ainda decidem). */
    public boolean ligada() {
        return cloudflare != null;
    }

    /** A última leitura do consumo (o painel do dono), ou null: desligada, ou ainda sem ler. */
    public Resumo resumo() {
        return resumo;
    }

    /** Saiu da sala (ou a conexão caiu): as credenciais dela são canceladas daqui a pouco. */
    public synchronized void saiu(String id) {
        Pessoa pessoa = pessoas.remove(id);
        if (pessoa == null) {
            return;
        }
        Instant quando = relogio.instant().plus(REVOGAR_DEPOIS_DE_SAIR);
        pessoa.credenciais.values().forEach(lista -> lista.forEach(usuario -> revogarEm.put(usuario, quando)));
    }

    private void passoSemFalhar() {
        try {
            passo();
        } catch (RuntimeException e) {
            log.warn("Retransmissão: falha no passo: {}", e.toString());
        }
    }

    /** A cada 30 s: lê o consumo (de 5 em 5 min), cancela as credenciais de quem saiu e dá ou renova as de quem está. */
    void passo() {
        boolean emUso;
        synchronized (this) {
            // Lê também logo ao subir (as credenciais de antes do reinício) e enquanto alguma emitida ainda vale, mesmo
            // com a sala vazia: só com gente na sala, uma credencial copiada era usada sem ninguém olhar.
            Instant agora = relogio.instant();
            emUso = consumoEm == null || !pessoas.isEmpty() || !revogarEm.isEmpty()
                    || emitidas.values().stream().anyMatch(e -> e.quando().plus(VALIDADE).isAfter(agora));
        }
        if (emUso && consumoVelho(CONFERIR_A_CADA)) {
            conferir();
        }
        List<String> revogar = new ArrayList<>();
        Map<String, Set<Uso>> dar = new HashMap<>();
        synchronized (this) {
            Instant agora = relogio.instant();
            for (Iterator<Map.Entry<String, Instant>> it = revogarEm.entrySet().iterator(); it.hasNext();) {
                Map.Entry<String, Instant> r = it.next();
                if (!r.getValue().isAfter(agora)) {
                    revogar.add(r.getKey());
                    it.remove();
                }
            }
            pessoas.forEach((id, pessoa) -> {
                if (pessoa.emitindo) {
                    return;
                }
                // Um uso sem credencial (a pessoa acabou de entrar, ou o vídeo voltou depois de um corte) conta na janela
                // de pedidos do endereço; renovar as que vencem não conta.
                Set<Uso> faltam = EnumSet.noneOf(Uso.class);
                Set<Uso> vencem = EnumSet.noneOf(Uso.class);
                for (Uso uso : liberados(pessoa.chaves)) {
                    Instant ultima = pessoa.ultima.get(uso);
                    if (ultima == null) {
                        faltam.add(uso);
                    } else if (!ultima.plus(RENOVAR_DEPOIS).isAfter(agora)) {
                        vencem.add(uso);
                    }
                }
                if (!faltam.isEmpty() && !reservar(pessoa.endereco)) {
                    faltam.clear();
                }
                if (!faltam.isEmpty() || !vencem.isEmpty()) {
                    faltam.addAll(vencem);
                    pessoa.emitindo = true;
                    dar.put(id, faltam);
                }
            });
            emitidas.values().removeIf(e -> e.quando().plus(VALIDADE).plus(Duration.ofDays(1)).isBefore(agora));
            pedidos.values().removeIf(p -> {
                esquecerAntigos(p, agora);
                return p.isEmpty();
            });
        }
        revogar.forEach(this::revogar);
        dar.forEach((id, usos) -> {
            Credenciais credenciais = emitir(id, usos);
            Pessoa pessoa;
            synchronized (this) {
                pessoa = pessoas.get(id);
            }
            if (credenciais != null && pessoa != null) {
                pessoa.avisar.accept(credenciais);
            }
        });
    }

    /** Lê o consumo na Cloudflare e aplica os limites: corta o vídeo (ou tudo) de quem passou, e de todos no teto. */
    void conferir() {
        synchronized (conferindo) {
            Instant inicio = relogio.instant();
            if (tentouEm != null && tentouEm.plusSeconds(10).isAfter(inicio)) {
                return; // outra thread acabou de ler (ou de falhar): sem enxurrada de pedidos à Cloudflare
            }
            tentouEm = inicio;
            LocalDate hoje = LocalDate.ofInstant(relogio.instant(), java.time.ZoneOffset.UTC);
            Cloudflare.Consumo consumo;
            try {
                consumo = cloudflare.consumo(hoje.minusDays(DIAS_DO_PERIODO - 1), hoje);
            } catch (IOException e) {
                // Tenta de novo a cada passo (30 s) enquanto alguém usa; no log, uma vez a cada 10 minutos.
                if (avisouFalhaEm == null || !avisouFalhaEm.plus(Duration.ofMinutes(10)).isAfter(inicio)) {
                    log.warn("Retransmissão: não deu para ler o consumo: {}", e.getMessage());
                    avisouFalhaEm = inicio;
                }
                return;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            avisouFalhaEm = null;
            List<String> revogar = new ArrayList<>();
            List<Pessoa> cortadas = new ArrayList<>();
            synchronized (this) {
                Instant agora = relogio.instant();
                consumoEm = agora;
                if (!hoje.equals(diaDosBloqueios)) {
                    bloqueados.clear();
                    semVideo.clear();
                    relatadoHoje = 0;
                    diaDosBloqueios = hoje;
                }
                long hojeTotal = 0;
                Map<Uso, Long> hojePorUso = new EnumMap<>(Uso.class);
                Map<String, Long> videoPorChave = new HashMap<>();
                Map<String, Long> vozPorChave = new HashMap<>();
                Map<String, String> nomesPorChave = new HashMap<>();
                Map<String, long[]> porPessoa = new HashMap<>(); // "nome (id)" → vídeo, voz
                Map<String, long[]> porConta = new HashMap<>(); // id da conta → vídeo, voz (o painel do dono)
                for (Map.Entry<String, Long> uso : consumo.hojePorUsuario().entrySet()) {
                    hojeTotal += uso.getValue();
                    Emitida emitida = emitidas.get(uso.getKey());
                    if (emitida != null) {
                        hojePorUso.merge(emitida.uso(), uso.getValue(), Long::sum);
                        String quem = emitida.nome() + " (" + emitida.id() + ")";
                        for (String chave : emitida.chaves()) {
                            (emitida.uso() == Uso.VIDEO ? videoPorChave : vozPorChave).merge(chave, uso.getValue(), Long::sum);
                            nomesPorChave.merge(chave, quem, (a, b) -> a.contains(b) ? a : a + ", " + b);
                            if (chave.startsWith("conta:")) {
                                porConta.computeIfAbsent(chave.substring(6), c -> new long[2])[emitida.uso() == Uso.VIDEO ? 0 : 1] += uso.getValue();
                            }
                        }
                        porPessoa.computeIfAbsent(quem, q -> new long[2])[emitida.uso() == Uso.VIDEO ? 0 : 1] += uso.getValue();
                    } else if (uso.getValue() > 0 && orfasCanceladas.add(uso.getKey())) {
                        // Usada hoje, mas não emitida por este servidor: de antes de um reinício (a memória se perdeu),
                        // ninguém a vigia. Quem estava na sala reconectou e já tem outra; cancelar uma que não existe
                        // mais é inofensivo (a Cloudflare responde 404).
                        revogar.add(uso.getKey());
                    }
                }
                // Os endereços não vão para o log (a política de privacidade só fala do log das senhas erradas): vai o
                // nome de quem usou o endereço (pedido do dono, 26/10/2026; a política fala dele).
                // Quem passa pelo endereço e pela conta ao mesmo tempo aparece uma vez só (as duas chaves têm o mesmo nome).
                Set<String> semVozAgora = new LinkedHashSet<>();
                Set<String> semVideoAgora = new LinkedHashSet<>();
                vozPorChave.forEach((chave, bytes) -> {
                    if (bytes >= LIMITE_DE_VOZ_POR_ENDERECO && bloqueados.add(chave)) {
                        semVozAgora.add(nomesPorChave.get(chave));
                    }
                });
                videoPorChave.forEach((chave, bytes) -> {
                    if (bytes >= LIMITE_DE_VIDEO_POR_ENDERECO && semVideo.add(chave)) {
                        semVideoAgora.add(nomesPorChave.get(chave));
                    }
                });
                semVozAgora.forEach(quem -> log.warn("Retransmissão: {} passou de {} GB de voz hoje (não é conversa) e ficou sem ela até amanhã",
                        quem, LIMITE_DE_VOZ_POR_ENDERECO / GB));
                semVideoAgora.forEach(quem -> log.warn("Retransmissão: {} passou de {} GB de vídeo hoje e ficou sem o vídeo até amanhã (a voz continua)",
                        quem, LIMITE_DE_VIDEO_POR_ENDERECO / GB));
                boolean esgotou = consumo.periodo() >= LIMITE_DO_PERIODO || hojeTotal >= LIMITE_DO_DIA;
                boolean videoEsgotou = consumo.periodo() >= LIMITE_DO_PERIODO_DO_VIDEO || hojeTotal >= LIMITE_DO_DIA_DO_VIDEO;
                String resumo = String.format(java.util.Locale.ROOT, "%s em %d dias, %s hoje (vídeo %s, voz %s)",
                        quanto(consumo.periodo()), DIAS_DO_PERIODO, quanto(hojeTotal),
                        quanto(hojePorUso.getOrDefault(Uso.VIDEO, 0L)), quanto(hojePorUso.getOrDefault(Uso.VOZ, 0L)));
                boolean relatou = true;
                if (esgotou != esgotada) {
                    log.warn("Retransmissão {}: {}", esgotou ? "desligada pelo limite" : "religada", resumo);
                    esgotada = esgotou;
                } else if (videoEsgotou != videoEsgotado) {
                    log.warn("Retransmissão do vídeo {}: {}", videoEsgotou ? "desligada pelo limite (a voz continua)" : "religada", resumo);
                } else if (relatouEm == null || !relatouEm.plus(RELATAR_A_CADA).isAfter(agora) || hojeTotal >= relatadoHoje + RELATAR_A_CADA_GB) {
                    log.info("Retransmissão: {}", resumo);
                    relatouEm = agora;
                    relatadoHoje = hojeTotal;
                } else {
                    relatou = false;
                }
                // Junto com o total, quanto cada pessoa usou hoje, de quem mais usou para quem menos (as 20 primeiras).
                if (relatou) {
                    porPessoa.entrySet().stream()
                            .sorted((a, b) -> Long.compare(b.getValue()[0] + b.getValue()[1], a.getValue()[0] + a.getValue()[1]))
                            .limit(20)
                            .forEach(p -> log.info("Retransmissão de {} hoje: vídeo {}, voz {}", p.getKey(), quanto(p.getValue()[0]), quanto(p.getValue()[1])));
                }
                videoEsgotado = videoEsgotou;
                this.resumo = new Resumo(agora, consumo.periodo(), hojeTotal, hojePorUso.getOrDefault(Uso.VIDEO, 0L),
                        hojePorUso.getOrDefault(Uso.VOZ, 0L), Map.copyOf(porConta), esgotou, videoEsgotou);
                for (Pessoa pessoa : pessoas.values()) {
                    Set<Uso> valem = liberados(pessoa.chaves);
                    boolean cortou = false;
                    for (Uso uso : Uso.values()) {
                        List<String> lista = pessoa.credenciais.get(uso);
                        if (!valem.contains(uso) && !lista.isEmpty()) {
                            revogar.addAll(lista);
                            lista.clear();
                            pessoa.ultima.remove(uso);
                            pessoa.atuais.put(uso, json.createArrayNode());
                            cortou = true;
                        }
                    }
                    if (cortou) {
                        cortadas.add(pessoa);
                    }
                }
                // Quem já saiu e passou do limite não espera os 2 minutos.
                for (Iterator<String> it = revogarEm.keySet().iterator(); it.hasNext();) {
                    String usuario = it.next();
                    Emitida emitida = emitidas.get(usuario);
                    if (esgotada || (emitida != null && !liberados(emitida.chaves()).contains(emitida.uso()))) {
                        revogar.add(usuario);
                        it.remove();
                    }
                }
            }
            revogar.forEach(this::revogar);
            cortadas.forEach(pessoa -> pessoa.avisar.accept(pessoa.paraAPagina()));
        }
    }

    /** "350 MB" abaixo de 1 GB (a voz fica sempre ali), "2.4 GB" acima. */
    static String quanto(long bytes) {
        return bytes < GB
                ? String.format(java.util.Locale.ROOT, "%d MB", Math.round(bytes / 1_000_000.0))
                : String.format(java.util.Locale.ROOT, "%.1f GB", bytes / (double) GB);
    }

    /** Pede à Cloudflare uma credencial de cada uso: as que vêm valem para a pessoa, e ela recebe as de agora. */
    private Credenciais emitir(String id, Set<Uso> usos) {
        Map<Uso, Cloudflare.Credencial> novas = new EnumMap<>(Uso.class);
        for (Uso uso : usos) {
            try {
                novas.put(uso, cloudflare.gerar(VALIDADE));
            } catch (IOException e) {
                log.warn("Retransmissão: não deu para gerar uma credencial: {}", e.getMessage());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        synchronized (this) {
            Pessoa pessoa = pessoas.get(id);
            if (pessoa != null) {
                pessoa.emitindo = false; // falhando, o passo tenta de novo
            }
            boolean deu = false;
            for (Map.Entry<Uso, Cloudflare.Credencial> nova : novas.entrySet()) {
                Uso uso = nova.getKey();
                String usuario = nova.getValue().usuario();
                if (pessoa == null || !liberados(pessoa.chaves).contains(uso)) {
                    revogarEm.put(usuario, relogio.instant()); // saiu (ou foi cortada) enquanto gerava
                    continue;
                }
                emitidas.put(usuario, new Emitida(pessoa.chaves, uso, relogio.instant(), id, pessoa.nome));
                pessoa.credenciais.get(uso).add(usuario);
                pessoa.ultima.put(uso, relogio.instant());
                pessoa.atuais.put(uso, nova.getValue().servidores());
                deu = true;
            }
            return deu ? pessoa.paraAPagina() : null;
        }
    }

    /** Cancela na Cloudflare; falhando, tenta de novo no próximo passo (uma credencial esquecida valeria até 12 h). */
    private void revogar(String usuario) {
        try {
            cloudflare.revogar(usuario);
            return;
        } catch (IOException e) {
            log.warn("Retransmissão: não deu para cancelar uma credencial, tentando de novo: {}", e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        synchronized (this) {
            revogarEm.putIfAbsent(usuario, relogio.instant().plus(PASSO));
        }
    }

    private synchronized boolean consumoVelho(Duration idade) {
        return consumoEm == null || !consumoEm.plus(idade).isAfter(relogio.instant());
    }

    /**
     * Chamado com o monitor: os usos que esta pessoa (o endereço e a conta) pode receber agora. Nenhum sem uma leitura
     * recente do consumo, no teto, ou para quem abusou da voz; o vídeo sai antes, para quem passou do dele ou com o total
     * perto do teto.
     */
    private Set<Uso> liberados(List<String> chaves) {
        Set<Uso> usos = EnumSet.noneOf(Uso.class);
        if (consumoEm == null || !consumoEm.plus(CONSUMO_VALE_POR).isAfter(relogio.instant()) || esgotada
                || chaves.stream().anyMatch(bloqueados::contains)) {
            return usos;
        }
        usos.add(Uso.VOZ);
        if (!videoEsgotado && chaves.stream().noneMatch(semVideo::contains)) {
            usos.add(Uso.VIDEO);
        }
        return usos;
    }

    /** Chamado com o monitor: por que esta pessoa está sem o vídeo, ou null (Credenciais.limiteDoVideo). */
    private String limiteDoVideo(List<String> chaves) {
        if (chaves.stream().anyMatch(c -> semVideo.contains(c) || bloqueados.contains(c))) {
            return "seu";
        }
        return esgotada || videoEsgotado ? "geral" : null;
    }

    /** Chamado com o monitor: mais um pedido de credenciais para este endereço cabe na janela? Se couber, já conta. */
    private boolean reservar(String endereco) {
        Instant agora = relogio.instant();
        Deque<Instant> recentes = pedidos.computeIfAbsent(endereco, e -> new ArrayDeque<>());
        esquecerAntigos(recentes, agora);
        if (recentes.size() >= CREDENCIAIS_POR_ENDERECO) {
            return false;
        }
        recentes.addLast(agora);
        return true;
    }

    private static void esquecerAntigos(Deque<Instant> recentes, Instant agora) {
        Instant limite = agora.minus(JANELA_DE_CREDENCIAIS);
        while (!recentes.isEmpty() && !recentes.peekFirst().isAfter(limite)) {
            recentes.removeFirst();
        }
    }
}
