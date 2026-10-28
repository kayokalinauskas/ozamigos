package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Os testes que precisam do banco: um Postgres de verdade, em Docker (o mesmo do compose.yaml), um só para todas as
 * classes (o Testcontainers o desliga no fim). Sem o Docker ligado no PC, esses testes pulam; no CI ele sempre existe.
 */
@Testcontainers(disabledWithoutDocker = true)
abstract class ComBanco {

    static final PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18-alpine");

    static {
        if (DockerClientFactory.instance().isDockerAvailable()) {
            postgres.start();
            // Como o Supabase: o public já tem coisas do provedor. As migrações não podem depender dele vazio.
            try (var conexao = postgres.createConnection(""); var comando = conexao.createStatement()) {
                comando.execute("create function public.do_provedor() returns int language sql as 'select 1'");
            } catch (java.sql.SQLException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    @DynamicPropertySource
    static void banco(DynamicPropertyRegistry propriedades) {
        propriedades.add("ozamigos.banco.url", postgres::getJdbcUrl);
        propriedades.add("ozamigos.banco.usuario", postgres::getUsername);
        propriedades.add("ozamigos.banco.senha", postgres::getPassword);
        // Os testes criam muitas contas e fazem muitos pedidos do mesmo endereço: os freios de verdade têm testes próprios.
        propriedades.add("ozamigos.limite.contas-novas-por-hora", () -> "100000");
        propriedades.add("ozamigos.limite.contas-novas-por-endereco", () -> "100000");
        propriedades.add("ozamigos.limite.api-por-minuto", () -> "100000");
    }

    static void esperarPronto(VidaDoBanco vida) throws InterruptedException {
        Instant limite = Instant.now().plus(Duration.ofSeconds(30));
        while (!vida.pronto() && Instant.now().isBefore(limite)) {
            Thread.sleep(100);
        }
        assertThat(vida.pronto()).as("as migrações rodaram").isTrue();
    }
}
