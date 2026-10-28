package dev.ozamigos;

import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.config.oauth2.client.CommonOAuth2Provider;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * O Google e o Discord, para o login (docs/plano-contas.md, fase 1). Cada um só existe com o id e o segredo do cliente
 * OAuth nas variáveis de ambiente; sem nenhum, não há login e todos entram como convidados, como antes.
 *
 * <p>Os escopos pedem o mínimo: {@code openid profile} no Google e {@code identify} no Discord. <b>Nenhum dos dois traz o
 * e-mail</b>, de propósito: o Ozamigos não precisa dele.
 *
 * <p>{@code OZAMIGOS_GOOGLE_EMISSOR} troca o Google por outro emissor OpenID Connect com os mesmos caminhos do
 * mock-oauth2-server ({@code /authorize}, {@code /token}, {@code /jwks}, {@code /userinfo}): é como os testes de ponta a
 * ponta e o desenvolvimento local fazem o login inteiro sem o Google. Não é uma porta dos fundos: sem a variável, só
 * vale o Google de verdade, e com ela o login continua sendo o fluxo OAuth completo, com o token assinado conferido.
 */
@Component
public class ProvedoresDeLogin {

    private static final Logger log = LoggerFactory.getLogger(ProvedoresDeLogin.class);

    /** O endereço de volta de cada provedor, o que se cadastra no Google e no Discord. */
    static final String VOLTA = "{baseUrl}/login/oauth2/code/{registrationId}";

    private final List<ClientRegistration> registros = new ArrayList<>();

    public ProvedoresDeLogin(@Value("${ozamigos.google.id:}") String googleId,
            @Value("${ozamigos.google.segredo:}") String googleSegredo,
            @Value("${ozamigos.google.emissor:}") String googleEmissor,
            @Value("${ozamigos.discord.id:}") String discordId,
            @Value("${ozamigos.discord.segredo:}") String discordSegredo) {
        if (StringUtils.hasText(googleId) && StringUtils.hasText(googleSegredo)) {
            registros.add(StringUtils.hasText(googleEmissor)
                    ? emissorDeTeste(googleId, googleSegredo, googleEmissor)
                    : CommonOAuth2Provider.GOOGLE.getBuilder("google")
                            .clientId(googleId).clientSecret(googleSegredo)
                            .redirectUri(VOLTA)
                            .scope("openid", "profile")
                            .build());
        }
        if (StringUtils.hasText(discordId) && StringUtils.hasText(discordSegredo)) {
            registros.add(ClientRegistration.withRegistrationId("discord")
                    .clientId(discordId).clientSecret(discordSegredo)
                    .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                    .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                    .redirectUri(VOLTA)
                    .scope("identify")
                    .authorizationUri("https://discord.com/oauth2/authorize")
                    .tokenUri("https://discord.com/api/oauth2/token")
                    .userInfoUri("https://discord.com/api/users/@me")
                    .userNameAttributeName("id")
                    .clientName("Discord")
                    .build());
        }
        log.info("Login: {}", registros.isEmpty() ? "desligado (faltam as variáveis OZAMIGOS_GOOGLE_* e OZAMIGOS_DISCORD_*)"
                : String.join(", ", disponiveis()) + (StringUtils.hasText(googleEmissor) ? " (Google de teste)" : ""));
    }

    private static ClientRegistration emissorDeTeste(String id, String segredo, String emissor) {
        String base = emissor.endsWith("/") ? emissor.substring(0, emissor.length() - 1) : emissor;
        return ClientRegistration.withRegistrationId("google")
                .clientId(id).clientSecret(segredo)
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri(VOLTA)
                .scope("openid", "profile")
                .issuerUri(base)
                .authorizationUri(base + "/authorize")
                .tokenUri(base + "/token")
                .jwkSetUri(base + "/jwks")
                .userInfoUri(base + "/userinfo")
                .userNameAttributeName("sub")
                .clientName("Google")
                .build();
    }

    /** Os provedores configurados ("google", "discord"), na ordem em que aparecem na entrada. */
    public List<String> disponiveis() {
        return registros.stream().map(ClientRegistration::getRegistrationId).toList();
    }

    public boolean existe(String provedor) {
        return disponiveis().contains(provedor);
    }

    /** Null sem nenhum provedor: a SegurancaConfig nem liga o login. */
    InMemoryClientRegistrationRepository repositorio() {
        return registros.isEmpty() ? null : new InMemoryClientRegistrationRepository(registros);
    }
}
