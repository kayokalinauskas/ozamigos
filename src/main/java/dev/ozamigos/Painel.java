package dev.ozamigos;

import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import javax.sql.DataSource;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * O painel do dono do Ozamigos (pedido do dono, 28/10/2026): os números do banco, os servidores e as contas. Quem é
 * dono vem de {@code OZAMIGOS_DONOS} (ids de conta, separados por vírgula), e é o servidor quem confere, a cada
 * pedido (PainelApi): sem a variável, o painel não existe para ninguém.
 *
 * <p>As ações (apagar um servidor, banir e desbanir) ficam no registro {@code acoes_do_painel}. Listas até
 * {@link #LISTAS_ATE} itens, dos vistos por último para os mais antigos.
 */
@Component
public class Painel {

    static final int LISTAS_ATE = 1000;

    public record Numeros(long bytesDoBanco, Map<String, Long> bytesPorTabela, long contas, long contasNovasHoje,
            long contasNovasNaSemana, long contasVistasHoje, long contasVistasNaSemana, long servidores, long membros,
            long convitesValendo, long sessoesValendo, long bloqueios) {}

    public record ServidorNoPainel(String codigo, String nome, String icone, String dono, String nomeDoDono, long membros,
            long convitesValendo, Instant criadoEm) {}

    public record ContaNoPainel(String id, String nome, String foto, List<String> provedores, Instant criadaEm,
            Instant vistaEm, long donaDe, long membroDe, long sessoes, boolean banida) {}

    /** Uma conta do Google ou do Discord banida; {@code conta} null se a conta já foi apagada. */
    public record Banimento(String provedor, String idExterno, String conta, String nome, Instant banidoEm, String porQuem) {}

    public record Acao(Instant quando, String quem, String acao, String alvo, String nomeDoAlvo) {}

    /** Quem é dono (OZAMIGOS_DONOS); os testes trocam. */
    volatile Set<UUID> donos;
    private final JdbcClient banco;
    private final TransactionTemplate transacao;

    public Painel(ObjectProvider<DataSource> fonte, @Value("${ozamigos.donos:}") String donos) {
        this.donos = Arrays.stream(donos.split(","))
                .map(String::strip)
                .filter(id -> !id.isEmpty())
                .map(UUID::fromString)
                .collect(Collectors.toUnmodifiableSet());
        DataSource dados = fonte.getIfAvailable();
        this.banco = dados == null ? null : JdbcClient.create(dados);
        this.transacao = dados == null ? null : new TransactionTemplate(new DataSourceTransactionManager(dados));
    }

    /** Esta conta é dona do Ozamigos (está em OZAMIGOS_DONOS). */
    public boolean ehDono(Optional<UUID> conta) {
        return conta.isPresent() && donos.contains(conta.get());
    }

    public Numeros numeros() {
        Map<String, Long> porTabela = new LinkedHashMap<>();
        banco.sql("""
                select c.relname, pg_total_relation_size(c.oid) as bytes from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = current_schema() and c.relkind = 'r' order by bytes desc""")
                .query(linha -> {
                    porTabela.put(linha.getString("relname"), linha.getLong("bytes"));
                });
        return banco.sql("""
                select pg_database_size(current_database()) as banco,
                  (select count(*) from usuarios) as contas,
                  (select count(*) from usuarios where criado_em > now() - interval '1 day') as novas_hoje,
                  (select count(*) from usuarios where criado_em > now() - interval '7 days') as novas_semana,
                  (select count(*) from usuarios where visto_em > now() - interval '1 day') as vistas_hoje,
                  (select count(*) from usuarios where visto_em > now() - interval '7 days') as vistas_semana,
                  (select count(*) from servidores) as servidores,
                  (select count(*) from membros) as membros,
                  (select count(*) from convites c where %s) as convites,
                  (select count(*) from sessoes where expira_em > now()) as sessoes,
                  (select count(*) from bloqueios) as bloqueios""".formatted(Servidores.VALE))
                .query((l, n) -> new Numeros(l.getLong("banco"), porTabela, l.getLong("contas"), l.getLong("novas_hoje"),
                        l.getLong("novas_semana"), l.getLong("vistas_hoje"), l.getLong("vistas_semana"),
                        l.getLong("servidores"), l.getLong("membros"), l.getLong("convites"), l.getLong("sessoes"),
                        l.getLong("bloqueios")))
                .single();
    }

    public List<ServidorNoPainel> servidores() {
        return banco.sql("""
                select s.id, s.codigo, s.nome, s.icone is not null as tem_icone, s.icone_versao, s.criado_em,
                  d.id as dono, d.nome as nome_do_dono,
                  (select count(*) from membros m where m.servidor_id = s.id) as membros,
                  (select count(*) from convites c where c.servidor_id = s.id and %s) as convites
                from servidores s
                left join membros md on md.servidor_id = s.id and md.papel = 'dono'
                left join usuarios d on d.id = md.usuario_id
                order by s.criado_em desc limit :ate""".formatted(Servidores.VALE))
                .param("ate", LISTAS_ATE)
                .query((l, n) -> new ServidorNoPainel(l.getString("codigo"), l.getString("nome"),
                        Servidores.enderecoDoIcone(l.getObject("id", UUID.class), l.getBoolean("tem_icone"), l.getInt("icone_versao")),
                        l.getString("dono"), l.getString("nome_do_dono"), l.getLong("membros"), l.getLong("convites"),
                        l.getTimestamp("criado_em").toInstant()))
                .list();
    }

    public List<ContaNoPainel> contas() {
        return banco.sql("""
                select u.id, u.nome, u.foto is not null as tem_foto, u.foto_versao, u.criado_em, u.visto_em,
                  coalesce((select string_agg(i.provedor, ',' order by i.provedor) from identidades i where i.usuario_id = u.id), '') as provedores,
                  (select count(*) from membros m where m.usuario_id = u.id and m.papel = 'dono') as dona_de,
                  (select count(*) from membros m where m.usuario_id = u.id) as membro_de,
                  (select count(*) from sessoes s where s.usuario_id = u.id and s.expira_em > now()) as sessoes,
                  exists (select 1 from banimentos b where b.usuario_id = u.id) as banida
                from usuarios u order by u.visto_em desc limit :ate""")
                .param("ate", LISTAS_ATE)
                .query((l, n) -> {
                    UUID id = l.getObject("id", UUID.class);
                    String provedores = l.getString("provedores");
                    return new ContaNoPainel(id.toString(), l.getString("nome"),
                            ContaApi.enderecoDaFoto(id, l.getBoolean("tem_foto"), l.getInt("foto_versao")),
                            provedores.isEmpty() ? List.of() : List.of(provedores.split(",")),
                            l.getTimestamp("criado_em").toInstant(), l.getTimestamp("visto_em").toInstant(),
                            l.getLong("dona_de"), l.getLong("membro_de"), l.getLong("sessoes"), l.getBoolean("banida"));
                })
                .list();
    }

    /** Os nomes dos servidores cujos códigos estão na lista (as salas abertas agora). */
    public Map<String, String> nomesDosServidores(List<String> codigos) {
        if (codigos.isEmpty()) {
            return Map.of();
        }
        Map<String, String> nomes = new LinkedHashMap<>();
        banco.sql("select codigo, nome from servidores where codigo in (:codigos)")
                .param("codigos", codigos)
                .query(l -> {
                    nomes.put(l.getString("codigo"), l.getString("nome"));
                });
        return nomes;
    }

    /**
     * Bane a conta: as identidades dela (Google, Discord) não entram mais, e as sessões acabam. Devolve o nome, ou vazio
     * se a conta não existe. Quem chama tira a pessoa das salas (SinalizacaoHandler.tirarDosServidores).
     */
    public Optional<String> banir(UUID quem, UUID conta) {
        return transacao.execute(estado -> {
            Optional<String> nome = banco.sql("select nome from usuarios where id = :u").param("u", conta).query(String.class).optional();
            if (nome.isEmpty()) {
                return nome;
            }
            banco.sql("""
                    insert into banimentos (provedor, id_externo, usuario_id, nome, banido_por)
                    select provedor, id_externo, usuario_id, :nome, :quem from identidades where usuario_id = :u
                    on conflict do nothing""")
                    .param("nome", nome.get()).param("quem", quem).param("u", conta).update();
            banco.sql("delete from sessoes where usuario_id = :u").param("u", conta).update();
            registrar(quem, "banir", conta.toString(), nome.get());
            return nome;
        });
    }

    /**
     * Desfaz o banimento dessa identidade e das outras da mesma conta. Devolve o nome de quem foi desbanido, ou vazio se
     * não estava banido.
     */
    public Optional<String> desbanir(UUID quem, String provedor, String idExterno) {
        return transacao.execute(estado -> {
            List<String> nomes = banco.sql("""
                    delete from banimentos where (provedor = :p and id_externo = :e)
                      or usuario_id = (select usuario_id from banimentos where provedor = :p and id_externo = :e)
                    returning nome""")
                    .param("p", provedor).param("e", idExterno).query(String.class).list();
            if (nomes.isEmpty()) {
                return Optional.<String>empty();
            }
            registrar(quem, "desbanir", provedor + ":" + idExterno, nomes.getFirst());
            return Optional.of(nomes.getFirst());
        });
    }

    public List<Banimento> banimentos() {
        return banco.sql("""
                select b.provedor, b.id_externo, b.usuario_id, b.nome, b.banido_em, q.nome as por_quem
                from banimentos b left join usuarios q on q.id = b.banido_por
                order by b.banido_em desc limit :ate""")
                .param("ate", LISTAS_ATE)
                .query((l, n) -> new Banimento(l.getString("provedor"), l.getString("id_externo"), l.getString("usuario_id"),
                        l.getString("nome"), l.getTimestamp("banido_em").toInstant(), l.getString("por_quem")))
                .list();
    }

    /** O que o painel fez, das mais novas para as mais antigas. */
    public List<Acao> registro() {
        return banco.sql("""
                select a.quando, q.nome as quem, a.acao, a.alvo, a.nome_do_alvo
                from acoes_do_painel a left join usuarios q on q.id = a.quem
                order by a.id desc limit 200""")
                .query((l, n) -> new Acao(l.getTimestamp("quando").toInstant(), l.getString("quem"), l.getString("acao"),
                        l.getString("alvo"), l.getString("nome_do_alvo")))
                .list();
    }

    void registrar(UUID quem, String acao, String alvo, String nomeDoAlvo) {
        banco.sql("insert into acoes_do_painel (quem, acao, alvo, nome_do_alvo) values (:q, :a, :alvo, :nome)")
                .param("q", quem).param("a", acao).param("alvo", alvo).param("nome", nomeDoAlvo).update();
    }
}
