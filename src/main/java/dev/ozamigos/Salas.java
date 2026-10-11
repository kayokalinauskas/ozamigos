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
 *
 * <p>Quem transmite só manda vídeo para quem pediu para assistir (a "plateia" dele):
 * isso economiza o upload e a placa de vídeo de quem transmite.
 */
@Component
public class Salas {

    public static final int LIMITE_POR_SALA = 5;

    /**
     * O que quem acabou de entrar precisa saber: quem já está (id -> nome),
     * quem está transmitindo e quem assiste cada transmissão.
     */
    public record Entrada(Map<String, String> outros, List<String> compartilhando, Map<String, List<String>> plateias) {}

    /** O que sobrou depois que alguém saiu, e as plateias que mudaram por causa disso. */
    public record Saida(List<WebSocketSession> restantes, Map<String, List<String>> plateiasQueMudaram) {}

    private static final class Sala {
        final Map<String, WebSocketSession> participantes = new LinkedHashMap<>();
        final Map<String, String> nomes = new HashMap<>();
        /** Quem transmite -> quem está assistindo (só existe enquanto a pessoa transmite). */
        final Map<String, Set<String>> plateias = new LinkedHashMap<>();
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
        Map<String, List<String>> plateias = new LinkedHashMap<>();
        sala.plateias.forEach((quem, plateia) -> plateias.put(quem, List.copyOf(plateia)));
        return new Entrada(outros, List.copyOf(sala.plateias.keySet()), plateias);
    }

    public synchronized Saida sair(String codigo, String id) {
        Sala sala = salas.get(codigo);
        if (sala == null || !sala.participantes.containsKey(id)) {
            return new Saida(List.of(), Map.of());
        }
        sala.participantes.remove(id);
        sala.nomes.remove(id);
        sala.plateias.remove(id); // quem sai para de transmitir; o "saiu" já avisa os outros
        Map<String, List<String>> mudaram = new LinkedHashMap<>();
        sala.plateias.forEach((quem, plateia) -> {
            if (plateia.remove(id)) {
                mudaram.put(quem, List.copyOf(plateia));
            }
        });
        if (sala.participantes.isEmpty()) {
            salas.remove(codigo);
        }
        return new Saida(new ArrayList<>(sala.participantes.values()), mudaram);
    }

    /** Todos podem transmitir ao mesmo tempo. Devolve false se a pessoa não está na sala ou já transmite. */
    public synchronized boolean comecarACompartilhar(String codigo, String id) {
        Sala sala = salas.get(codigo);
        if (sala == null || !sala.participantes.containsKey(id) || sala.plateias.containsKey(id)) {
            return false;
        }
        sala.plateias.put(id, new LinkedHashSet<>());
        return true;
    }

    /** Parar de transmitir também esvazia a plateia: a próxima transmissão começa do zero. */
    public synchronized boolean pararDeCompartilhar(String codigo, String id) {
        Sala sala = salas.get(codigo);
        return sala != null && sala.plateias.remove(id) != null;
    }

    /**
     * Põe {@code quem} na plateia de {@code alvo}. Devolve a plateia nova, ou null se não fizer sentido
     * (alvo não transmite, alguém não está na sala, assistir a si mesmo ou já estava assistindo).
     */
    public synchronized List<String> assistir(String codigo, String quem, String alvo) {
        Sala sala = salas.get(codigo);
        if (sala == null || quem.equals(alvo) || !sala.participantes.containsKey(quem)) {
            return null;
        }
        Set<String> plateia = sala.plateias.get(alvo);
        if (plateia == null || !plateia.add(quem)) {
            return null;
        }
        return List.copyOf(plateia);
    }

    /** Tira {@code quem} da plateia de {@code alvo}. Devolve a plateia nova, ou null se nada mudou. */
    public synchronized List<String> deixarDeAssistir(String codigo, String quem, String alvo) {
        Sala sala = salas.get(codigo);
        Set<String> plateia = sala == null ? null : sala.plateias.get(alvo);
        if (plateia == null || !plateia.remove(quem)) {
            return null;
        }
        return List.copyOf(plateia);
    }

    /** A sessão de alguém da mesma sala, ou null se a pessoa não estiver lá. */
    public synchronized WebSocketSession sessao(String codigo, String id) {
        Sala sala = salas.get(codigo);
        return sala == null ? null : sala.participantes.get(id);
    }

    /** Todo mundo da sala, inclusive quem pediu. */
    public synchronized List<WebSocketSession> todos(String codigo) {
        Sala sala = salas.get(codigo);
        return sala == null ? List.of() : new ArrayList<>(sala.participantes.values());
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
