package dev.ozamigos;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDate;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.zaxxer.hikari.HikariDataSource;

/** O banco num Postgres de verdade, e o servidor sem ele. */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class BancoTest extends ComBanco {

    @LocalServerPort
    private int porta;

    @Autowired
    private VidaDoBanco vida;

    @Autowired
    private DataSource fonte;

    @Test
    void asMigracoesRodamAoSubirEOSinalDeVidaFicaRegistrado() throws Exception {
        esperarPronto(vida);
        Thread.sleep(500); // o sinal de vida é agendado logo depois de ficar pronto

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
}
