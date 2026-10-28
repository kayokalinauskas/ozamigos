package dev.ozamigos;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
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

    public static final int LIMITE_POR_SALA = 8;

    /**
     * A conta de quem entrou com uma (null: convidado): o id, que a página usa para reconhecer a pessoa (volume, volta
     * depois de uma queda), e o endereço da foto, ou null sem foto.
     */
    public record Conta(String id, String foto) {}

    /** Quem está na sala, como os outros veem. */
    public record Pessoa(String nome, Conta conta) {}

    /**
     * O que quem acabou de entrar precisa saber: quem já está (id -> pessoa),
     * quem está transmitindo, quem assiste cada transmissão e quem está gravando as estatísticas (ou null).
     * {@code avisar} são as conexões de quem já estava, as que recebem o "entrou": tiradas junto com {@code outros},
     * para quem entra ao mesmo tempo não receber a mesma pessoa duas vezes (na lista do "bem-vindo" e num "entrou").
     */
    public record Entrada(Map<String, Pessoa> outros, List<String> compartilhando, Map<String, List<String>> plateias,
            String gravador, List<WebSocketSession> avisar) {}

    /**
     * O que sobrou depois que alguém saiu, as plateias que mudaram por causa disso e se a gravação
     * das estatísticas acabou (quem saiu era quem gravava).
     */
    public record Saida(List<WebSocketSession> restantes, Map<String, List<String>> plateiasQueMudaram,
            boolean gravacaoAcabou) {}

    private static final class Sala {
        final Map<String, WebSocketSession> participantes = new LinkedHashMap<>();
        final Map<String, String> nomes = new HashMap<>();
        final Map<String, Conta> contas = new HashMap<>();
        /** A ficha de cada pessoa: só ela sabe, e é o que prova que é ela voltando depois de uma queda. */
        final Map<String, String> fichas = new HashMap<>();
        /** Quem transmite -> quem está assistindo (só existe enquanto a pessoa transmite). */
        final Map<String, Set<String>> plateias = new LinkedHashMap<>();
        /** Quem está gravando as estatísticas da sala: as medidas de todos vão para essa pessoa. */
        String gravador;
    }

    private final Map<String, Sala> salas = new HashMap<>();

    /** Devolve null se a sala estiver cheia. */
    public synchronized Entrada entrar(String codigo, String id, String nome, Conta conta, String ficha, WebSocketSession sessao) {
        Sala sala = salas.computeIfAbsent(codigo, c -> new Sala());
        if (sala.participantes.size() >= LIMITE_POR_SALA) {
            return null;
        }
        Map<String, Pessoa> outros = new LinkedHashMap<>();
        sala.participantes.keySet().forEach(outroId -> outros.put(outroId, new Pessoa(sala.nomes.get(outroId), sala.contas.get(outroId))));
        List<WebSocketSession> avisar = new ArrayList<>(sala.participantes.values());
        sala.participantes.put(id, sessao);
        sala.nomes.put(id, nome);
        if (conta != null) {
            sala.contas.put(id, conta);
        }
        sala.fichas.put(id, ficha);
        Map<String, List<String>> plateias = new LinkedHashMap<>();
        sala.plateias.forEach((quem, plateia) -> plateias.put(quem, List.copyOf(plateia)));
        return new Entrada(outros, List.copyOf(sala.plateias.keySet()), plateias, sala.gravador, avisar);
    }

    /** Devolve null se a pessoa já não estava na sala (por exemplo, já tirada numa reconexão). */
    public synchronized Saida sair(String codigo, String id) {
        Sala sala = salas.get(codigo);
        if (sala == null || !sala.participantes.containsKey(id)) {
            return null;
        }
        sala.participantes.remove(id);
        sala.nomes.remove(id);
        sala.contas.remove(id);
        sala.fichas.remove(id);
        sala.plateias.remove(id); // quem sai para de transmitir; o "saiu" já avisa os outros
        boolean gravacaoAcabou = id.equals(sala.gravador);
        if (gravacaoAcabou) {
            sala.gravador = null;
        }
        Map<String, List<String>> mudaram = new LinkedHashMap<>();
        sala.plateias.forEach((quem, plateia) -> {
            if (plateia.remove(id)) {
                mudaram.put(quem, List.copyOf(plateia));
            }
        });
        if (sala.participantes.isEmpty()) {
            salas.remove(codigo);
        }
        return new Saida(new ArrayList<>(sala.participantes.values()), mudaram, gravacaoAcabou);
    }

    /**
     * Quem na sala tem esta ficha, ou null. Serve para a reconexão: a conexão antiga de quem caiu
     * pode continuar "aberta" no servidor por um tempo, ocupando lugar como uma pessoa fantasma.
     */
    public synchronized String donoDaFicha(String codigo, String ficha) {
        Sala sala = salas.get(codigo);
        if (sala == null || ficha.isEmpty()) {
            return null;
        }
        byte[] procurada = ficha.getBytes(StandardCharsets.UTF_8);
        for (Map.Entry<String, String> entrada : sala.fichas.entrySet()) {
            if (MessageDigest.isEqual(procurada, entrada.getValue().getBytes(StandardCharsets.UTF_8))) {
                return entrada.getKey();
            }
        }
        return null;
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

    /**
     * Começa a gravar as estatísticas da sala. Uma gravação por vez: devolve false se outra pessoa
     * já está gravando (ou se quem pediu não está na sala). Pedir de novo quem já grava não muda nada.
     */
    public synchronized boolean comecarAGravar(String codigo, String id) {
        Sala sala = salas.get(codigo);
        if (sala == null || !sala.participantes.containsKey(id)) {
            return false;
        }
        if (sala.gravador != null && !sala.gravador.equals(id)) {
            return false;
        }
        sala.gravador = id;
        return true;
    }

    /** Só quem grava pode parar. Devolve true se a gravação acabou agora. */
    public synchronized boolean pararDeGravar(String codigo, String id) {
        Sala sala = salas.get(codigo);
        if (sala == null || !id.equals(sala.gravador)) {
            return false;
        }
        sala.gravador = null;
        return true;
    }

    /** Quem está gravando as estatísticas da sala, ou null. */
    public synchronized String gravador(String codigo) {
        Sala sala = salas.get(codigo);
        return sala == null ? null : sala.gravador;
    }

    /** O nome de alguém da sala, ou null. */
    public synchronized String nome(String codigo, String id) {
        Sala sala = salas.get(codigo);
        return sala == null ? null : sala.nomes.get(id);
    }

    /** A sessão de alguém da mesma sala, ou null se a pessoa não estiver lá. */
    public synchronized WebSocketSession sessao(String codigo, String id) {
        Sala sala = salas.get(codigo);
        return sala == null ? null : sala.participantes.get(id);
    }

    /** As conexões de uma conta na sala (às vezes mais de uma: o app e o navegador); com {@code conta} null, todas. */
    public synchronized List<WebSocketSession> daConta(String codigo, String conta) {
        Sala sala = salas.get(codigo);
        if (sala == null) {
            return List.of();
        }
        List<WebSocketSession> achadas = new ArrayList<>();
        sala.participantes.forEach((id, sessao) -> {
            Conta dela = sala.contas.get(id);
            if (conta == null || (dela != null && dela.id().equals(conta))) {
                achadas.add(sessao);
            }
        });
        return achadas;
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
