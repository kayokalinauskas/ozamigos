package dev.ozamigos;

import java.io.IOException;
import java.util.Map;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

/**
 * A volta do Google ou do Discord. O Spring Security já conferiu tudo (estado, PKCE, o token assinado do Google); aqui
 * a pessoa vira um usuário do Ozamigos (Contas), e então:
 * <ul>
 * <li>no navegador, ganha o cookie da sessão (Sessoes) e volta para onde estava;</li>
 * <li>no app, o navegador vai para a porta local do app com um código de uso único (CodigosDoApp);</li>
 * <li>ligando mais um provedor, ele entra na conta de quem já estava logado.</li>
 * </ul>
 * A sessão HTTP do login (com o token de acesso do provedor dentro) é descartada no fim: o Ozamigos não guarda token
 * nenhum do Google ou do Discord.
 */
@Component
public class AoEntrar implements AuthenticationSuccessHandler, AuthenticationFailureHandler {

    private static final Logger log = LoggerFactory.getLogger(AoEntrar.class);
    /** A foto do Google vem com o tamanho no fim ({@code =s96-c}): pede uma maior, que a redução afina. */
    private static final Pattern TAMANHO_DA_FOTO_DO_GOOGLE = Pattern.compile("=s\\d+-c$");

    private final Contas contas;
    private final Sessoes sessoes;
    private final FotosDoPerfil fotos;
    private final CodigosDoApp codigos;

    public AoEntrar(Contas contas, Sessoes sessoes, FotosDoPerfil fotos, CodigosDoApp codigos) {
        this.contas = contas;
        this.sessoes = sessoes;
        this.fotos = fotos;
        this.codigos = codigos;
    }

    /** Quem o provedor diz que a pessoa é: o id da conta lá, o nome para a sala e o endereço da foto (ou null). */
    record Perfil(String idExterno, String nome, String foto) {}

    @Override
    public void onAuthenticationSuccess(HttpServletRequest pedido, HttpServletResponse resposta, Authentication autenticacao)
            throws IOException {
        Login.Pedido login = pedidoDoLogin(pedido);
        try {
            concluir(resposta, login, (OAuth2AuthenticationToken) autenticacao);
        } catch (DataAccessException erro) {
            // O banco caiu no meio do login: a pessoa volta para a entrada com o aviso, em vez de uma página de erro.
            log.warn("Login: o banco não respondeu ({})", erro.getMostSpecificCause().getMessage());
            falhar(resposta, login, "indisponivel");
        }
    }

    private void concluir(HttpServletResponse resposta, Login.Pedido login, OAuth2AuthenticationToken token) throws IOException {
        String provedor = token.getAuthorizedClientRegistrationId();
        Perfil perfil = perfil(provedor, token.getPrincipal());
        if (perfil == null || !contas.disponivel()) {
            falhar(resposta, login, "indisponivel");
            return;
        }

        if (login.ligarA() != null) {
            String resultado = switch (contas.ligar(login.ligarA(), provedor, perfil.idExterno())) {
                case LIGADA, JA_ERA_SUA -> null;
                case DE_OUTRA_PESSOA -> "de-outra-pessoa";
                case JA_TEM_DESSE_PROVEDOR -> "ja-tem-desse-provedor";
            };
            if (resultado != null) {
                falhar(resposta, login, resultado);
                return;
            }
            log.info("Conta {} ligou o {}", login.ligarA(), provedor);
            resposta.sendRedirect(login.portaDoApp() != null
                    ? Login.voltaDoApp(login.portaDoApp(), login.estado(), "ligou", provedor)
                    : login.voltar());
            return;
        }

        Contas.Entrada entrada = contas.entrar(provedor, perfil.idExterno(), perfil.nome());
        fotos.atualizar(entrada.id(), perfil.foto(), entrada.fotoOrigem());
        if (login.portaDoApp() != null) {
            log.info("Conta {} entrou pelo {} (app)", entrada.id(), provedor);
            resposta.sendRedirect(Login.voltaDoApp(login.portaDoApp(), login.estado(), "codigo", codigos.criar(entrada.id(), CodigosDoApp.Uso.LOGIN)));
        } else {
            log.info("Conta {} entrou pelo {}", entrada.id(), provedor);
            resposta.addHeader(HttpHeaders.SET_COOKIE, Sessoes.cookie(sessoes.criar(entrada.id(), "navegador")).toString());
            resposta.sendRedirect(login.voltar());
        }
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest pedido, HttpServletResponse resposta, AuthenticationException erro)
            throws IOException {
        // A pessoa recusou na tela do provedor, ou o login expirou: o motivo do Spring vai para o log, sem dados dela.
        log.info("Login recusado: {}", erro.getClass().getSimpleName());
        falhar(resposta, pedidoDoLogin(pedido), "recusado");
    }

    private static void falhar(HttpServletResponse resposta, Login.Pedido login, String motivo) throws IOException {
        resposta.sendRedirect(login.portaDoApp() != null
                ? Login.voltaDoApp(login.portaDoApp(), login.estado(), "erro", motivo)
                : Login.comErro(login.voltar(), motivo));
    }

    /** O pedido guardado no começo (Login); sem ele (a sessão do login venceu), volta para a entrada. A sessão sai. */
    private static Login.Pedido pedidoDoLogin(HttpServletRequest pedido) {
        HttpSession sessao = pedido.getSession(false);
        Login.Pedido login = null;
        if (sessao != null) {
            login = (Login.Pedido) sessao.getAttribute(Login.PEDIDO);
            sessao.invalidate();
        }
        return login != null ? login : new Login.Pedido("/", null, null, null);
    }

    /** O perfil de cada provedor, ou null se faltar o id (resposta estranha do provedor). */
    static Perfil perfil(String provedor, OAuth2User usuario) {
        Map<String, Object> dados = usuario.getAttributes();
        return switch (provedor) {
            case "google" -> {
                String foto = texto(dados, "picture");
                yield new Perfil(usuario.getName(), primeiro(texto(dados, "given_name"), texto(dados, "name")),
                        foto == null ? null : TAMANHO_DA_FOTO_DO_GOOGLE.matcher(foto).replaceFirst("=s256-c"));
            }
            case "discord" -> {
                String id = texto(dados, "id");
                String avatar = texto(dados, "avatar");
                yield id == null ? null : new Perfil(id, primeiro(texto(dados, "global_name"), texto(dados, "username")),
                        avatar == null || !avatar.matches("[A-Za-z0-9_]{1,64}") ? null
                                : "https://cdn.discordapp.com/avatars/" + id + "/" + avatar + ".png?size=256");
            }
            default -> null;
        };
    }

    private static String texto(Map<String, Object> dados, String campo) {
        Object valor = dados.get(campo);
        return valor instanceof String s && !s.isBlank() ? s : null;
    }

    private static String primeiro(String a, String b) {
        return a != null ? a : b != null ? b : "Amigo";
    }
}
