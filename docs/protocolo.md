# Protocolo de sinalização

WebSocket em `/sinal`, com mensagens JSON que têm sempre o campo `tipo`. O servidor carimba o remetente (`de`) em tudo o que repassa; o cliente nunca informa quem ele é. Os tipos de cada mensagem estão em [`web/src/conexao/protocolo.ts`](../web/src/conexao/protocolo.ts).

**Cliente → servidor**

| `tipo` | Campos | Efeito |
|---|---|---|
| `entrar` | `sala`, `senha`, `nome`, `ficha` (opcional), `grupo` e `criar` (opcionais) | Confere a senha e entra na sala. Na reconexão, a `ficha` recebida no `bem-vindo` anterior tira da sala a conexão antiga, se o servidor ainda não percebeu a queda. Com `grupo`, é um grupo criado na hora (`Grupos.java`): a senha é a dele, a sala é a única do grupo (`sala` vai vazia), e `criar: true` o cria se não existe (o cliente manda `criar` também ao reconectar, para o grupo voltar se o servidor reiniciou) |
| `comecei` / `parei` | — | Começa ou para de transmitir |
| `assistir` / `deixar` | `para` | Entra ou sai da plateia de quem transmite |
| `oferta` / `resposta` / `candidato` | `para`, `sdp` ou `candidato`, `canal` (`envio`, `recebimento` ou `voz`) | Repassado só ao destinatário, na mesma sala |
| `ping` | — | Mantém a conexão viva (a cada 30 s); o servidor responde `pong` |
| `gravar-sala` | `ligada` | Começa ou para a gravação das estatísticas da sala (uma por vez; só quem grava para) |
| `medidas` | `pacote` | As medidas deste segundo, entregues só a quem grava a sala (sem gravação, o servidor descarta) |
| `chat` | `texto` | Uma mensagem para a sala (até 500 caracteres; no máximo 5 a cada 3 s por pessoa) |
| `chamar` | `para` | Chama a atenção de alguém da sala (até 5 vezes por minuto para cada pessoa chamada) |

**Servidor → cliente**

| `tipo` | Campos | Quando |
|---|---|---|
| `bem-vindo` | `id`, `ficha`, `outros[]`, `compartilhando[]`, `plateias{}`, `gravando` (`id`, `nome`, se alguém grava a sala), `retransmissao[]` e `retransmissaoDaVoz[]` (os `iceServers` do TURN para o vídeo e para a voz, se ligada e dentro dos limites; a página de antes usa a do vídeo para tudo), `limiteDoVideo` (`seu` ou `geral`, se o vídeo veio sem por um limite) | Ao entrar. A `ficha` é secreta: só quem a recebeu pode usá-la para reconectar |
| `retransmissao` | `servidores[]` (vídeo), `voz[]`, `limiteDoVideo`? | As credenciais do TURN que valem agora: renovadas (a cada 6 h), dadas depois da entrada, ou a lista vazia de um uso cortado por um limite de consumo. `limiteDoVideo`: `seu` (esta pessoa passou do limite de vídeo do dia; a página avisa que foi o uso dela) ou `geral` (o total de todos) |
| `pong` | — | Resposta ao `ping`. Sem nenhuma mensagem por 70 s, o cliente considera a conexão morta e reconecta |
| `entrou` / `saiu` | `id` (e `nome`) | Alguém entrou ou saiu |
| `pode-compartilhar` | — | Confirma o `comecei` |
| `compartilhando` / `parou` | `id` | Alguém começou ou parou de transmitir |
| `plateia` | `id`, `ids[]` | Mudou quem assiste uma transmissão |
| `assistir` / `deixar` | `de` | (para quem transmite) alguém quer assistir ou desistiu |
| `oferta` / `resposta` / `candidato` | `de`, ... | Repasse do WebRTC |
| `gravacao-da-sala` | `ligada`, `id`, `nome` | Alguém começou ou parou de gravar as estatísticas da sala (ou saiu da sala gravando) |
| `medidas` | `de`, `pacote` | (para quem grava a sala) as medidas de um segundo de outra pessoa |
| `chat` | `de`, `texto` | Uma mensagem do chat, para todos da sala (inclusive quem mandou, que assim sabe que chegou). O servidor não guarda nada: quem entra depois não vê as anteriores |
| `previa` | `url`, `site`, `titulo`?, `autor`?, `miniatura`?, `aoVivo`? | A prévia do primeiro link de vídeo ou de canal de uma mensagem do chat (`aoVivo` num canal transmitindo agora), para todos da sala, logo depois da mensagem. O servidor busca no site e guarda na memória por 1 hora; a `miniatura` é um JPEG pequeno embutido (`data:`) |
| `chamado` | `de` | Alguém chamou a sua atenção: a página toca um som mesmo com os sons desligados |
| `erro` | `motivo` | `senha-errada`, `muitas-tentativas`, `sala-cheia`, `codigo-invalido`, `ja-esta-numa-sala`, `destinatario-nao-esta-na-sala`, `sala-ja-gravando`, `chat-rapido-demais`, `chamar-cedo-demais`, `mensagem-invalida`; dos grupos: `grupo-nao-existe`, `grupo-em-uso` (criar com um nome que existe, com outra senha), `grupo-invalido`, `senha-curta` (menos de 4 caracteres), `muitos-grupos` (3 criados pelo mesmo endereço em 10 minutos), `grupos-demais` (200 ao mesmo tempo, todos com gente dentro) |

Com `senha-errada`, `muitas-tentativas` (10 senhas erradas do mesmo endereço em 5 minutos), `sala-cheia` e as recusas dos grupos, o servidor fecha a conexão logo depois de avisar. A senha errada de um grupo (e o `grupo-em-uso`) contam no mesmo freio. Uma mensagem que não é um objeto JSON recebe `mensagem-invalida`, e a conexão continua.
