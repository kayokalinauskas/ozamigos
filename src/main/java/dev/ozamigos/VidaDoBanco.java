package dev.ozamigos;

import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Conditional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;

/**
 * Deixa o banco pronto e vivo. Ao subir, roda as migrações do Flyway ({@code db/migracao}) numa thread própria,
 * tentando de novo a cada {@link #TENTAR_DE_NOVO} até dar certo: o banco fora do ar (o Supabase pausado, uma queda)
 * nunca impede o servidor de subir, e o que depende dele pergunta {@link #pronto()} antes.
 *
 * <p>Depois, uma vez por dia, registra um sinal de vida: o Supabase grátis pausa o projeto depois de 7 dias sem uso, e
 * nas semanas sem ninguém entrar com conta o banco pararia.
 */
@Component
@Conditional(Banco.Configurado.class)
public class VidaDoBanco {

    private static final Logger log = LoggerFactory.getLogger(VidaDoBanco.class);

    static final Duration TENTAR_DE_NOVO = Duration.ofSeconds(30);
    static final Duration SINAL_DE_VIDA_A_CADA = Duration.ofDays(1);

    private final DataSource fonte;
    private final JdbcClient banco;
    private final ScheduledExecutorService tarefas =
            Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().name("banco").factory());
    private volatile boolean pronto;

    public VidaDoBanco(DataSource fonte) {
        this.fonte = fonte;
        this.banco = JdbcClient.create(fonte);
        tarefas.execute(this::migrar);
    }

    /** As migrações já rodaram: as tabelas existem. Não garante que o banco responde agora. */
    public boolean pronto() {
        return pronto;
    }

    private void migrar() {
        try {
            var resultado = Flyway.configure()
                    .dataSource(fonte)
                    .schemas(Banco.ESQUEMA) // criado na primeira vez, com o histórico das migrações dentro
                    .locations("classpath:db/migracao")
                    .load()
                    .migrate();
            pronto = true;
            log.info("Banco pronto: {} migrações aplicadas agora, esquema na versão {}", resultado.migrationsExecuted,
                    resultado.targetSchemaVersion != null ? resultado.targetSchemaVersion : resultado.initialSchemaVersion);
            tarefas.scheduleWithFixedDelay(this::sinalDeVida, 0, SINAL_DE_VIDA_A_CADA.toMinutes(), TimeUnit.MINUTES);
        } catch (RuntimeException erro) {
            // Só a mensagem: a URL e o usuário não vão para o log, e a pilha não diz nada a mais.
            log.warn("Banco: não deu para preparar ({}); tentando de novo em {} s", erro.getMessage(),
                    TENTAR_DE_NOVO.toSeconds());
            tarefas.schedule(this::migrar, TENTAR_DE_NOVO.toSeconds(), TimeUnit.SECONDS);
        }
    }

    void sinalDeVida() {
        try {
            banco.sql("insert into sinais_de_vida (dia) values (current_date) on conflict (dia) do nothing").update();
            // De carona, a limpeza diária: as sessões vencidas (Sessoes) saem do banco.
            int vencidas = banco.sql("delete from sessoes where expira_em <= now()").update();
            if (vencidas > 0) {
                log.info("Banco: {} sessões vencidas apagadas", vencidas);
            }
        } catch (RuntimeException erro) {
            log.warn("Banco: o sinal de vida falhou ({})", erro.getMessage());
        }
    }

    @PreDestroy
    void parar() {
        tarefas.shutdownNow();
    }
}
