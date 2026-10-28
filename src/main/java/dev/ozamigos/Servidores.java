package dev.ozamigos;

import java.io.IOException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.function.ToIntFunction;
import java.util.regex.Pattern;

import javax.sql.DataSource;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Os servidores salvos (docs/plano-contas.md, fase 2): criados por quem tem conta, com membros, papéis e convites, no
 * banco. Ao contrário dos grupos criados na hora (Grupos), não somem quando o servidor reinicia, e quem é membro entra
 * sem senha.
 *
 * <p><b>Quem pode o quê</b> (as regras ficam todas aqui, e a API só traduz): o <b>dono</b> faz tudo, e é o único que
 * apaga o servidor, passa a posse, troca papéis e decide se os membros convidam; o <b>admin</b> muda o nome e o ícone,
 * convida, vê e apaga convites e expulsa membros (não outro admin); o <b>membro</b> entra e convida, se o dono deixar.
 * Todos saem quando querem, menos o dono (passa a posse ou apaga antes). Quem é expulso fica bloqueado: não volta por
 * convite nenhum até o dono ou um admin desbloquear (decisão do dono, 28/10/2026).
 *
 * <p>Para quem não é membro, um servidor que existe e um que não existe são iguais ({@link Motivo#NAO_EXISTE}): o
 * endereço de um servidor não revela nada a quem não foi convidado.
 */
@Component
public class Servidores {

    /** Por pessoa: dona de até tantos servidores, e membro (dona inclusive) de até tantos. */
    static final int DONA_DE_NO_MAXIMO = 10;
    static final int MEMBRO_DE_NO_MAXIMO = 100;
    static final int MEMBROS_NO_MAXIMO = 100;
    static final int CONVITES_ATIVOS_NO_MAXIMO = 20;
    static final int USOS_NO_MAXIMO = 100;
    static final Duration VALIDADE_MAXIMA = Duration.ofDays(30);
    static final int NOME_MAXIMO = 40;
    /** O ícone, como a foto da conta: quadrado, reduzido aqui. */
    static final int LADO_DO_ICONE = 128;
    static final int TETO_DO_ICONE = 16 * 1024;
    static final Pattern CODIGO = Pattern.compile("[A-Za-z0-9]{10}");
    private static final String LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

    public enum Papel {
        DONO, ADMIN, MEMBRO;

        String noBanco() {
            return name().toLowerCase(Locale.ROOT);
        }

        static Papel doBanco(String papel) {
            return valueOf(papel.toUpperCase(Locale.ROOT));
        }
    }

    /** O que impede uma ação, com o motivo e o status que a API devolve. */
    public enum Motivo {
        NAO_EXISTE(HttpStatus.NOT_FOUND, "servidor-nao-existe"),
        SEM_PERMISSAO(HttpStatus.FORBIDDEN, "sem-permissao"),
        MEMBRO_NAO_EXISTE(HttpStatus.NOT_FOUND, "membro-nao-existe"),
        CONVITE_INVALIDO(HttpStatus.NOT_FOUND, "convite-invalido"),
        BLOQUEADO(HttpStatus.FORBIDDEN, "bloqueado"),
        NOME_INVALIDO(HttpStatus.BAD_REQUEST, "nome-invalido"),
        ICONE_INVALIDO(HttpStatus.BAD_REQUEST, "icone-invalido"),
        PEDIDO_INVALIDO(HttpStatus.BAD_REQUEST, "pedido-invalido"),
        CONFIRME(HttpStatus.BAD_REQUEST, "confirme"),
        DONO_NAO_SAI(HttpStatus.CONFLICT, "dono-nao-sai"),
        DONA_DE_DEMAIS(HttpStatus.CONFLICT, "servidores-demais"),
        MEMBRO_DE_DEMAIS(HttpStatus.CONFLICT, "participa-demais"),
        MEMBROS_DEMAIS(HttpStatus.CONFLICT, "membros-demais"),
        CONVITES_DEMAIS(HttpStatus.CONFLICT, "convites-demais");

        final HttpStatus status;
        final String texto;

        Motivo(HttpStatus status, String texto) {
            this.status = status;
            this.texto = texto;
        }
    }

    /** Uma ação recusada. Lançada dentro da transação, desfaz o que ela já tinha feito. */
    public static final class Recusa extends RuntimeException {
        final Motivo motivo;

        Recusa(Motivo motivo) {
            super(motivo.texto, null, false, false);
            this.motivo = motivo;
        }
    }

    /** Um servidor na lista de quem é membro. {@code icone}: o endereço, ou null. */
    public record Resumo(String codigo, String nome, String icone, Papel papel, int membros) {}

    public record Membro(UUID conta, String nome, String foto, Papel papel) {}

    /** O servidor visto por um membro: o seu papel, o que ele pode fazer e quem está nele. */
    public record Servidor(String codigo, String nome, String icone, Papel papel, boolean membrosConvidam,
            List<Membro> membros) {}

    /** {@code usosMaximos} e {@code expiraEm} null: sem limite. {@code criadoPor}: o nome, ou null (a conta saiu). */
    public record Convite(String codigo, Instant expiraEm, Integer usosMaximos, int usos, String criadoPor) {}

    /** Quem foi expulso e não volta por convite. {@code porQuem}: o nome, ou null (a conta saiu). */
    public record Bloqueado(UUID conta, String nome, String foto, Instant desde, String porQuem) {}

    /** O que quem recebe um convite vê antes de aceitar (sem entrar, e mesmo sem conta). */
    public record PreviaDoConvite(String nome, String icone, int membros) {}

    private final JdbcClient banco;
    private final TransactionTemplate transacao;
    private final SecureRandom aleatorio = new SecureRandom();

    public Servidores(ObjectProvider<DataSource> fonte) {
        DataSource dados = fonte.getIfAvailable();
        this.banco = dados == null ? null : JdbcClient.create(dados);
        this.transacao = dados == null ? null : new TransactionTemplate(new DataSourceTransactionManager(dados));
    }

    /** Um servidor novo, com quem criou de dono. Devolve o código (o endereço). */
    public String criar(UUID usuario, String nome) {
        String limpo = nomeLimpo(nome);
        return transacao.execute(estado -> {
            travarUsuario(usuario); // duas criações juntas não passam dos limites
            int dona = banco.sql("select count(*) from membros where usuario_id = :u and papel = 'dono'")
                    .param("u", usuario).query(Integer.class).single();
            if (dona >= DONA_DE_NO_MAXIMO) {
                throw new Recusa(Motivo.DONA_DE_DEMAIS);
            }
            if (quantosParticipa(usuario) >= MEMBRO_DE_NO_MAXIMO) {
                throw new Recusa(Motivo.MEMBRO_DE_DEMAIS);
            }
            UUID id = UUID.randomUUID();
            String codigo = inserirComCodigoNovo(codigoNovo -> banco.sql(
                    "insert into servidores (id, codigo, nome) values (:id, :codigo, :nome) on conflict (codigo) do nothing")
                    .param("id", id).param("codigo", codigoNovo).param("nome", limpo).update());
            banco.sql("insert into membros (servidor_id, usuario_id, papel) values (:s, :u, 'dono')")
                    .param("s", id).param("u", usuario).update();
            return codigo;
        });
    }

    /** Os servidores de que a pessoa é membro, do mais recente para o mais antigo. */
    public List<Resumo> meus(UUID usuario) {
        return banco.sql("""
                select s.id, s.codigo, s.nome, s.icone is not null as tem_icone, s.icone_versao, m.papel,
                       (select count(*) from membros t where t.servidor_id = s.id) as membros
                from membros m join servidores s on s.id = m.servidor_id
                where m.usuario_id = :u
                order by m.entrou_em desc, s.codigo""")
                .param("u", usuario)
                .query((linha, n) -> new Resumo(linha.getString("codigo"), linha.getString("nome"),
                        enderecoDoIcone(linha.getObject("id", UUID.class), linha.getBoolean("tem_icone"), linha.getInt("icone_versao")),
                        Papel.doBanco(linha.getString("papel")), linha.getInt("membros")))
                .list();
    }

    /** O servidor, para um membro dele. */
    public Servidor ver(String codigo, UUID usuario) {
        Acesso acesso = acesso(codigo, usuario, false);
        List<Membro> membros = banco.sql("""
                select u.id, u.nome, u.foto is not null as tem_foto, u.foto_versao, m.papel
                from membros m join usuarios u on u.id = m.usuario_id
                where m.servidor_id = :s
                order by case m.papel when 'dono' then 0 when 'admin' then 1 else 2 end, lower(u.nome), u.id""")
                .param("s", acesso.id())
                .query((linha, n) -> {
                    UUID id = linha.getObject("id", UUID.class);
                    String foto = ContaApi.enderecoDaFoto(id, linha.getBoolean("tem_foto"), linha.getInt("foto_versao"));
                    return new Membro(id, linha.getString("nome"), foto, Papel.doBanco(linha.getString("papel")));
                })
                .list();
        return banco.sql("select nome, icone is not null as tem_icone, icone_versao, membros_convidam from servidores where id = :s")
                .param("s", acesso.id())
                .query((linha, n) -> new Servidor(codigo, linha.getString("nome"),
                        enderecoDoIcone(acesso.id(), linha.getBoolean("tem_icone"), linha.getInt("icone_versao")),
                        acesso.papel(), linha.getBoolean("membros_convidam"), membros))
                .single();
    }

    /** O papel da pessoa no servidor, ou vazio se ela não é membro (ou ele não existe). É o que deixa entrar na sala. */
    public Optional<Papel> papel(String codigo, UUID usuario) {
        if (!CODIGO.matcher(codigo).matches()) {
            return Optional.empty();
        }
        return banco.sql("select m.papel from servidores s join membros m on m.servidor_id = s.id where s.codigo = :c and m.usuario_id = :u")
                .param("c", codigo).param("u", usuario).query(String.class).optional().map(Papel::doBanco);
    }

    /**
     * Muda o nome (dono e admin) e se os membros convidam (só o dono); null fica como está. As permissões das duas são
     * conferidas antes de mudar qualquer uma: ou muda tudo, ou nada.
     */
    public void mudar(String codigo, UUID usuario, String nome, Boolean membrosConvidam) {
        String limpo = nome == null ? null : nomeLimpo(nome);
        Acesso acesso = acesso(codigo, usuario, false);
        exigir(limpo == null || acesso.papel() != Papel.MEMBRO);
        exigir(membrosConvidam == null || acesso.papel() == Papel.DONO);
        banco.sql("""
                update servidores set nome = coalesce(cast(:nome as text), nome),
                       membros_convidam = coalesce(cast(:convidam as boolean), membros_convidam)
                where id = :s""")
                .param("nome", limpo).param("convidam", membrosConvidam).param("s", acesso.id()).update();
    }

    /** Muda o nome (dono e admin). Devolve o nome novo, já limpo. */
    public String renomear(String codigo, UUID usuario, String nome) {
        mudar(codigo, usuario, nome, null);
        return nomeLimpo(nome);
    }

    /** Deixa ou não os membros criarem convites (só o dono). */
    public void membrosConvidam(String codigo, UUID usuario, boolean convidam) {
        mudar(codigo, usuario, null, convidam);
    }

    /**
     * O ícone novo, a partir da imagem que a pessoa mandou (dono e admin), ou nenhum ({@code imagem} null). Redesenhado
     * aqui, quadrado, sem metadados. Devolve o endereço novo, ou null.
     */
    public String trocarIcone(String codigo, UUID usuario, byte[] imagem) {
        Acesso acesso = acesso(codigo, usuario, false);
        exigir(acesso.papel() != Papel.MEMBRO);
        byte[] icone = null;
        if (imagem != null) {
            try {
                icone = Imagens.jpegReduzido(imagem, LADO_DO_ICONE, TETO_DO_ICONE, true);
            } catch (IOException | RuntimeException e) {
                icone = null; // uma imagem quebrada é só uma imagem inválida
            }
            if (icone == null) {
                throw new Recusa(Motivo.ICONE_INVALIDO);
            }
        }
        int versao = banco.sql("update servidores set icone = :icone, icone_versao = icone_versao + 1 where id = :s returning icone_versao")
                .param("icone", icone).param("s", acesso.id()).query(Integer.class).single();
        return enderecoDoIcone(acesso.id(), icone != null, versao);
    }

    /**
     * O ícone, para quem tem o endereço (ele aparece também na prévia de um convite). Pelo id interno, e não pelo código:
     * a prévia de um convite não revela o endereço do servidor.
     */
    public Optional<byte[]> icone(UUID servidor) {
        return banco.sql("select icone from servidores where id = :s and icone is not null")
                .param("s", servidor).query(byte[].class).optional();
    }

    /** Apaga o servidor, com membros e convites (só o dono). */
    public void apagar(String codigo, UUID usuario) {
        Acesso acesso = acesso(codigo, usuario, false);
        exigir(acesso.papel() == Papel.DONO);
        banco.sql("delete from servidores where id = :s").param("s", acesso.id()).update();
    }

    /** Passa a posse a outro membro (só o dono); quem era dono vira admin. */
    public void passarPosse(String codigo, UUID usuario, UUID novoDono) {
        transacao.executeWithoutResult(estado -> {
            Acesso acesso = acesso(codigo, usuario, true);
            exigir(acesso.papel() == Papel.DONO);
            if (novoDono.equals(usuario)) {
                return;
            }
            papelDe(acesso.id(), novoDono); // precisa ser membro
            if (dona(novoDono) >= DONA_DE_NO_MAXIMO) {
                throw new Recusa(Motivo.DONA_DE_DEMAIS);
            }
            // Nesta ordem: o índice um_dono_por_servidor não deixa dois donos nem por um instante.
            mudarPapelNoBanco(acesso.id(), usuario, Papel.ADMIN);
            mudarPapelNoBanco(acesso.id(), novoDono, Papel.DONO);
        });
    }

    /** Admin vira membro, ou membro vira admin (só o dono; a posse é passarPosse). */
    public void mudarPapel(String codigo, UUID usuario, UUID alvo, Papel papel) {
        if (papel == Papel.DONO) {
            throw new Recusa(Motivo.PEDIDO_INVALIDO);
        }
        transacao.executeWithoutResult(estado -> {
            Acesso acesso = acesso(codigo, usuario, true);
            exigir(acesso.papel() == Papel.DONO);
            exigir(papelDe(acesso.id(), alvo) != Papel.DONO);
            mudarPapelNoBanco(acesso.id(), alvo, papel);
        });
    }

    /**
     * Tira alguém do servidor e o bloqueia: o dono tira qualquer um; o admin, só membros. Sem o bloqueio, um convite sem
     * limite de usos traria a pessoa de volta na hora.
     */
    public void expulsar(String codigo, UUID usuario, UUID alvo) {
        transacao.executeWithoutResult(estado -> {
            Acesso acesso = acesso(codigo, usuario, true);
            exigir(!alvo.equals(usuario)); // sair é outra coisa
            Papel doAlvo = papelDe(acesso.id(), alvo);
            exigir(acesso.papel() == Papel.DONO || (acesso.papel() == Papel.ADMIN && doAlvo == Papel.MEMBRO));
            tirar(acesso.id(), alvo);
            banco.sql("""
                    insert into bloqueios (servidor_id, usuario_id, bloqueado_por) values (:s, :alvo, :u)
                    on conflict do nothing""")
                    .param("s", acesso.id()).param("alvo", alvo).param("u", usuario).update();
        });
    }

    /** Quem está bloqueado (dono e admin), dos mais recentes para os mais antigos. */
    public List<Bloqueado> bloqueados(String codigo, UUID usuario) {
        Acesso acesso = acesso(codigo, usuario, false);
        exigir(acesso.papel() != Papel.MEMBRO);
        return banco.sql("""
                select u.id, u.nome, u.foto is not null as tem_foto, u.foto_versao, b.bloqueado_em, q.nome as por
                from bloqueios b join usuarios u on u.id = b.usuario_id left join usuarios q on q.id = b.bloqueado_por
                where b.servidor_id = :s
                order by b.bloqueado_em desc, u.id""")
                .param("s", acesso.id())
                .query((linha, n) -> {
                    UUID id = linha.getObject("id", UUID.class);
                    return new Bloqueado(id, linha.getString("nome"),
                            ContaApi.enderecoDaFoto(id, linha.getBoolean("tem_foto"), linha.getInt("foto_versao")),
                            linha.getTimestamp("bloqueado_em").toInstant(), linha.getString("por"));
                })
                .list();
    }

    /** Desfaz o bloqueio (dono e admin): a pessoa pode voltar por um convite. */
    public void desbloquear(String codigo, UUID usuario, UUID alvo) {
        Acesso acesso = acesso(codigo, usuario, false);
        exigir(acesso.papel() != Papel.MEMBRO);
        banco.sql("delete from bloqueios where servidor_id = :s and usuario_id = :alvo")
                .param("s", acesso.id()).param("alvo", alvo).update();
    }

    /** A pessoa sai do servidor. O dono não sai: passa a posse ou apaga antes. */
    public void sair(String codigo, UUID usuario) {
        Acesso acesso = acesso(codigo, usuario, false);
        if (acesso.papel() == Papel.DONO) {
            throw new Recusa(Motivo.DONO_NAO_SAI);
        }
        tirar(acesso.id(), usuario);
    }

    /**
     * Um convite novo: dono e admin sempre, membro se o dono deixar. {@code validade} e {@code usos} null: sem limite.
     * Devolve o código.
     */
    public String convidar(String codigo, UUID usuario, Duration validade, Integer usos) {
        if ((validade != null && (validade.isNegative() || validade.isZero() || validade.compareTo(VALIDADE_MAXIMA) > 0))
                || (usos != null && (usos < 1 || usos > USOS_NO_MAXIMO))) {
            throw new Recusa(Motivo.PEDIDO_INVALIDO);
        }
        return transacao.execute(estado -> {
            Acesso acesso = acesso(codigo, usuario, true); // trava o servidor: dois convites juntos não passam do limite
            if (acesso.papel() == Papel.MEMBRO) {
                exigir(banco.sql("select membros_convidam from servidores where id = :s")
                        .param("s", acesso.id()).query(Boolean.class).single());
            }
            // Os que já não valem saem antes de contar: só os ativos ocupam lugar.
            banco.sql("delete from convites c where c.servidor_id = :s and not " + VALE).param("s", acesso.id()).update();
            int ativos = banco.sql("select count(*) from convites where servidor_id = :s").param("s", acesso.id())
                    .query(Integer.class).single();
            if (ativos >= CONVITES_ATIVOS_NO_MAXIMO) {
                throw new Recusa(Motivo.CONVITES_DEMAIS);
            }
            Timestamp expira = validade == null ? null : Timestamp.from(Instant.now().plus(validade));
            return inserirComCodigoNovo(codigoNovo -> banco.sql("""
                    insert into convites (codigo, servidor_id, criado_por, expira_em, usos_maximos)
                    values (:codigo, :s, :u, :expira, :usos) on conflict (codigo) do nothing""")
                    .param("codigo", codigoNovo).param("s", acesso.id()).param("u", usuario)
                    .param("expira", expira).param("usos", usos).update());
        });
    }

    /** Os convites que ainda valem (dono e admin), dos mais novos para os mais antigos. */
    public List<Convite> convites(String codigo, UUID usuario) {
        Acesso acesso = acesso(codigo, usuario, false);
        exigir(acesso.papel() != Papel.MEMBRO);
        return banco.sql("""
                select c.codigo, c.expira_em, c.usos_maximos, c.usos, u.nome
                from convites c left join usuarios u on u.id = c.criado_por
                where c.servidor_id = :s and %s
                order by c.criado_em desc, c.codigo""".formatted(VALE))
                .param("s", acesso.id())
                .query((linha, n) -> {
                    Timestamp expira = linha.getTimestamp("expira_em");
                    return new Convite(linha.getString("codigo"), expira == null ? null : expira.toInstant(),
                            linha.getObject("usos_maximos", Integer.class), linha.getInt("usos"), linha.getString("nome"));
                })
                .list();
    }

    /** Apaga um convite (dono e admin): o link deixa de valer na hora. */
    public void apagarConvite(String codigo, UUID usuario, String convite) {
        Acesso acesso = acesso(codigo, usuario, false);
        exigir(acesso.papel() != Papel.MEMBRO);
        banco.sql("delete from convites where codigo = :c and servidor_id = :s").param("c", convite).param("s", acesso.id()).update();
    }

    /** O que o convite mostra antes de aceitar; vazio se ele não existe ou já não vale. */
    public Optional<PreviaDoConvite> previa(String convite) {
        if (!CODIGO.matcher(convite).matches()) {
            return Optional.empty();
        }
        return banco.sql("""
                select s.id, s.nome, s.icone is not null as tem_icone, s.icone_versao,
                       (select count(*) from membros m where m.servidor_id = s.id) as membros
                from convites c join servidores s on s.id = c.servidor_id
                where c.codigo = :c and %s""".formatted(VALE))
                .param("c", convite)
                .query((linha, n) -> new PreviaDoConvite(linha.getString("nome"),
                        enderecoDoIcone(linha.getObject("id", UUID.class), linha.getBoolean("tem_icone"), linha.getInt("icone_versao")),
                        linha.getInt("membros")))
                .optional();
    }

    /**
     * Aceita o convite: a pessoa vira membro (um uso a menos no convite). Quem já é membro só recebe o código, sem gastar
     * um uso, mesmo com o convite já vencido ou gasto: o link antigo ainda leva ao servidor. Devolve o código do servidor.
     */
    public String aceitar(String convite, UUID usuario) {
        if (!CODIGO.matcher(convite).matches()) {
            throw new Recusa(Motivo.CONVITE_INVALIDO);
        }
        return transacao.execute(estado -> {
            travarUsuario(usuario);
            // Trava o convite: dois aceites juntos não passam do limite de usos.
            record Achado(UUID servidor, String codigo, boolean vale) {}
            Achado achado = banco.sql("""
                    select c.servidor_id, s.codigo, (%s) as vale from convites c join servidores s on s.id = c.servidor_id
                    where c.codigo = :c
                    for update of c, s""".formatted(VALE))
                    .param("c", convite)
                    .query((linha, n) -> new Achado(linha.getObject("servidor_id", UUID.class), linha.getString("codigo"),
                            linha.getBoolean("vale")))
                    .optional().orElseThrow(() -> new Recusa(Motivo.CONVITE_INVALIDO));
            boolean jaEra = banco.sql("select count(*) from membros where servidor_id = :s and usuario_id = :u")
                    .param("s", achado.servidor()).param("u", usuario).query(Integer.class).single() > 0;
            if (jaEra) {
                return achado.codigo();
            }
            if (!achado.vale()) {
                throw new Recusa(Motivo.CONVITE_INVALIDO);
            }
            boolean bloqueado = banco.sql("select count(*) from bloqueios where servidor_id = :s and usuario_id = :u")
                    .param("s", achado.servidor()).param("u", usuario).query(Integer.class).single() > 0;
            if (bloqueado) {
                throw new Recusa(Motivo.BLOQUEADO);
            }
            if (quantosParticipa(usuario) >= MEMBRO_DE_NO_MAXIMO) {
                throw new Recusa(Motivo.MEMBRO_DE_DEMAIS);
            }
            int membros = banco.sql("select count(*) from membros where servidor_id = :s").param("s", achado.servidor())
                    .query(Integer.class).single();
            if (membros >= MEMBROS_NO_MAXIMO) {
                throw new Recusa(Motivo.MEMBROS_DEMAIS);
            }
            banco.sql("insert into membros (servidor_id, usuario_id, papel) values (:s, :u, 'membro')")
                    .param("s", achado.servidor()).param("u", usuario).update();
            banco.sql("update convites set usos = usos + 1 where codigo = :c").param("c", convite).update();
            return achado.codigo();
        });
    }

    /** A chave da sala do servidor em Salas (uma sala por servidor, por enquanto: as várias são a fase 3). */
    public static String sala(String codigo) {
        return "servidor:" + codigo;
    }

    static String enderecoDoIcone(UUID servidor, boolean temIcone, int versao) {
        return temIcone ? "/api/icones/" + servidor + "?v=" + versao : null;
    }

    /** O nome como os membros veem: sem controles nem inversões de direção, até NOME_MAXIMO, nunca vazio. */
    static String nomeLimpo(String nome) {
        String limpo = SinalizacaoHandler.semControles(nome == null ? "" : nome, NOME_MAXIMO);
        if (limpo.isEmpty()) {
            throw new Recusa(Motivo.NOME_INVALIDO);
        }
        return limpo;
    }

    /** O convite (de apelido {@code c} na consulta) ainda vale: não venceu e não gastou os usos. */
    private static final String VALE = "(c.expira_em is null or c.expira_em > now()) and (c.usos_maximos is null or c.usos < c.usos_maximos)";

    private static void exigir(boolean pode) {
        if (!pode) {
            throw new Recusa(Motivo.SEM_PERMISSAO);
        }
    }

    private record Acesso(UUID id, Papel papel) {}

    /** O servidor e o papel da pessoa nele; NAO_EXISTE se ela não é membro. {@code travar}: trava o servidor até o fim da transação. */
    private Acesso acesso(String codigo, UUID usuario, boolean travar) {
        if (codigo == null || !CODIGO.matcher(codigo).matches()) {
            throw new Recusa(Motivo.NAO_EXISTE);
        }
        return banco.sql("""
                select s.id, m.papel from servidores s join membros m on m.servidor_id = s.id
                where s.codigo = :c and m.usuario_id = :u""" + (travar ? " for update of s" : ""))
                .param("c", codigo).param("u", usuario)
                .query((linha, n) -> new Acesso(linha.getObject("id", UUID.class), Papel.doBanco(linha.getString("papel"))))
                .optional().orElseThrow(() -> new Recusa(Motivo.NAO_EXISTE));
    }

    private Papel papelDe(UUID servidor, UUID usuario) {
        return banco.sql("select papel from membros where servidor_id = :s and usuario_id = :u")
                .param("s", servidor).param("u", usuario).query(String.class).optional().map(Papel::doBanco)
                .orElseThrow(() -> new Recusa(Motivo.MEMBRO_NAO_EXISTE));
    }

    private void mudarPapelNoBanco(UUID servidor, UUID usuario, Papel papel) {
        banco.sql("update membros set papel = :p where servidor_id = :s and usuario_id = :u")
                .param("p", papel.noBanco()).param("s", servidor).param("u", usuario).update();
    }

    private void tirar(UUID servidor, UUID usuario) {
        banco.sql("delete from membros where servidor_id = :s and usuario_id = :u").param("s", servidor).param("u", usuario).update();
    }

    private int dona(UUID usuario) {
        return banco.sql("select count(*) from membros where usuario_id = :u and papel = 'dono'").param("u", usuario)
                .query(Integer.class).single();
    }

    private int quantosParticipa(UUID usuario) {
        return banco.sql("select count(*) from membros where usuario_id = :u").param("u", usuario).query(Integer.class).single();
    }

    /** Trava a conta até o fim da transação; NAO_EXISTE se ela foi apagada no meio. */
    private void travarUsuario(UUID usuario) {
        banco.sql("select id from usuarios where id = :u for update").param("u", usuario).query(UUID.class).optional()
                .orElseThrow(() -> new Recusa(Motivo.NAO_EXISTE));
    }

    /** Sorteia códigos até um não existir (com 55^10 combinações, a segunda tentativa é rara como um raio). */
    private String inserirComCodigoNovo(ToIntFunction<String> inserir) {
        for (int tentativa = 0; tentativa < 5; tentativa++) {
            String codigo = codigoNovo();
            if (inserir.applyAsInt(codigo) == 1) {
                return codigo;
            }
        }
        throw new DuplicateKeyException("código repetido cinco vezes");
    }

    /** Sem as letras que se confundem (0 e O, 1, l e I): o código pode ser ditado. */
    private String codigoNovo() {
        StringBuilder codigo = new StringBuilder(10);
        for (int i = 0; i < 10; i++) {
            codigo.append(LETRAS.charAt(aleatorio.nextInt(LETRAS.length())));
        }
        return codigo.toString();
    }
}
