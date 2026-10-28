package dev.ozamigos;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

/**
 * Os endereços que abrem a interface, além da raiz: um servidor salvo ({@code /s/<codigo>}) e um convite
 * ({@code /c/<codigo>}). Quem confere se a pessoa é membro, ou se o convite vale, é a API (ServidoresApi), pedida pela
 * página.
 *
 * <p>Os endereços de antes das contas (o grupo fixo {@code /ozamigos} e os grupos criados na hora, {@code /nome}) levam
 * à entrada: as salas com senha saíram (decisão do dono, 28/10/2026), mas um link antigo não dá erro. Os caminhos do
 * próprio servidor ficam de fora do padrão: este controlador vem antes do WebSocket na ordem do Spring, e pegaria o
 * {@code /sinal}. Arquivos têm ponto no nome e não casam.
 */
@Controller
public class PaginasDoApp {

    @GetMapping({"/s/{codigo:[A-Za-z0-9]{10}}", "/c/{codigo:[A-Za-z0-9]{10}}"})
    public String servidorOuConvite(@PathVariable String codigo) {
        return "forward:/index.html";
    }

    /** O painel do dono: a página abre para qualquer um, e a API (PainelApi) só responde ao dono. */
    @GetMapping("/painel")
    public String painel() {
        return "forward:/index.html";
    }

    @GetMapping("/{antigo:(?!(?:sinal|actuator|assets|marcas|api|conta|login|oauth2|error|painel)$)[a-z0-9][a-z0-9-]{1,30}[a-z0-9]}")
    public String grupoDeAntes(@PathVariable String antigo) {
        return "redirect:/";
    }
}
