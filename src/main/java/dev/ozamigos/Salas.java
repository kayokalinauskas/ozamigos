package dev.ozamigos;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

/**
 * Guarda as salas em memória. Todos os métodos são synchronized: duas pessoas clicando
 * ao mesmo tempo nunca veem a sala pela metade.
 */
@Component
public class Salas {

    public static final int LIMITE_POR_SALA = 3;

    /** O que quem acabou de entrar precisa saber: quem já está (id -> nome) e quem está compartilhando. */
    public record Entrada(Map<String, String> outros, List<String> compartilhando) {}

    /** O que sobrou depois que alguém saiu. */
    public record Saida(List<WebSocketSession> restantes, boolean estavaCompartilhando) {}

    private static final class Sala {
        final Map<String, WebSocketSession> participantes = new LinkedHashMap<>();
        final Map<String, String> nomes = new HashMap<>();
        final Set<String> compartilhando = new LinkedHashSet<>();
    }

    private final Map<String, Sala> salas = new HashMap<>();

    /** Devolve null se a sala estiver cheia. */
    public synchronized Entrada entrar(String codigo, String id, String nome, WebSocketSession sessao) {
        Sala sala = salas.computeIfAbsent(codigo, c -> new Sala());
        if (sala.participantes.size() >= LIMITE_POR_SALA) {
            return null;
        }
        Map<String, String> outros = new LinkedHashMap<>();
        sala.participantes.keySet().forEach(outroId -> outros.put(outroId, sala.nomes.get(outroId)));
        sala.participantes.put(id, sessao);
        sala.nomes.put(id, nome);
        return new Entrada(outros, List.copyOf(sala.compartilhando));
    }

    public synchronized Saida sair(String codigo, String id) {
        Sala sala = salas.get(codigo);
        if (sala == null || !sala.participantes.containsKey(id)) {
            return new Saida(List.of(), false);
        }
        sala.participantes.remove(id);
        sala.nomes.remove(id);
        boolean estavaCompartilhando = sala.compartilhando.remove(id);
        if (sala.participantes.isEmpty()) {
            salas.remove(codigo);
        }
        return new Saida(new ArrayList<>(sala.participantes.values()), estavaCompartilhando);
    }

    /** Todos podem compartilhar ao mesmo tempo. Devolve false se a pessoa não está na sala ou já compartilha. */
    public synchronized boolean comecarACompartilhar(String codigo, String id) {
        Sala sala = salas.get(codigo);
        if (sala == null || !sala.participantes.containsKey(id)) {
            return false;
        }
        return sala.compartilhando.add(id);
    }

    public synchronized boolean pararDeCompartilhar(String codigo, String id) {
        Sala sala = salas.get(codigo);
        return sala != null && sala.compartilhando.remove(id);
    }

    /** A sessão de alguém da mesma sala, ou null se a pessoa não estiver lá. */
    public synchronized WebSocketSession sessao(String codigo, String id) {
        Sala sala = salas.get(codigo);
        return sala == null ? null : sala.participantes.get(id);
    }

    public synchronized List<WebSocketSession> outros(String codigo, String id) {
        Sala sala = salas.get(codigo);
        if (sala == null) {
            return List.of();
        }
        List<WebSocketSession> outros = new ArrayList<>();
        sala.participantes.forEach((outroId, sessao) -> {
            if (!outroId.equals(id)) {
                outros.add(sessao);
            }
        });
        return outros;
    }
}
