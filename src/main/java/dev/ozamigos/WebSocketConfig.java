package dev.ozamigos;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final SinalizacaoHandler handler;
    private final ContaNoWebSocket conta;

    public WebSocketConfig(SinalizacaoHandler handler, ContaNoWebSocket conta) {
        this.handler = handler;
        this.conta = conta;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registro) {
        // Sem setAllowedOrigins: o Spring só aceita conexões vindas de páginas do próprio servidor.
        // A conta (o cookie da sessão) é lida na abertura: o handler usa o nome dela.
        registro.addHandler(handler, "/sinal").addInterceptors(conta);
    }

    /** Uma oferta SDP passa fácil de 8 KB, o limite padrão do Tomcat para mensagens de texto. */
    @Bean
    public ServletServerContainerFactoryBean configuracaoDoWebSocket() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(64 * 1024);
        return container;
    }
}
