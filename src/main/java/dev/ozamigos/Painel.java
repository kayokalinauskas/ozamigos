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
import org.springframework.stereotype.Component;

/**
 * O painel do dono do Ozamigos (pedido do dono, 28/10/2026): os números do banco, os servidores e as contas. Quem é
 * dono vem de {@code OZAMIGOS_DONOS} (ids de conta, separados por vírgula), e é o servidor quem confere, a cada
 * pedido (PainelApi): sem a variável, o painel não existe para ninguém.
 *
 * <p>Só leitura. Listas até {@link #LISTAS_ATE} itens, dos vistos por último para os mais antigos.
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
            Instant vistaEm, long donaDe, long membroDe, long sessoes) {}

    /** Quem é dono (OZAMIGOS_DONOS); os testes trocam. */
    volatile Set<UUID> donos;
    private final JdbcClient banco;

    public Painel(ObjectProvider<DataSource> fonte, @Value("${ozamigos.donos:}") String donos) {
        this.donos = Arrays.stream(donos.split(","))
                .map(String::strip)
                .filter(id -> !id.isEmpty())
                .map(UUID::fromString)
                .collect(Collectors.toUnmodifiableSet());
        DataSource dados = fonte.getIfAvailable();
        this.banco = dados == null ? null : JdbcClient.create(dados);
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
                  (select count(*) from sessoes s where s.usuario_id = u.id and s.expira_em > now()) as sessoes
                from usuarios u order by u.visto_em desc limit :ate""")
                .param("ate", LISTAS_ATE)
                .query((l, n) -> {
                    UUID id = l.getObject("id", UUID.class);
                    String provedores = l.getString("provedores");
                    return new ContaNoPainel(id.toString(), l.getString("nome"),
                            ContaApi.enderecoDaFoto(id, l.getBoolean("tem_foto"), l.getInt("foto_versao")),
                            provedores.isEmpty() ? List.of() : List.of(provedores.split(",")),
                            l.getTimestamp("criado_em").toInstant(), l.getTimestamp("visto_em").toInstant(),
                            l.getLong("dona_de"), l.getLong("membro_de"), l.getLong("sessoes"));
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
}
