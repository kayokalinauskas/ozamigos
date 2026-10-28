package dev.ozamigos;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import javax.sql.DataSource;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * As contas (docs/plano-contas.md, fase 1): quem entrou com o Google ou o Discord, com o nome e a foto que aparecem na
 * sala. Só existe de fato com o banco pronto ({@link #disponivel()}); sem ele, todo mundo é convidado, como antes.
 *
 * <p>O mínimo de dados pessoais: do provedor vêm só o id da conta (para reconhecer a pessoa), o nome (que ela muda) e a
 * foto (reduzida aqui, FotosDoPerfil). Os escopos do login nem pedem o e-mail.
 */
@Component
public class Contas {

    public record Usuario(UUID id, String nome, int fotoVersao, boolean temFoto, List<String> provedores) {}

    /** Quem entrou, e de onde a foto dele veio da última vez (para FotosDoPerfil baixar de novo só se mudou). */
    public record Entrada(UUID id, String fotoOrigem) {}

    public enum Ligacao { LIGADA, JA_ERA_SUA, DE_OUTRA_PESSOA, JA_TEM_DESSE_PROVEDOR }

    public enum Desligamento { DESLIGADA, NAO_TINHA, ULTIMA }

    /**
     * O banco não respondeu: por esse tempo, todos entram como convidados sem nem tentar. Sem isso, cada entrada com
     * conta esperaria o prazo da conexão (Banco), e depois de um deploy, com todos voltando juntos, a fila de 5 conexões
     * segurava as salas por dezenas de segundos.
     */
    static final Duration FORA_POR = Duration.ofSeconds(30);

    private final VidaDoBanco vida;
    private final JdbcClient banco;
    private final TransactionTemplate transacao;
    private volatile Instant foraAte = Instant.MIN;

    public Contas(ObjectProvider<VidaDoBanco> vida, ObjectProvider<DataSource> fonte) {
        this.vida = vida.getIfAvailable();
        DataSource dados = fonte.getIfAvailable();
        this.banco = dados == null ? null : JdbcClient.create(dados);
        this.transacao = dados == null ? null : new TransactionTemplate(new DataSourceTransactionManager(dados));
    }

    /** O banco existe, as migrações rodaram e ele não falhou há pouco: dá para entrar com conta. */
    public boolean disponivel() {
        return vida != null && vida.pronto() && Instant.now().isAfter(foraAte);
    }

    /** Uma consulta falhou: o banco fica de fora por FORA_POR (disponivel() responde false, sem tentar). */
    void bancoFalhou() {
        foraAte = Instant.now().plus(FORA_POR);
    }

    /**
     * Quem entrou pelo provedor: o usuário que já tem essa identidade, ou um novo, com o nome do provedor. Numa
     * transação: duas abas voltando do login ao mesmo tempo não criam dois usuários (a chave da identidade recusa a
     * segunda, que então acha o primeiro).
     */
    public Entrada entrar(String provedor, String idExterno, String nomeDoProvedor) {
        Entrada entrada = entrarUmaVez(provedor, idExterno, nomeDoProvedor);
        return entrada != null ? entrada : entrarUmaVez(provedor, idExterno, nomeDoProvedor);
    }

    /** Null: outra entrada criou o usuário dessa identidade no meio desta; a segunda vez o acha. */
    private Entrada entrarUmaVez(String provedor, String idExterno, String nomeDoProvedor) {
        return transacao.execute(estado -> {
            Optional<Entrada> existente = banco.sql("""
                    update usuarios u set visto_em = now() from identidades i
                    where i.provedor = :provedor and i.id_externo = :id and u.id = i.usuario_id
                    returning u.id, u.foto_origem""")
                    .param("provedor", provedor).param("id", idExterno)
                    .query((linha, n) -> new Entrada(linha.getObject("id", UUID.class), linha.getString("foto_origem")))
                    .optional();
            if (existente.isPresent()) {
                return existente.get();
            }
            UUID id = UUID.randomUUID();
            banco.sql("insert into usuarios (id, nome) values (:id, :nome)")
                    .param("id", id).param("nome", SinalizacaoHandler.nomeLimpo(nomeDoProvedor)).update();
            int inseridas = banco.sql("""
                    insert into identidades (provedor, id_externo, usuario_id) values (:provedor, :externo, :id)
                    on conflict (provedor, id_externo) do nothing""")
                    .param("provedor", provedor).param("externo", idExterno).param("id", id).update();
            if (inseridas == 0) {
                estado.setRollbackOnly(); // outra entrada criou antes: vale a dela
                return null;
            }
            return new Entrada(id, null);
        });
    }

    /** Liga mais um provedor a quem já tem conta (Configurações → Conta). */
    public Ligacao ligar(UUID usuario, String provedor, String idExterno) {
        Optional<UUID> dono = banco.sql("select usuario_id from identidades where provedor = :p and id_externo = :e")
                .param("p", provedor).param("e", idExterno).query(UUID.class).optional();
        if (dono.isPresent()) {
            return dono.get().equals(usuario) ? Ligacao.JA_ERA_SUA : Ligacao.DE_OUTRA_PESSOA;
        }
        int inseridas = banco.sql("""
                insert into identidades (provedor, id_externo, usuario_id) values (:p, :e, :u)
                on conflict do nothing""")
                .param("p", provedor).param("e", idExterno).param("u", usuario).update();
        return inseridas == 1 ? Ligacao.LIGADA : Ligacao.JA_TEM_DESSE_PROVEDOR;
    }

    /** Tira um provedor da conta; o último não sai (a pessoa não teria mais como entrar: para isso, apagar a conta). */
    public Desligamento desligar(UUID usuario, String provedor) {
        return transacao.execute(estado -> {
            List<String> provedores = provedores(usuario);
            if (!provedores.contains(provedor)) {
                return Desligamento.NAO_TINHA;
            }
            if (provedores.size() == 1) {
                return Desligamento.ULTIMA;
            }
            banco.sql("delete from identidades where usuario_id = :u and provedor = :p")
                    .param("u", usuario).param("p", provedor).update();
            return Desligamento.DESLIGADA;
        });
    }

    public Optional<Usuario> usuario(UUID id) {
        return banco.sql("select nome, foto_versao, foto is not null as tem_foto from usuarios where id = :id")
                .param("id", id)
                .query((linha, n) -> new Usuario(id, linha.getString("nome"), linha.getInt("foto_versao"),
                        linha.getBoolean("tem_foto"), provedores(id)))
                .optional();
    }

    private List<String> provedores(UUID usuario) {
        return banco.sql("select provedor from identidades where usuario_id = :u order by provedor")
                .param("u", usuario).query(String.class).list();
    }

    /** O nome novo, já limpo como o da sala; null se a conta não existe mais. */
    public String renomear(UUID usuario, String nome) {
        String limpo = SinalizacaoHandler.nomeLimpo(nome);
        int mudou = banco.sql("update usuarios set nome = :nome where id = :id").param("nome", limpo).param("id", usuario).update();
        return mudou == 1 ? limpo : null;
    }

    /** Apaga tudo da pessoa, na hora: identidades e sessões vão junto (on delete cascade). */
    public void apagar(UUID usuario) {
        banco.sql("delete from usuarios where id = :id").param("id", usuario).update();
    }

    public Optional<byte[]> foto(UUID usuario) {
        return banco.sql("select foto from usuarios where id = :id and foto is not null")
                .param("id", usuario).query(byte[].class).optional();
    }

    /** A foto nova (ou nenhuma: null), e de onde veio; a versão sobe para o endereço novo escapar do cache. */
    void guardarFoto(UUID usuario, byte[] foto, String origem) {
        banco.sql("update usuarios set foto = :foto, foto_origem = :origem, foto_versao = foto_versao + 1 where id = :id")
                .param("foto", foto).param("origem", origem).param("id", usuario).update();
    }
}
