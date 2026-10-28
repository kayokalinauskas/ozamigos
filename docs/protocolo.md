# Protocolo de sinalização

WebSocket em `/sinal`, com mensagens JSON que têm sempre o campo `tipo`. O servidor carimba o remetente (`de`) em tudo o que repassa; o cliente nunca informa quem ele é. Os tipos de cada mensagem estão em [`web/src/conexao/protocolo.ts`](../web/src/conexao/protocolo.ts).

**Cliente → servidor**

| `tipo` | Campos | Efeito |
|---|---|---|
| `entrar` | `sala`, `senha`, `nome`, `ficha` (opcional), `grupo` e `criar` (opcionais) | Confere a senha e entra na sala. Com conta (o cookie da sessão na abertura do WebSocket), o `nome` mandado é ignorado: vale o da conta. Na reconexão, a `ficha` recebida no `bem-vindo` anterior tira da sala a conexão antiga, se o servidor ainda não percebeu a queda. Com `grupo`, é um grupo criado na hora (`Grupos.java`): a senha é a dele, a sala é a única do grupo (`sala` vai vazia), e `criar: true` o cria se não existe (o cliente manda `criar` também ao reconectar, para o grupo voltar se o servidor reiniciou). Com `servidor` (o código), é um servidor salvo (`Servidores.java`): sem senha, só para quem entrou com a conta e é membro (`sala` e `senha` vão vazias) |
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
| `bem-vindo` | `id`, `ficha`, `nome` (o nome com que entrou), `conta` e `foto` (com conta), `outros[]` (`id`, `nome`, `conta`?, `foto`?), `compartilhando[]`, `plateias{}`, `gravando` (`id`, `nome`, se alguém grava a sala), `retransmissao[]` e `retransmissaoDaVoz[]` (os `iceServers` do TURN para o vídeo e para a voz, se ligada e dentro dos limites; a página de antes usa a do vídeo para tudo), `limiteDoVideo` (`seu` ou `geral`, se o vídeo veio sem por um limite), `retransmissaoSoComConta` (convidado, com a retransmissão ligada: ela é só para quem tem conta) | Ao entrar. A `ficha` é secreta: só quem a recebeu pode usá-la para reconectar |
| `retransmissao` | `servidores[]` (vídeo), `voz[]`, `limiteDoVideo`? | As credenciais do TURN que valem agora: renovadas (a cada 6 h), dadas depois da entrada, ou a lista vazia de um uso cortado por um limite de consumo. `limiteDoVideo`: `seu` (esta pessoa passou do limite de vídeo do dia; a página avisa que foi o uso dela) ou `geral` (o total de todos) |
| `pong` | — | Resposta ao `ping`. Sem nenhuma mensagem por 70 s, o cliente considera a conexão morta e reconecta |
| `entrou` / `saiu` | `id` (e `nome`, `conta`?, `foto`?) | Alguém entrou ou saiu. `conta` é o id da conta (sem ele, convidado), o mesmo depois de uma reconexão; `foto`, o endereço da foto no servidor (`/api/fotos/<conta>?v=<versão>`) |
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
| `erro` | `motivo` | `senha-errada`, `muitas-tentativas`, `sala-cheia`, `codigo-invalido`, `ja-esta-numa-sala`, `destinatario-nao-esta-na-sala`, `sala-ja-gravando`, `chat-rapido-demais`, `chamar-cedo-demais`, `mensagem-invalida`; dos grupos: `grupo-nao-existe`, `grupo-em-uso` (criar com um nome que existe, com outra senha), `grupo-invalido`, `senha-curta` (menos de 4 caracteres), `muitos-grupos` (3 criados pelo mesmo endereço em 10 minutos), `grupos-demais` (200 ao mesmo tempo, todos com gente dentro); dos servidores salvos: `sem-conta`, `servidor-nao-existe` (também para quem não é membro), `servidores-indisponiveis` (banco fora do ar), e, já na sala, `expulso` e `servidor-apagado` |

Com `senha-errada`, `muitas-tentativas` (10 senhas erradas do mesmo endereço em 5 minutos), `sala-cheia`, as recusas dos grupos e as dos servidores salvos (inclusive `expulso` e `servidor-apagado`, que tiram da sala quem já estava), o servidor fecha a conexão logo depois de avisar. A senha errada de um grupo (e o `grupo-em-uso`) contam no mesmo freio. Uma mensagem que não é um objeto JSON recebe `mensagem-invalida`, e a conexão continua.

## Contas (HTTP)

O login e a conta não passam pelo WebSocket: são páginas e uma API JSON no mesmo servidor (`Login.java`, `AoEntrar.java`, `ContaApi.java`). As ações (`POST`, `PATCH`, `DELETE`) só valem com o `Origin` do próprio servidor (`ProtecaoDaApi.java`); a sessão vai no cookie `__Host-ozamigos` (`HttpOnly`, `Secure`, `SameSite=Lax`).

| Caminho | Efeito |
|---|---|
| `GET /conta/entrar/{google\|discord}?voltar=/caminho` | Começa o login no navegador; no fim, ganha o cookie e volta para `voltar`. Erro: volta com `?erro-de-login=<motivo>` (`indisponivel`, `muitas-tentativas`, `recusado`, `pedido-invalido`) |
| `GET /conta/entrar/{provedor}?app=<porta>&estado=<estado>` | O login do app pelo navegador do sistema (RFC 8252): no fim, o navegador vai para `http://127.0.0.1:<porta>/login?codigo=<código>&estado=<estado>` (ou `erro=<motivo>`) |
| `GET /conta/ligar/{provedor}?voltar=/caminho` | Liga mais um provedor à conta logada. Erros a mais: `sem-conta`, `de-outra-pessoa`, `ja-tem-desse-provedor` |
| `GET /conta/ligar/{provedor}?app=<porta>&estado=<estado>&ligacao=<código>` | O mesmo, no app: a sessão é da janela do app, e o navegador do sistema leva o código de ligação. No fim, `http://127.0.0.1:<porta>/login?ligou=<provedor>&estado=` |
| `POST /api/eu/ligacao` | `{ligacao}`: o código de ligação (2 minutos, uma vez só; não vira sessão) |
| `GET /api/eu` | `{login: ["google", "discord"], conta: {id, nome, foto, provedores[]} \| null}`. `login` vazio: sem banco ou sem provedores |
| `PATCH /api/eu` | `{nome}` → o nome novo, limpo como o da sala |
| `POST /api/eu/sair` | Encerra a sessão e apaga o cookie |
| `DELETE /api/eu` | `{confirmar: true}`: apaga a conta e tudo dela, na hora |
| `DELETE /api/eu/provedores/{provedor}` | Desliga um provedor; o último não sai (409 `ultima`) |
| `POST /api/conta/codigo` | `{codigo}`: o app troca o código de uso único pela sessão, no cookie da janela dele (400 `codigo-invalido`) |
| `GET /api/fotos/{conta}?v=<versão>` | A foto (JPEG de 128 px), com cache de um ano |

Erros da API: `{erro: <motivo>}`, com 401 `sem-conta`, 503 `contas-indisponiveis`, 403 `origem`, 429 `muitas-tentativas`.

## Servidores salvos (HTTP)

`ServidoresApi.java`, com as regras em `Servidores.java`. Tudo pede conta, menos a prévia de um convite e o ícone. Para quem não é membro, um servidor que existe dá o mesmo 404 de um que não existe. Papéis: `dono`, `admin`, `membro`.

| Caminho | Quem | Efeito |
|---|---|---|
| `GET /api/servidores` | — | `{servidores: [{codigo, nome, icone, papel, membros}]}`, do que entrou por último para o primeiro |
| `POST /api/servidores` | — | `{nome}` → `{codigo}`. Até 10 servidores como dono e 100 no total por pessoa |
| `GET /api/servidores/{codigo}` | membros | `{codigo, nome, icone, papel, membrosConvidam, membros: [{conta, nome, foto, papel}]}` |
| `PATCH /api/servidores/{codigo}` | dono, admin | `{nome?, membrosConvidam?}` (o segundo, só o dono) → o servidor |
| `DELETE /api/servidores/{codigo}` | dono | `{confirmar: true}`: apaga com membros e convites; quem está na sala sai com `servidor-apagado` |
| `PUT /api/servidores/{codigo}/icone` | dono, admin | A imagem no corpo (até 2 MB) → `{icone}`, já reduzida a 128 px. `DELETE` tira o ícone |
| `GET /api/servidores/{codigo}/icone?v=<versão>` | todos | O ícone (JPEG), com cache de um ano |
| `POST /api/servidores/{codigo}/dono` | dono | `{para: <conta>}`: passa a posse; quem era dono vira admin |
| `PATCH /api/servidores/{codigo}/membros/{conta}` | dono | `{papel: "admin" \| "membro"}` |
| `DELETE /api/servidores/{codigo}/membros/{conta}` | todos, dono, admin | A própria conta: sair (o dono não sai, 409 `dono-nao-sai`). Outra: expulsar (o admin só tira membros), e ela sai da sala com `expulso` |
| `GET /api/servidores/{codigo}/convites` | dono, admin | `{convites: [{codigo, expiraEm, usosMaximos, usos, criadoPor}]}`, só os que ainda valem |
| `POST /api/servidores/{codigo}/convites` | dono, admin, membros (se `membrosConvidam`) | `{horas?, usos?}` (até 720 horas e 100 usos; sem eles, sem limite) → `{codigo}`. Até 20 ativos por servidor |
| `DELETE /api/servidores/{codigo}/convites/{convite}` | dono, admin | O link deixa de valer |
| `GET /api/convites/{convite}` | todos | A prévia: `{nome, icone, membros}`, ou 404 `convite-invalido` (não existe, venceu ou gastou os usos) |
| `POST /api/convites/{convite}` | — | Aceita: vira membro → `{servidor: <codigo>}`. Quem já é membro só recebe o código, mesmo com o convite gasto |

As páginas `/s/<codigo>` (o servidor) e `/c/<convite>` (o convite) abrem a interface. Erros a mais: 403 `sem-permissao`, 404 `servidor-nao-existe`, `membro-nao-existe` e `convite-invalido`, 400 `nome-invalido`, `icone-invalido`, `pedido-invalido` e `confirme`, 409 `dono-nao-sai`, `servidores-demais`, `participa-demais`, `membros-demais` e `convites-demais`. A prévia e o aceite de convites têm um freio de 30 a cada 10 minutos por endereço.
