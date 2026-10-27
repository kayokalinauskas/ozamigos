package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import com.zaxxer.hikari.HikariDataSource;

/** O banco num Postgres de verdade, em Docker (o mesmo do compose.yaml), e o servidor sem ele. */
@Testcontainers(disabledWithoutDocker = true) // sem o Docker ligado no PC, pula; no CI ele sempre existe
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = "ozamigos.senha=teste")
class BancoTest {

    @Container
    static final PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18-alpine");

    @DynamicPropertySource
    static void banco(DynamicPropertyRegistry propriedades) {
        propriedades.add("ozamigos.banco.url", postgres::getJdbcUrl);
        propriedades.add("ozamigos.banco.usuario", postgres::getUsername);
        propriedades.add("ozamigos.banco.senha", postgres::getPassword);
    }

    @LocalServerPort
    private int porta;

    @Autowired
    private VidaDoBanco vida;

    @Autowired
    private DataSource fonte;

    @Test
    void asMigracoesRodamAoSubirEOSinalDeVidaFicaRegistrado() throws Exception {
        esperarPronto(vida);

        LocalDate dia = JdbcClient.create(fonte).sql("select max(dia) from sinais_de_vida").query(LocalDate.class).single();
        assertThat(dia).isNotNull();

        // A saúde continua só a do servidor, sem dizer nada do banco.
        try (HttpClient http = HttpClient.newHttpClient()) {
            HttpResponse<String> saude = http.send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + porta + "/actuator/health")).build(),
                    HttpResponse.BodyHandlers.ofString());
            assertThat(saude.statusCode()).isEqualTo(200);
            assertThat(saude.body()).doesNotContain("db");
        }
    }

    @Test
    void oBancoForaDoArNaoImpedeDeSubirENemFicaPronto() throws Exception {
        try (HikariDataSource foraDoAr = new Banco().fonteDoBanco("jdbc:postgresql://127.0.0.1:1/nada", "", "")) {
            foraDoAr.setConnectionTimeout(250);
            VidaDoBanco semBanco = new VidaDoBanco(foraDoAr);
            Thread.sleep(1500);
            assertThat(semBanco.pronto()).isFalse();
            semBanco.parar();
        }
    }

    private static void esperarPronto(VidaDoBanco vida) throws InterruptedException {
        Instant limite = Instant.now().plus(Duration.ofSeconds(30));
        while (!vida.pronto() && Instant.now().isBefore(limite)) Thread.sleep(100);
        assertThat(vida.pronto()).as("as migrações rodaram").isTrue();
        // O sinal de vida é agendado logo depois de ficar pronto.
        Thread.sleep(500);
    }
}
