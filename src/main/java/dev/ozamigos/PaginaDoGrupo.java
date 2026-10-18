package dev.ozamigos;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.server.ResponseStatusException;

/**
 * O endereço de um grupo ({@code /nome}) abre a interface, que lê o nome do caminho (Grupos). Arquivos têm ponto no
 * nome e não casam com o padrão. Os caminhos do próprio servidor ficam de fora do padrão, não só da lista de
 * reservados: este controlador vem antes do WebSocket na ordem do Spring, e pegaria o {@code /sinal}.
 */
@Controller
public class PaginaDoGrupo {

    @GetMapping("/{nome:(?!(?:sinal|actuator|assets)$)[a-z0-9][a-z0-9-]{1,30}[a-z0-9]}")
    public String grupo(@PathVariable String nome) {
        // /ozamigos é o grupo fixo (a senha OZAMIGOS_SENHA), com uma sala só: a de código "ozamigos". A interface sabe.
        if (!nome.equals("ozamigos") && !Grupos.nomeValido(nome)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return "forward:/index.html";
    }
}
