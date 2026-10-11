package dev.ozamigos;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;

// RANDOM_PORT sobe o Tomcat de verdade, que é quem fornece o suporte a WebSocket.
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = "ozamigos.senha=teste")
class OzamigosShareApplicationTests {

    @Test
    void contextLoads() {
    }
}
