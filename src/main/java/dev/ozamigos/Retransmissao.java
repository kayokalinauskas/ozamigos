package dev.ozamigos;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
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
 * <p>A Cloudflare dá 1.000 GB por mês e cobra o que passar, e <b>o dono não aceita gastar nada</b>: ela não tem um
 * teto de gastos, então o teto é este. Qualquer pessoa numa sala recebe uma credencial (o dono quis deixar aberto
 * para todos os grupos e medir), e o abuso é contido assim:
 * <ul>
 * <li>a credencial é por pessoa, só para quem entrou numa sala, e é <b>cancelada</b> na Cloudflare
 * {@code REVOGAR_DEPOIS_DE_SAIR} depois de a pessoa sair (copiada para fora do Ozamigos, só vale enquanto ela fica);
 * <li>a cada {@code CONFERIR_A_CADA}, o consumo é lido na própria Cloudflare (por credencial, então por endereço):
 * um endereço que passa de {@code LIMITE_POR_ENDERECO} no dia tem as credenciais canceladas até o dia seguinte;
 * todos juntos passando de {@code LIMITE_DO_DIA} no dia, ou de {@code LIMITE_DO_PERIODO} nos últimos
 * {@code DIAS_DO_PERIODO} dias (qualquer mês de cobrança cabe nessa janela), a retransmissão desliga para todos;
 * <li>cada endereço recebe até {@code CREDENCIAIS_POR_ENDERECO} credenciais novas a cada {@code JANELA_DE_CREDENCIAIS};
 * <li>sem conseguir ler o consumo há {@code CONSUMO_VALE_POR}, ninguém recebe credencial nova (falha fechada).
 * </ul>
 * Desligada, o Ozamigos funciona como antes dela: só conexões diretas. O que passa do corte é no máximo o consumo de
 * alguns minutos, muito menos que a folga entre o limite e a franquia.
 */
@Component
public class Retransmissao {

    private static final Logger log = LoggerFactory.getLogger(Retransmissao.class);

    static final long GB = 1_000_000_000L;
    static final long LIMITE_DO_PERIODO = 800 * GB;
    static final int DIAS_DO_PERIODO = 31;
    static final long LIMITE_DO_DIA = 100 * GB;
    /** ~5 horas de uma transmissão em 720p retransmitida para uma pessoa; a voz gasta ~0,03 GB por hora. */
    static final long LIMITE_POR_ENDERECO = 10 * GB;
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
    private static final Duration RELATAR_A_CADA = Duration.ofHours(1);

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

    /** Quem está numa sala agora: avisar manda credenciais novas (ou a lista vazia, retransmissão cortada). */
    private static final class Pessoa {
        final String endereco;
        final Consumer<ArrayNode> avisar;
        final List<String> credenciais = new ArrayList<>();
        Instant ultima;
        /** Uma credencial está sendo pedida à Cloudflare para ela: a entrada e o passo não pedem duas. */
        boolean emitindo;

        Pessoa(String endereco, Consumer<ArrayNode> avisar) {
            this.endereco = endereco;
            this.avisar = avisar;
        }
    }

    private record Emitida(String endereco, Instant quando) {}

    private final Cloudflare cloudflare;
    private final JsonMapper json;
    private final Clock relogio;
    private final ScheduledExecutorService tarefas;
    /** Onde a leitura do consumo roda quando a entrada a pede: a thread da retransmissão (nos testes, na hora). */
    private final Executor emSegundoPlano;
    private final Object conferindo = new Object();

    private final Map<String, Pessoa> pessoas = new HashMap<>();
    /** Credencial → de que endereço, para somar o consumo de hoje por endereço (cada credencial vale 12 h). */
    private final Map<String, Emitida> emitidas = new HashMap<>();
    private final Map<String, Instant> revogarEm = new HashMap<>();
    private final Map<String, Deque<Instant>> pedidos = new HashMap<>();
    private final Set<String> bloqueados = new HashSet<>();
    private LocalDate diaDosBloqueios;
    private boolean esgotada;
    private Instant consumoEm;
    private Instant relatouEm;
    private Instant tentouEm;
    private Instant avisouFalhaEm;

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
     * Alguém entrou numa sala: as credenciais dele, ou null (desligada, limite, a Cloudflare falhou, ou o consumo ainda
     * não foi lido). avisar recebe as credenciais que chegam depois (a primeira, quando o consumo ainda estava sendo
     * lido; as renovadas) e a lista vazia quando ela é cortada.
     *
     * <p>A entrada nunca espera a leitura do consumo: ela vai para a thread da retransmissão. Lida no meio da entrada
     * (até 26/10/2026), a primeira pessoa depois de um deploy esperava o prazo inteiro da consulta à Cloudflare, que no
     * servidor recém-acordado passou de 6 s. Só o pedido da credencial (rápido) fica na entrada.
     */
    public ArrayNode entrou(String id, String endereco, Consumer<ArrayNode> avisar) {
        if (cloudflare == null) {
            return null;
        }
        if (consumoVelho(CONFERIR_A_CADA)) {
            // Lê, e o passo logo em seguida dá a credencial a quem entrou sem ela (o passo sozinho só lê com alguém na sala).
            emSegundoPlano.execute(() -> {
                try {
                    conferir();
                } catch (RuntimeException e) {
                    log.warn("Retransmissão: falha ao ler o consumo: {}", e.toString());
                }
                passoSemFalhar();
            });
        }
        synchronized (this) {
            Pessoa pessoa = new Pessoa(endereco, avisar);
            pessoas.put(id, pessoa);
            if (!liberada(endereco) || !reservar(endereco)) {
                return null; // sem leitura valendo, o passo dá a credencial assim que ler o consumo
            }
            pessoa.emitindo = true;
        }
        return emitir(id);
    }

    /** Saiu da sala (ou a conexão caiu): as credenciais dela são canceladas daqui a pouco. */
    public synchronized void saiu(String id) {
        Pessoa pessoa = pessoas.remove(id);
        if (pessoa == null) {
            return;
        }
        Instant quando = relogio.instant().plus(REVOGAR_DEPOIS_DE_SAIR);
        pessoa.credenciais.forEach(usuario -> revogarEm.put(usuario, quando));
    }

    private void passoSemFalhar() {
        try {
            passo();
        } catch (RuntimeException e) {
            log.warn("Retransmissão: falha no passo: {}", e.toString());
        }
    }

    /** A cada 30 s: lê o consumo (de 5 em 5 min), cancela as credenciais de quem saiu e renova as das conexões novas. */
    void passo() {
        boolean emUso;
        synchronized (this) {
            emUso = !pessoas.isEmpty() || !revogarEm.isEmpty();
        }
        if (emUso && consumoVelho(CONFERIR_A_CADA)) {
            conferir();
        }
        List<String> revogar = new ArrayList<>();
        List<String> renovar = new ArrayList<>();
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
                if (pessoa.emitindo || !liberada(pessoa.endereco)) {
                    return;
                }
                if (pessoa.ultima == null ? reservar(pessoa.endereco) : !pessoa.ultima.plus(RENOVAR_DEPOIS).isAfter(agora)) {
                    pessoa.emitindo = true;
                    renovar.add(id);
                }
            });
            emitidas.values().removeIf(e -> e.quando().plus(VALIDADE).plus(Duration.ofDays(1)).isBefore(agora));
            pedidos.values().removeIf(p -> {
                esquecerAntigos(p, agora);
                return p.isEmpty();
            });
        }
        revogar.forEach(this::revogar);
        for (String id : renovar) {
            ArrayNode servidores = emitir(id);
            Pessoa pessoa;
            synchronized (this) {
                pessoa = pessoas.get(id);
            }
            if (servidores != null && pessoa != null) {
                pessoa.avisar.accept(servidores);
            }
        }
    }

    /** Lê o consumo na Cloudflare e aplica os limites: corta quem passou, e todos se o total passou. */
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
                    diaDosBloqueios = hoje;
                }
                long hojeTotal = 0;
                Map<String, Long> porEndereco = new HashMap<>();
                for (Map.Entry<String, Long> uso : consumo.hojePorUsuario().entrySet()) {
                    hojeTotal += uso.getValue();
                    Emitida emitida = emitidas.get(uso.getKey());
                    if (emitida != null) {
                        porEndereco.merge(emitida.endereco(), uso.getValue(), Long::sum);
                    }
                }
                porEndereco.forEach((endereco, bytes) -> {
                    if (bytes >= LIMITE_POR_ENDERECO && bloqueados.add(endereco)) {
                        // O endereço não vai para o log (a política de privacidade só fala do log das senhas erradas).
                        log.warn("Retransmissão: um endereço passou de {} GB hoje e ficou sem ela até amanhã", LIMITE_POR_ENDERECO / GB);
                    }
                });
                boolean esgotou = consumo.periodo() >= LIMITE_DO_PERIODO || hojeTotal >= LIMITE_DO_DIA;
                if (esgotou != esgotada) {
                    log.warn("Retransmissão {}: {} GB em {} dias, {} GB hoje", esgotou ? "desligada pelo limite" : "religada",
                            gb(consumo.periodo()), DIAS_DO_PERIODO, gb(hojeTotal));
                    esgotada = esgotou;
                } else if (relatouEm == null || !relatouEm.plus(RELATAR_A_CADA).isAfter(agora)) {
                    log.info("Retransmissão: {} GB em {} dias, {} GB hoje", gb(consumo.periodo()), DIAS_DO_PERIODO, gb(hojeTotal));
                    relatouEm = agora;
                }
                for (Pessoa pessoa : pessoas.values()) {
                    if (!liberada(pessoa.endereco) && !pessoa.credenciais.isEmpty()) {
                        revogar.addAll(pessoa.credenciais);
                        pessoa.credenciais.clear();
                        pessoa.ultima = null;
                        cortadas.add(pessoa);
                    }
                }
                // Quem já saiu e passou do limite não espera os 2 minutos.
                for (Iterator<String> it = revogarEm.keySet().iterator(); it.hasNext();) {
                    String usuario = it.next();
                    Emitida emitida = emitidas.get(usuario);
                    if (esgotada || (emitida != null && bloqueados.contains(emitida.endereco()))) {
                        revogar.add(usuario);
                        it.remove();
                    }
                }
            }
            revogar.forEach(this::revogar);
            cortadas.forEach(pessoa -> pessoa.avisar.accept(json.createArrayNode()));
        }
    }

    private static String gb(long bytes) {
        return String.format(java.util.Locale.ROOT, "%.1f", bytes / (double) GB);
    }

    private ArrayNode emitir(String id) {
        Cloudflare.Credencial credencial;
        try {
            credencial = cloudflare.gerar(VALIDADE);
        } catch (IOException e) {
            log.warn("Retransmissão: não deu para gerar uma credencial: {}", e.getMessage());
            credencial = null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            credencial = null;
        }
        synchronized (this) {
            Pessoa pessoa = pessoas.get(id);
            if (pessoa != null) {
                pessoa.emitindo = false; // falhando, o passo tenta de novo
            }
            if (credencial == null) {
                return null;
            }
            if (pessoa == null || !liberada(pessoa.endereco)) {
                revogarEm.put(credencial.usuario(), relogio.instant()); // saiu (ou foi cortada) enquanto gerava
                return null;
            }
            emitidas.put(credencial.usuario(), new Emitida(pessoa.endereco, relogio.instant()));
            pessoa.credenciais.add(credencial.usuario());
            pessoa.ultima = relogio.instant();
            return credencial.servidores();
        }
    }

    private void revogar(String usuario) {
        try {
            cloudflare.revogar(usuario);
        } catch (IOException e) {
            log.warn("Retransmissão: não deu para cancelar uma credencial: {}", e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private synchronized boolean consumoVelho(Duration idade) {
        return consumoEm == null || !consumoEm.plus(idade).isAfter(relogio.instant());
    }

    /** Chamado com o monitor: o consumo é recente, não esgotou e este endereço não passou do dele hoje. */
    private boolean liberada(String endereco) {
        return consumoEm != null && consumoEm.plus(CONSUMO_VALE_POR).isAfter(relogio.instant()) && !esgotada
                && !bloqueados.contains(endereco);
    }

    /** Chamado com o monitor: mais uma credencial para este endereço cabe na janela? Se couber, já conta. */
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
