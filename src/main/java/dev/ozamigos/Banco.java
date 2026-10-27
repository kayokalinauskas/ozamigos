package dev.ozamigos;

import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.util.StringUtils;

import com.zaxxer.hikari.HikariDataSource;

/**
 * O banco (PostgreSQL), para contas e servidores salvos (docs/plano-contas.md). <b>Opcional</b>, como a retransmissão:
 * sem OZAMIGOS_BANCO_URL, o servidor sobe como antes, sem nada do que depende dele. O grupo fixo, os grupos criados na
 * hora e os convidados nunca dependem do banco.
 *
 * <p>A fonte de dados é montada aqui, e não pelo Spring (o DataSourceAutoConfiguration fica de fora, em
 * application.properties): sem a URL, ele recusaria subir. O pool não testa a conexão ao nascer
 * ({@code initializationFailTimeout = -1}): com o banco fora do ar, o servidor sobe do mesmo jeito, e o VidaDoBanco
 * tenta as migrações de novo até dar certo.
 *
 * <p>No Render, o banco é o Supabase grátis na região do Render, pelo Session pooler: a conexão direta do Supabase
 * grátis é só IPv6, que o Render não tem. O pool é pequeno, porque o pooler grátis aceita poucas conexões.
 */
@Configuration(proxyBeanMethods = false)
@Conditional(Banco.Configurado.class)
public class Banco {

    static final int CONEXOES = 5;

    @Bean(destroyMethod = "close")
    HikariDataSource fonteDoBanco(@Value("${ozamigos.banco.url}") String url,
            @Value("${ozamigos.banco.usuario:}") String usuario, @Value("${ozamigos.banco.senha:}") String senha) {
        HikariDataSource fonte = new HikariDataSource();
        fonte.setPoolName("banco");
        fonte.setJdbcUrl(url);
        if (StringUtils.hasText(usuario)) fonte.setUsername(usuario);
        if (StringUtils.hasText(senha)) fonte.setPassword(senha);
        fonte.setMaximumPoolSize(CONEXOES);
        fonte.setMinimumIdle(1);
        fonte.setConnectionTimeout(Duration.ofSeconds(10).toMillis());
        fonte.setInitializationFailTimeout(-1);
        return fonte;
    }

    /** Liga o banco só com a URL preenchida (a propriedade existe sempre, vazia sem a variável de ambiente). */
    static final class Configurado implements Condition {
        @Override
        public boolean matches(ConditionContext contexto, AnnotatedTypeMetadata metadados) {
            return StringUtils.hasText(contexto.getEnvironment().getProperty("ozamigos.banco.url"));
        }
    }
}
