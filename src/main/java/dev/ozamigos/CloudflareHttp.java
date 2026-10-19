package dev.ozamigos;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * A Retransmissao.Cloudflare de verdade: gera e cancela credenciais do TURN e lê o consumo pela API de estatísticas
 * (GraphQL, com um token só de leitura). Os tokens nunca vão para o log nem para as mensagens de erro.
 */
final class CloudflareHttp implements Retransmissao.Cloudflare {

    private static final String TURN = "https://rtc.live.cloudflare.com/v1/turn/keys/";
    private static final URI GRAPHQL = URI.create("https://api.cloudflare.com/client/v4/graphql");
    private static final Pattern USUARIO = Pattern.compile("[A-Za-z0-9._-]{1,200}");
    /** O navegador recusa a porta 53: com ela na lista, a conexão esperaria o prazo dela à toa. */
    private static final Pattern PORTA_53 = Pattern.compile(":53(\\?|$)");
    private static final String CONSULTA = """
            query($conta: string!, $desde: Date!, $hoje: Date!) {
              viewer {
                accounts(filter: {accountTag: $conta}) {
                  periodo: callsTurnUsageAdaptiveGroups(limit: 10000, filter: {date_geq: $desde}) {
                    sum { egressBytes }
                  }
                  hoje: callsTurnUsageAdaptiveGroups(limit: 10000, filter: {date_geq: $hoje}) {
                    dimensions { username }
                    sum { egressBytes }
                  }
                }
              }
            }""";

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
    private final JsonMapper json;
    private final String id;
    private final String token;
    private final String conta;
    private final String leitura;

    CloudflareHttp(JsonMapper json, String id, String token, String conta, String leitura) {
        this.json = json;
        this.id = id;
        this.token = token;
        this.conta = conta;
        this.leitura = leitura;
    }

    @Override
    public Credencial gerar(Duration validade) throws IOException, InterruptedException {
        JsonNode resposta = pedir(URI.create(TURN + id + "/credentials/generate-ice-servers"), token,
                json.createObjectNode().put("ttl", validade.toSeconds()), "gerar");
        ArrayNode servidores = json.createArrayNode();
        String usuario = null;
        for (JsonNode servidor : resposta.path("iceServers")) {
            if (!servidor.hasNonNull("username")) {
                continue; // o STUN deles: a página já tem
            }
            usuario = servidor.path("username").asString("");
            ObjectNode limpo = servidores.addObject();
            ArrayNode urls = limpo.putArray("urls");
            for (JsonNode url : servidor.path("urls")) {
                if (!PORTA_53.matcher(url.asString("")).find()) {
                    urls.add(url.asString(""));
                }
            }
            limpo.put("username", usuario).put("credential", servidor.path("credential").asString(""));
        }
        if (usuario == null || !USUARIO.matcher(usuario).matches()) {
            throw new IOException("a Cloudflare não mandou uma credencial");
        }
        return new Credencial(usuario, servidores);
    }

    @Override
    public void revogar(String usuario) throws IOException, InterruptedException {
        if (!USUARIO.matcher(usuario).matches()) {
            return;
        }
        HttpRequest pedido = HttpRequest.newBuilder(URI.create(TURN + id + "/credentials/" + usuario + "/revoke"))
                .timeout(Duration.ofSeconds(6))
                .header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.noBody())
                .build();
        int status = http.send(pedido, HttpResponse.BodyHandlers.discarding()).statusCode();
        if (status / 100 != 2 && status != 404) {
            throw new IOException("cancelar respondeu " + status);
        }
    }

    @Override
    public Consumo consumo(LocalDate desde, LocalDate hoje) throws IOException, InterruptedException {
        ObjectNode corpo = json.createObjectNode().put("query", CONSULTA);
        corpo.putObject("variables").put("conta", conta).put("desde", desde.toString()).put("hoje", hoje.toString());
        JsonNode resposta = pedir(GRAPHQL, leitura, corpo, "consumo");
        JsonNode erros = resposta.path("errors");
        if (erros.isArray() && !erros.isEmpty()) {
            throw new IOException("a consulta do consumo falhou: " + erros.path(0).path("message").asString("?"));
        }
        JsonNode contas = resposta.path("data").path("viewer").path("accounts");
        if (!contas.isArray() || contas.isEmpty()) {
            throw new IOException("a consulta do consumo não trouxe a conta");
        }
        long periodo = 0;
        for (JsonNode grupo : contas.path(0).path("periodo")) {
            periodo += grupo.path("sum").path("egressBytes").asLong(0);
        }
        Map<String, Long> hojePorUsuario = new HashMap<>();
        for (JsonNode grupo : contas.path(0).path("hoje")) {
            hojePorUsuario.merge(grupo.path("dimensions").path("username").asString(""), grupo.path("sum").path("egressBytes").asLong(0), Long::sum);
        }
        return new Consumo(periodo, hojePorUsuario);
    }

    private JsonNode pedir(URI endereco, String chave, JsonNode corpo, String oQue) throws IOException, InterruptedException {
        HttpRequest pedido = HttpRequest.newBuilder(endereco)
                .timeout(Duration.ofSeconds(6))
                .header("Authorization", "Bearer " + chave)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(corpo)))
                .build();
        HttpResponse<String> resposta = http.send(pedido, HttpResponse.BodyHandlers.ofString());
        if (resposta.statusCode() / 100 != 2) {
            throw new IOException(oQue + " respondeu " + resposta.statusCode());
        }
        try {
            return json.readTree(resposta.body());
        } catch (JacksonException e) {
            throw new IOException(oQue + " não respondeu JSON");
        }
    }
}
