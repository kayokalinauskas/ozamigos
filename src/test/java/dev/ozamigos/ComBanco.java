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
        }
    }

    @DynamicPropertySource
    static void banco(DynamicPropertyRegistry propriedades) {
        propriedades.add("ozamigos.banco.url", postgres::getJdbcUrl);
        propriedades.add("ozamigos.banco.usuario", postgres::getUsername);
        propriedades.add("ozamigos.banco.senha", postgres::getPassword);
    }

    static void esperarPronto(VidaDoBanco vida) throws InterruptedException {
        Instant limite = Instant.now().plus(Duration.ofSeconds(30));
        while (!vida.pronto() && Instant.now().isBefore(limite)) {
            Thread.sleep(100);
        }
        assertThat(vida.pronto()).as("as migrações rodaram").isTrue();
    }
}
