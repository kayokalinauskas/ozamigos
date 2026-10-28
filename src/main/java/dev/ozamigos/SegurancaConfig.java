package dev.ozamigos;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository;

/**
 * O Spring Security aqui serve só para o login com o Google e o Discord (o fluxo OAuth2: estado, PKCE, troca do código,
 * conferência do token). Todo o resto continua aberto como antes, e quem a pessoa é vem da sessão do Ozamigos
 * (Sessoes), não do Spring: no fim do login, o AoEntrar cria a sessão e a do Spring é descartada.
 *
 * <ul>
 * <li>Sem CSRF do Spring: as ações das contas conferem a origem (ProtecaoDaApi), e o cookie é SameSite=Lax.</li>
 * <li>Sem o Cache-Control do Spring: as regras de cache da interface são as do CacheConfig (sem elas, um deploy novo
 * não aparecia).</li>
 * <li>A autenticação do Spring não é guardada na sessão HTTP ({@code RequestAttributeSecurityContextRepository}): ela
 * só existe durante o pedido da volta do provedor. A sessão HTTP em si guarda só o pedido do login em andamento.</li>
 * </ul>
 */
@Configuration
public class SegurancaConfig {

    @Bean
    SecurityFilterChain seguranca(HttpSecurity http, ProvedoresDeLogin provedores, AoEntrar aoEntrar) throws Exception {
        http.authorizeHttpRequests(pedidos -> pedidos.anyRequest().permitAll())
                .csrf(csrf -> csrf.disable())
                .headers(cabecalhos -> cabecalhos.cacheControl(cache -> cache.disable()))
                .requestCache(cache -> cache.disable())
                .securityContext(contexto -> contexto.securityContextRepository(new RequestAttributeSecurityContextRepository()))
                .sessionManagement(sessao -> sessao.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .formLogin(formulario -> formulario.disable())
                .httpBasic(basico -> basico.disable())
                .logout(saida -> saida.disable());
        InMemoryClientRegistrationRepository registros = provedores.repositorio();
        if (registros != null) {
            // PKCE também com o segredo do cliente (RFC 9700): um código de autorização roubado no caminho não serve.
            DefaultOAuth2AuthorizationRequestResolver comPkce = new DefaultOAuth2AuthorizationRequestResolver(registros,
                    OAuth2AuthorizationRequestRedirectFilter.DEFAULT_AUTHORIZATION_REQUEST_BASE_URI);
            comPkce.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
            http.oauth2Login(login -> login
                    .clientRegistrationRepository(registros)
                    .authorizationEndpoint(ida -> ida.authorizationRequestResolver(comPkce))
                    .loginPage("/")
                    .successHandler(aoEntrar)
                    .failureHandler(aoEntrar));
        }
        return http.build();
    }
}
