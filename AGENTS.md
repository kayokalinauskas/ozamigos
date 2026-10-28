# AGENTS.md — guia para quem mexe no código

O `README.md` é para quem usa; aqui ficam as regras, os contratos e as armadilhas. O histórico de cada decisão está no `CHANGELOG.md` e no `git log`.

## O que é

Ozamigos: voz e transmissão de jogos entre amigos, **P2P por WebRTC**. Três peças num repositório:

| Pasta | Tecnologia | Papel |
|---|---|---|
| `src/` | Java 25, Spring Boot 4.1 (Jackson 3: `tools.jackson.*`) | Contas, servidores salvos, sinalização em `/sinal`, prévias de links. Serve a interface. **Voz e vídeo nunca passam por aqui** |
| `web/` | React 19, TypeScript, Vite | Interface. O build vai para `src/main/resources/static/` (não versionado) |
| `desktop/` | Electron 44 + auxiliares C# (.NET 10) em `desktop/som/` e `desktop/captura/` | App Windows: carrega a interface **do servidor** (`loadURL`) e acrescenta seletor, captura própria, som do PC sem eco, atalhos globais, bandeja e atualização |
| `site/` | HTML, CSS e JS puros | Site de apresentação (PT e EN), no GitHub Pages |

O deploy é uma imagem Docker (`Dockerfile`: Node monta `web/`, o JDK compila, o JRE roda). Hoje roda no Render, que publica a cada push na `main`. O `compose.yaml` sobe a mesma imagem com um Postgres local.

**Em andamento:** contas (Google e Discord), banco e servidores salvos, em fases. O plano, as decisões do dono e o que fica de fora estão em `docs/plano-contas.md`; leia antes de mexer em login, banco ou servidores.

## Regras (siga sempre)

- **Idioma:** código, identificadores, comentários, commits e textos em **português do Brasil**. Comentários explicam o *porquê*.
- **Git:** `git add` com **caminhos explícitos**, nunca `-A` ou `.`. Push só quando pedirem. Commits com o e-mail noreply do GitHub.
- **Mudanças grandes em branch, não na `main`** (decisão do dono, 27/10/2026): cada push na `main` vai para o ar no Render, e nada pela metade pode ir. As contas vivem no branch `contas`, com um PR em rascunho para a `main`; partes menores entram no `contas` por PRs próprios, e o `contas` só entra na `main` com uma fase inteira pronta para quem usa (a 0 e a 1 juntas). Correções pequenas continuam direto na `main`; traga-as para o `contas` com merge da `main`.
- **Terminal do dono:** PowerShell 5.1, **sem `&&`**. Nas instruções para ele, use `;` ou um comando por linha.
- **Testes:** poucos e essenciais, um por comportamento que importa. Rode `.\testar.ps1` antes de commitar. O resto se confere rodando o app (veja "Como testar").
- **Porta 8080:** o dono costuma ter outra coisa nela. Teste na **8090** e **não mate processos que você não abriu** (nem o Ozamigos instalado).
- **Telas prioritárias:** 1920×1080 e 2560×1440. Tema escuro, tokens em `web/src/estilo.css`.
- **Celular:** quem usa é quem assiste. **Nada pode passar da largura da tela** (regras no `@media (max-width: 640px)`; os e2e "no celular, ... largura da tela" conferem, contra 375 px (com `isMobile`, o Chromium afasta a página que não cabe e o `innerWidth` cresce junto)). Em fileira `flex`, use `min-width: 0`. Textos para o navegador não falam em "Windows".
- **Tom de produto:** no app e no site, nada de bastidores: sem "servidor gratuito", "dorme", Render, Cloudflare, TURN, WebRTC, P2P, RNNoise, "rede neural", kbps ou medidas. Diga o benefício ("pouco atraso", "redução de ruído inteligente"). Detalhes técnicos só no GitHub e nas telas de diagnóstico (estatísticas, relatórios, teste de desempenho).
- **Textos curtos, sem enfeite** (pedido do dono, 28/10/2026): um rótulo, botão ou dica diz o que faz e para. Nada de explicação entre parênteses ("Baixar o app para Windows (som do jogo sem eco)"), frase de efeito depois de cada título, ou descrição repetindo o que já está em outro lugar da página. Parênteses só para o que a pessoa precisa para agir (um atalho, um caminho de menu).
- **Estatísticas de uso:** hoje nada é coletado. O site não promete "sem rastreamento": a privacidade diz que o app avisa se um dia usar estatísticas. Se isso mudar, o aviso no app e a privacidade nas duas línguas mudam junto.
- **Segredos:** só em variáveis de ambiente, nunca no código.
- **Custo zero:** o dono não aceita nenhum risco de cobrança. Não cadastre forma de pagamento nem ligue nada pago.

## Marca

- **Nome:** "Ozamigos" em tudo o que o usuário vê (era "Ozamigos Share" até a 1.0.2). Repositório público `kayokalinauskas/ozamigos`. O antigo `ozamigos-share-app` fica parado: não mexa nem faça push nele. Os nomes internos ficam: pacote `dev.ozamigos`, `OzamigosSom.exe`, chaves `ozamigos-*` do `localStorage`.
- **Não mude:**
  - o `appId` `dev.ozamigos.share` (o instalador novo substitui o antigo por ele);
  - a pasta de dados `%APPDATA%\Ozamigos Share`, fixada com `app.setPath('userData', ...)` no topo do `main.js`. Sem isso, todos perderiam o endereço do servidor, a sessão da conta e os volumes;
  - o `publisherName` do electron-builder fica sem configurar (veja "Atualização automática").
- **Ícone "Tecla oz":** tecla com "oz" na Sora 700, tamanho 66 em 96, o "o" claro e o "z" verde, ocupando o quadro todo (1 de margem), fundo transparente. As letras são caminhos SVG (`LETRA_O`, `LETRA_Z`). **A geometria existe em dois lugares que precisam ficar iguais:** `web/public/icone.svg` (copiado em `site/icone.svg`) e `desktop/build/gerar-icone.js` (gera o `icone.ico` e o `icone.png`; `npm run icone` em `desktop`). O `.ico` desenha cada tamanho (16 a 256) direto, sem reduzir o de 256. `site/imagens/icone-180.png` é o SVG em 180×180.
- **Logotipo:** a tecla em SVG (`.tecla-oz`, `viewBox="1 1 94 94"`) seguida de "amigos" na Sora. **No logo, o "oz" é Sora 600 tamanho 57**, igual a "amigos" (as letras do ícone ficariam maiores). A tecla se alinha pela base das letras: `.logo` é texto (`line-height: 1`, sem flex) e `.tecla-oz` é `inline-block` com `vertical-align: -0.641em` (recalcule com (95 − base) / 94 × altura se mudar). A tecla tem 1,65× a altura do texto. **O SVG está repetido** em `Logo.tsx`, `site/index.html`, `site/en/index.html`, `site/404.html`, `desktop/inicio.html`, `desktop/atualizando.html` e `docs/vitrine/marca.html`: mude todos.
- **Paleta Lima** (`web/src/estilo.css`, repetida em `desktop/inicio.css`): fundo `--fundo` `#0b0e0a`, destaque `--destaque` `#b6f24a`. **Texto sobre o verde é escuro** (`--no-destaque`). Vermelho só para "ao vivo" (`--ao-vivo`).

## Comandos (PowerShell, na raiz)

```powershell
cd web; npm install; npm run build; cd ..          # interface (sempre que mexer em web/)
cd web; npm run typecheck; npm test; cd ..         # tipos e testes da interface (Vitest + happy-dom)
$env:PORT = "8090"                                  # e as variáveis do banco e do login de teste (veja "Como testar")
.\mvnw.cmd spring-boot:run                         # servidor local
.\mvnw.cmd test                                    # testes do servidor
.\testar.ps1                                       # tudo: servidor, interface, áudio, e2e (8090) e app; -Rapido pula navegadores e app
docker compose up --build                          # tudo: Postgres, login de teste e servidor, em http://localhost:8090
docker compose up -d banco                         # só o Postgres local (127.0.0.1:5433), para o servidor rodado à mão
cd desktop; npm install; npm run som; npm run captura; npm start   # app em desenvolvimento (veja o aviso em "Como testar")
cd desktop; npm run instalador                     # instalador e portátil em desktop\dist
```

Servidor servindo a interface direto da pasta (sem refazer o jar):
```powershell
java -jar target\ozamigos-share-0.0.1-SNAPSHOT.jar --spring.web.resources.static-locations=file:src/main/resources/static/ --spring.web.resources.cache.period=0
```

## Variáveis de ambiente do servidor

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | não | Porta HTTP (padrão `8080`) |
| `YOUTUBE_API_KEY` | não | API de dados do YouTube v3, para as prévias. Sem ela, oEmbed e página do vídeo, que às vezes recusam IPs de datacenter |
| `OZAMIGOS_TURN_ID`, `OZAMIGOS_TURN_TOKEN` | não | Chave do TURN da Cloudflare (*Realtime → TURN Server*) |
| `OZAMIGOS_CLOUDFLARE_CONTA`, `OZAMIGOS_CLOUDFLARE_LEITURA` | não | Account ID e token só com *Account Analytics: Read*, para ler o consumo. **A retransmissão só liga com as quatro** |
| `OZAMIGOS_BANCO_URL`, `OZAMIGOS_BANCO_USUARIO`, `OZAMIGOS_BANCO_SENHA` | sim, na prática | O Postgres (`jdbc:postgresql://...`). Sem a URL, o servidor sobe, mas ninguém entra: as salas são as dos servidores salvos, no banco |
| `OZAMIGOS_GOOGLE_ID`, `OZAMIGOS_GOOGLE_SEGREDO`, `OZAMIGOS_DISCORD_ID`, `OZAMIGOS_DISCORD_SEGREDO` | não | Os clientes OAuth do login. Cada provedor só aparece com os dois; o login só funciona com o banco |
| `OZAMIGOS_GOOGLE_EMISSOR` | não | **Só para testes:** troca o Google por um emissor OpenID Connect falso (mock-oauth2-server) |
| `OZAMIGOS_CONTAS_NOVAS_POR_ENDERECO`, `OZAMIGOS_CONTAS_NOVAS_POR_HORA` | não | Os tetos de contas novas por hora: por endereço (padrão 5) e no servidor todo (padrão 200). Os e2e sobem os dois |
| `OZAMIGOS_API_POR_MINUTO` | não | Pedidos à API e aberturas do WebSocket por endereço a cada minuto (padrão 300) |
| `OZAMIGOS_DONOS` | não | Ids das contas (tabela `usuarios`) que veem o painel do dono, separados por vírgula. Sem ela, o painel não existe para ninguém |

## Servidor (`src/main/java/dev/ozamigos/`)

- **`Salas`:** estado em memória, métodos `synchronized`. Cada sala (a de um servidor salvo, chave `servidor:<codigo>`) tem `participantes`, `nomes`, `contas` e `plateias` (quem transmite → quem assiste). **Ter chave em `plateias` é o que significa "está transmitindo".** `LIMITE_POR_SALA = 8`: o gargalo é o upload de quem transmite (~4 Mbps por pessoa assistindo em 720p · 30).
- **`SinalizacaoHandler`:**
  - **entrar é só com conta e sendo membro** (`recusaDoServidor`): sem conta → `sem-conta`; quem não é membro recebe o mesmo `servidor-nao-existe` de um servidor que não existe; e a conexão fecha. Sem senha (decisão do dono, 28/10/2026). O nome é o da conta. A conferência e a entrada na sala acontecem segurando a trava do servidor (`travasDosServidores`), a mesma da expulsão;
  - o endereço dos freios (logins, convites, retransmissão) é o `CF-Connecting-IP` (a Cloudflare na frente do Render o escreve; o visitante não forja), senão o remoto: a regra está em `Enderecos`, a mesma para o WebSocket e para as páginas. **Não volte para o `X-Forwarded-For`** (forjável; o `EnderecosTest` cobre). Se o servidor sair de trás da Cloudflare, troque a regra;
  - o `entrou` vai só para quem já estava, tirado junto com a lista do `bem-vindo` dentro do `synchronized` (`Entrada.avisar`); fora dele, duas entradas juntas se duplicavam;
  - o servidor **carimba `de`** em tudo o que repassa e só repassa dentro da mesma sala; envios por `ConcurrentWebSocketSessionDecorator`;
  - **chat:** repassa para todos (inclusive quem mandou, como confirmação) e **não guarda nada**. Texto limpo por `textoDoChat` (sem controle nem direção de texto, até 500), freio de 5 a cada 3 s. **O texto do chat nunca vai para o log.** **O nome da pessoa vai** no log de entrada e saída e no do consumo da retransmissão (pedido do dono, 26/10/2026; a política de privacidade fala dele), já limpo por `nomeLimpo` (sem quebra de linha, ninguém forja linhas no log).
  - **chamar:** até 5 por minuto para cada pessoa chamada (`CHAMADAS_POR_JANELA`, `CHAMADAS_JANELA_MS`; as mesmas constantes existem no cliente: mude as duas).
- **Saíram em 28/10/2026** (decisão do dono, "igual ao Discord"): a senha do servidor (`OZAMIGOS_SENHA`), o grupo fixo `/ozamigos`, os grupos criados na hora (`/nome`), as salas por código (`?sala=`) e o freio de senhas (com o único log de IP). `PaginasDoApp` manda os links antigos para a entrada; ele vem antes do WebSocket e exclui os caminhos do servidor do padrão.
- **Banco** (`Banco`, `VidaDoBanco`, migrações em `src/main/resources/db/migracao/`): PostgreSQL. Sem `OZAMIGOS_BANCO_URL`, nada dele existe (o servidor sobe, mas ninguém entra numa sala). No Render, o Supabase grátis em East US (a região do Render), pelo *Session pooler* (a conexão direta do Supabase grátis é só IPv6).
  - **O banco fora do ar não derruba quem já está na sala** (as salas são da memória), nem o servidor: a fonte de dados é montada pelo `Banco` (o `DataSourceAutoConfiguration` fica excluído no `application.properties`) e não conecta ao nascer; as migrações do Flyway rodam pelo `VidaDoBanco`, numa thread própria, de novo a cada 30 s até dar certo. **Não troque pelo Flyway do Spring**: com o banco fora, o servidor não subiria. O que depende do banco confere `VidaDoBanco.pronto()`.
  - A saúde (`/actuator/health`) **não inclui o banco** (`management.health.db.enabled=false`): senão, o Render reiniciaria o servidor e o app ficaria em "Conectando..." com o banco fora.
  - Um sinal de vida por dia (`sinais_de_vida`): o Supabase grátis pausa o projeto depois de 7 dias sem uso.
  - **Migração aplicada nunca muda**: corrija com uma nova (`V2__...sql`). Acesso pelo `JdbcClient`, com SQL escrito à mão.
  - **As tabelas ficam no esquema `ozamigos`** (`Banco.ESQUEMA`, no search_path da conexão), nunca no `public`: o Supabase põe coisas suas lá, e o Flyway recusou o `public` não vazio no primeiro deploy. O `ComBanco` dos testes imita isso.
  - Backup semanal criptografado pelo `backup.yml` (o repositório é público). Testes: `BancoTest`, num Postgres de verdade pelo Testcontainers (precisa do Docker ligado; sem ele, pula).
- **Contas** (`Contas`, `Sessoes`, `Login`, `AoEntrar`, `ContaApi`, `FotosDoPerfil`, `CodigosDoApp`; migração `V2__contas.sql`; HTTP em `docs/protocolo.md`): login com o Google e o Discord.
  - **O mínimo de dados:** do provedor, só o id da conta, o nome e a foto. Os escopos (`openid profile`, `identify`) **não pedem o e-mail**; não peça sem o dono decidir (e a privacidade mudar junto). Sem senha, sem IP no banco.
  - **O Spring Security só faz o fluxo OAuth** (`SegurancaConfig`: estado, PKCE, token do Google conferido). Todo o resto fica `permitAll`, sem o CSRF e o Cache-Control dele (o `CacheConfig` vale), e a autenticação do Spring não fica na sessão HTTP. **A sessão é do Ozamigos** (`Sessoes`, no banco): cookie `__Host-ozamigos` com 256 bits aleatórios, o banco guarda só o SHA-256, 60 dias desde o último uso (no banco e no cookie, que o `GET /api/eu` devolve renovado a cada abertura: **quem usa nunca precisa entrar de novo**, pedido do dono, 28/10/2026; no app, a sessão padrão do Electron guarda o cookie em disco). O `AoEntrar` descarta a sessão HTTP do login (com o token do provedor): **nenhum token do Google ou do Discord é guardado**. `POST /api/eu/sair-de-todos` apaga todas as sessões da conta e tira das salas quem estava nelas (`sem-conta`).
  - **Banco fora do ar = ninguém entra** (`servidores-indisponiveis`; `Sessoes.conta` devolve vazio), e nunca uma espera longa: a conexão tem prazo de 3 s (`Banco`), e uma falha deixa o banco de fora por 30 s (`Contas.bancoFalhou`), sem tentar. A entrada numa sala faz duas consultas: a sessão (na abertura do WebSocket) e a de membro, que precisa valer na hora, pela expulsão.
  - **Ações da API só com o `Origin` do servidor** (`ProtecaoDaApi`, contra CSRF; o cookie Lax é a outra camada). `voltar` só aceita caminhos deste servidor (contra redirecionamento aberto).
  - **Login do app pelo navegador do sistema** (RFC 8252; o Google bloqueia login em janela embutida): o app abre uma porta no `127.0.0.1`, o servidor manda o navegador para lá com um código de uso único (2 min, só na memória) e a página do app o troca pela sessão (`POST /api/conta/codigo`). Um link de login forjado não serve a ninguém: o código vai para o PC de quem logou, e o app confere o `estado` que ele sorteou.
  - **Na sala:** com conta, o nome é o dela (o que a página manda é ignorado), e `bem-vindo`, `outros` e `entrou` levam `conta` e `foto`. A foto é baixada só dos servidores de imagens do provedor (`FotosDoPerfil.HOSTS`) e reduzida (128 px, até 16 KB); a sala a vê por `/api/fotos`, nunca pelo provedor.
  - O log diz o id da conta no login, nunca token nem id externo. Testes: `ContasTest` (Postgres de verdade; a volta do provedor simulada no `AoEntrar`).
- **Servidores salvos** (`Servidores`, `ServidoresApi`; migração `V3__servidores.sql`; HTTP em `docs/protocolo.md`): a fase 2 do plano. Só com conta, no banco: não somem quando o servidor reinicia, e o membro entra **sem senha** (`entrar` com `servidor`; a sala é `servidor:<codigo>`, uma por servidor até a fase 3).
  - **Todas as regras de papel ficam em `Servidores`** (a API só traduz): o dono faz tudo e é o único que apaga, passa a posse, troca papéis e decide se os membros convidam; o admin muda nome e ícone, convida, cuida dos convites e expulsa membros (não admins); o membro entra, sai e convida se o dono deixar. **Expulsar também bloqueia** (`bloqueios`, decisão do dono, 28/10/2026): sem isso, um convite sem limite traria a pessoa de volta na hora; o dono ou um admin desbloqueia. Recusas são `Servidores.Recusa`, lançadas dentro da transação.
  - **O dono é o membro de papel `dono`** (um só, pelo índice `um_dono_por_servidor`), não uma coluna. Apagar a conta (`Contas.apagar`) passa cada servidor dela ao admin mais antigo, senão ao membro mais antigo, e apaga os que ficam vazios.
  - Para quem não é membro, servidor que existe e que não existe dão o mesmo `servidor-nao-existe`. Expulsar e apagar tiram da sala na hora (`SinalizacaoHandler.tirarDoServidor`). Os limites (10 como dono, 100 no total, 100 membros, 20 convites ativos) são conferidos com a conta ou o servidor travados (`for update`).
  - Códigos de servidor e de convite: 10 letras e números sem os que se confundem. **O nome do servidor não vai para o log**. Testes: `ServidoresTest`.
- **Retransmissão** (`Retransmissao`, `CloudflareHttp`): TURN da Cloudflare para quem não conecta direto. **A Cloudflare não tem teto de gastos; o teto é desta classe, que falha fechada** (sem ler o consumo há 15 min, ninguém recebe credencial nova).
  - **Duas credenciais por pessoa, uma para a voz (com as imagens do chat) e outra para o vídeo** (26/10/2026, pedido do dono): a Cloudflare mede cada uma, e quem gasta muito perde só o vídeo e continua conversando, com um aviso dizendo que foi o uso dela (`avisarDoLimiteDoVideo` em `cliente.ts`). No `bem-vindo`, `retransmissao` (vídeo, o nome de antes: a página aberta antes do deploy a usa para tudo) e `retransmissaoDaVoz`; na interface, `novaPeerConnection('voz' | 'video')`. Válidas por 12 h, renovadas a cada 6 h (`retransmissao`), canceladas 2 min depois de a pessoa sair.
  - **O dono tem cartão cadastrado na Cloudflare (26/10/2026): passar da franquia seria cobrado.** Limites: vídeo, 10 GB por endereço no dia (umas 5 h de 720p; o dono manteve, 28/10/2026); voz, 3 GB por endereço no dia (passar disso não é conversa: corta as duas); no total, o vídeo para em 45 GB no dia ou 450 GB em 31 dias, e tudo para em 50 GB no dia ou 500 GB em 31 dias (metade da franquia, para a folga cobrir o que escapa entre as leituras); 10 pedidos de credenciais por endereço a cada 10 min. O log diz o consumo (vídeo e voz) de hora em hora e a cada 1 GB a mais no dia, junto com quanto cada pessoa usou hoje (`Retransmissão de Kayo (1e0331af) hoje: vídeo 2.4 GB, voz 12 MB`), e os cortes dizem o nome de quem passou do limite. Consumo lido a cada 5 min pelo GraphQL (`egressBytes`), **também logo ao subir e com a sala vazia** enquanto alguma credencial emitida ainda vale. Credencial usada hoje que este servidor não emitiu (de antes de um reinício) é cancelada; cancelamento que falha é tentado de novo a cada 30 s. **A leitura nunca bloqueia a entrada** (roda na thread da retransmissão, com prazo de 30 s): quem entra antes da primeira leitura recebe a credencial depois, pela mensagem `retransmissao`. Lida no meio da entrada, a primeira pessoa depois de um deploy esperava a consulta, que passou de 6 s no servidor recém-acordado (26/10/2026).
  - **Ligada no Render desde 26/10/2026.** O endereço não vai para o log. Testes: `RetransmissaoTest`, com uma Cloudflare falsa.
  - Credenciais para todos que entram (todos têm conta desde 28/10/2026). Os limites "por endereço" valem também por conta (`Pessoa.chaves`): trocar de rede não renova o limite da pessoa.
- **Prévias de links** (`PreviasDeLinks`): o servidor busca a prévia do primeiro link de vídeo ou canal e manda `previa` para a sala; ninguém da sala acessa o site.
  - **Lista fechada, contra SSRF:** `reconhecer` só aceita os caminhos conhecidos de cada site; redirecionamentos seguidos à mão só para `PAGINAS`, imagens só de `IMAGENS`. **Nunca busque um endereço vindo do chat sem passar por essa lista.**
  - Miniatura reduzida no servidor (até 400 px, JPEG ≤ 48 KB, `data:`), lida já reduzida (`setSourceSubsampling`); acima de 40 MP nem abre. WebP pelo `imageio-webp`.
  - Cache de 200 links por 1 h (falha, 2 min), 4 buscas ao mesmo tempo. **O link nunca vai para o log.** Os testes não usam a internet (`Buscador` falso).
- **`WebSocketConfig`:** **sem `setAllowedOrigins`**: só páginas do próprio servidor conectam. Mensagens até 64 KB. O `SinalizacaoHandler` aceita até 20 conexões abertas por endereço (`CONEXOES_POR_ENDERECO`) e fecha a que não entra numa sala em 10 s.
- **Limites contra abuso** (revisão de segurança, 28/10/2026; **não tire sem pôr outro no lugar**): `LimitesDaApi` (filtro antes de tudo) limita o corpo de todo pedido (16 KB; o ícone, 2 MB), lido antes de saber de quem é, e os pedidos à API e as aberturas do `/sinal` por endereço (300 por minuto, `ozamigos.limite.api-por-minuto`; um contador por endereço, não o `Freio`, para uma enxurrada de endereços não encher a memória). Sem ele, alguns pedidos enormes derrubavam o servidor, e uma enxurrada de fotos esgotava as 5 conexões do banco (e o `bancoFalhou` deixava todos de fora por 30 s). Por conta: 30 ações por minuto (`ServidoresApi`, `ContaApi`) e 10 ícones a cada 10 min. Contas novas (contra quem criasse milhares para encher o banco grátis): até 5 por endereço por hora (`Contas.novasPorEndereco`, o freio de verdade) e até 200 por hora no servidor todo (`contasNovasPorHora`, último recurso: um teto global baixo deixaria quem cria contas descartáveis fechar a entrada de todos). O contador da API, cheio de endereços, limpa no máximo uma vez por segundo e põe os novos numa contagem só (`EXCEDENTE`). Os testes sobem os tetos configuráveis (`ComBanco`, `e2e/infra.ts`).
- **Painel do dono** (`Painel`, `PainelApi`, `Painel.tsx`, em `/painel`; pedido do dono, 28/10/2026): as salas abertas (quem está, quem transmite e quem assiste, de `Salas.retrato`), o consumo da retransmissão (`Retransmissao.resumo`, a última leitura, também por conta), o banco (tamanho, por tabela, contas novas e vistas), os servidores e as contas (até 1000 de cada). **Só leitura por enquanto.** Quem é dono vem de `OZAMIGOS_DONOS`, conferido a cada pedido pelo servidor; para os outros, `GET /api/painel` dá o mesmo 404 de um endereço que não existe, e a página diz só "Esta página não existe" (nem o título aparece). O `/api/eu` manda `dono: true` só para o dono (o link na entrada). Quem tem conta e pede o painel sem ser dono vai para o log (uma vez a cada 10 min). A privacidade, nas duas línguas, diz o que o painel mostra: mudou o painel, mude as duas. Testes: `PainelTest`.
- **A conta indisponível tenta de novo** (`carregarConta` em `conta.ts`): o `/api/eu` diz `indisponivel` quando o banco existe mas não está pronto (o servidor recém-acordado responde à saúde antes de o banco ficar pronto, e o app abre a página nesse intervalo). A entrada mostra "Carregando…" por até 20 s e pergunta de novo a cada 3 s (depois, o aviso, e a cada 10 s).
- **Protocolo:** `docs/protocolo.md`. **Mudou o protocolo? Mude o servidor, `web/src/conexao/protocolo.ts` e `docs/protocolo.md` juntos.** O `conexao.test.ts` falha se o servidor mandar algo que o `protocolo.ts` não conhece, e o `switch` de `tratar` no `cliente.ts` não compila sem um caso para cada mensagem.

## Interface (`web/src/`)

### Núcleo

- `cliente.ts` é o núcleo, sem React: um *store* (`inscrever`/`ler`) lido por `useSyncExternalStore`. Os componentes só leem e chamam ações.
- **Botões de login com os logos oficiais** (`web/public/marcas`, `MARCA` em `Conta.tsx`): o do Google segue a diretriz dele (tema escuro, Google Sans 500, "Continuar com o Google"); o do Discord, Blurple com o símbolo branco. **Não redesenhe, não mude as cores nem o texto do Google**: a aprovação do app no Google depende disso.
- `conta.ts` é o *store* da conta (`useConta`): `/api/eu` ao abrir (e de novo sozinho enquanto vier `indisponivel`), e as ações (entrar, ligar, desligar, renomear, sair, sair de todos, apagar). **Quem manda é o servidor:** a sessão vai no cookie `HttpOnly` (a página nem o enxerga), e na sala o nome e a foto vêm do `bem-vindo` (`minhaConta`, `minhaFoto`). No navegador, o login sai da página e volta (`?erro-de-login=` vira aviso e some do endereço; `voltouDoLogin` evita que a volta pareça um convite); no app, vai pelo navegador do sistema (`ponte.conta`, veja "Login pelo navegador"). App antigo sem a ponte: sem os botões.
- `servidores.ts` fala com a API dos servidores salvos (`servidores.*`, `useServidor`); `pode()` só esconde os botões que o papel não deixa usar (quem confere é o servidor). Telas: `Servidores.tsx` (a lista na entrada, a página `/s/<codigo>` e o convite `/c/<codigo>`, que pede o login antes de aceitar) e `ConfiguracoesDoServidor.tsx` (a engrenagem do cartão da sala: geral, membros, convites, bloqueados). `cliente.entrarNoServidor(codigo)` entra sem recarregar e sem senha; o estado tem `servidor` (o código). O "Convidar" do cartão cria um convite de 7 dias a cada clique.
- `conexao/` tem as peças sem estado da sala: `protocolo.ts`, `sinalizacao.ts` (WebSocket, fila e esperas da reconexão), `captura.ts`, `medidor.ts`, `relatorio.ts`, `webrtc.ts` (STUN, Opus no SDP, preferência de codec) e `codigoDaSala.ts`.
- O `localStorage` está sempre em `try/catch` (`armazenamento.ts`).

### Transmissão

- **Duas conexões por par, uma por sentido:** chave `${canal}:${id}`, `canal` = `envio` ou `recebimento`. O candidato ICE vem com o canal **de quem mandou** e quem recebe inverte. **Não remova a inversão.** Quem transmite sempre faz a oferta (evita *glare*).
- **Assistir sob demanda:** `assistir {para}` → o servidor põe na plateia e avisa quem transmite → ele faz a oferta → quem assiste só aceita se ainda estiver em `estado.assistindo`.
- **`assistindo` é intenção:** a pessoa continua na lista quando quem transmite para, e o cliente manda `assistir` sozinho quando a transmissão volta. Só sai com `deixarDeAssistir` ou `saiu`.
- **Trocar a fonte não renegocia:** a conexão nasce com um *transceiver* de áudio e a troca usa `replaceTrack`.
- **Qualidade:** padrão **720p · 30** (`QUALIDADE` em `qualidade.ts`, id `leve`). 720p · 60, 1080p · 30 e 1080p · 60 ficam **escondidos na engrenagem do app** (aba Geral, `ozamigos-resolucao`), e só com o canal direto do vídeo (`qualidadesAltas` em `escolhaDeQualidade.ts`). **Não mude o padrão nem traga a escolha para a tela principal sem o dono pedir.** A escolha vale a partir da próxima escolha de fonte.
  - Tamanho e fps saem da captura (`tamanhoDaCaptura()`), uma redução só; `scaleResolutionDownBy` fica em 1. O codificador recebe `maxBitrate`, `maxFramerate` e `degradationPreference` por `setParameters`.
  - **`degradationPreference: 'maintain-resolution'`:** sob aperto, baixa fps e nitidez, nunca a resolução, por pessoa. **Não volte para `balanced`**: em jogo pesado a resolução caía para 360p e não voltava.
  - **Bitrate inicial:** cada pessoa nova recebe 50% nos primeiros 6 s (`BITRATE_INICIAL`, `SUBIR_BITRATE_DEPOIS`); o codificador da AMD passava do alvo no começo e congelava a imagem.
  - **Codec:** H.265 quando os dois lados codificam e decodificam na placa, H.264 de reserva (`preferirCodecs`). Rende mais nitidez na mesma banda. Se o H.265 não soltar quadro em 10 s (`conferirHevc`), refaz em H.264. **Em 1080p, sempre H.264** (`aceitaHevc`): reconfigurar o H.265 da AMD em 1080p · 60 derrubava a página. AV1 e VP9 codificam no processador neste Chromium: não entram sem medir de novo.
  - O app desliga o descarte de quadros do WebRTC (`--force-fieldtrials=WebRTC-FrameDropper/Disabled/` no `main.js`): com ele, o envio caía para 5–9 fps em cena pesada. **Não remova.** Risco conhecido: numa queda forte de banda, a fila de envio enche (confira "Fila ms" nos relatórios).
  - **O som da transmissão vai num MediaStream separado do vídeo:** juntos, o navegador sincronizava e a imagem esperava o som.
  - Opus estéreo pela edição do SDP (`opusEstereo`), na oferta e na resposta; o som capturado vai sem `echoCancellation`/`noiseSuppression`/`autoGainControl` e com `contentHint = 'music'`.
- **Folga de rede** (`FolgaAdaptativa` em `folga.ts`): `jitterBufferTarget` **só no receptor de vídeo**, entre 80 e 250 ms, sobe com o jitter e com congelamentos, desce devagar com a rede calma. Não aplique no som (somava ~200 ms de atraso).
- **Piso de fps da captura** (`FPS_MINIMO_DA_CAPTURA` = 10, por `applyConstraints`): com a tela parada, o Chromium mandava 1 fps e quem assiste contava congelamentos falsos.
- **Captura do Chromium em jogo pesado fica em ~21 fps:** ele não deixa a cópia de cada quadro passar de 50% do tempo. Limitar o jogo a 60 fps com VSync ajuda (o aviso "Captura a X fps" e o diagnóstico `captura-lenta` dizem isso). **No app, a captura padrão é a própria** (veja "Captura de vídeo do app"), sem esse limite. As flags `WebRtcAllowWgcUsingTexture`/`ZeroCopyDesktopCapture` derrubam a página no Electron 44: não ligue sem testar numa versão nova.
- **`aquecerWebRtc()`:** o primeiro uso do WebRTC trava a página por até ~2 s (consulta de codecs à placa). A consulta é feita 300 ms depois do `bem-vindo`. **Não remova nem tente adiar** (a conexão de voz faria a mesma consulta).
- **Vídeo que cai volta sozinho** (`refazerVideo`): `failed`, ou `disconnected` por 2 s, refaz com `deixar` + `assistir` (até 3 vezes; 1 se nunca conectou, e então "Tentar de novo"). Sem sinalização, espera ela voltar.

### Voz (`voz/`)

- Uma `RTCPeerConnection` só de voz por par, separada do vídeo, com *store* próprio (`useVoz`). Sinalização com `canal: 'voz'` (sem a inversão).
- **Quem chega liga** para todos; quem estava só responde. Se cair, quem ligou liga de novo (até 3 vezes). **O vigia** (`VIGIA_DA_VOZ`, 20 s) refaz a conexão parada em "conectando"; os dois lados tentam depois de um sorteio de até 5 s (`SORTEIO_DO_VIGIA`). O e2e "a voz que fica parada em conectando..." perde a primeira oferta de propósito.
- Mudo e som desligado vão por um canal de dados `negotiated` **id 0**. As imagens do chat usam o **id 1**.
- **Microfone:** `getUserMedia` → `processador.ts` (AudioWorklet, quadros de 10 ms: volume, RNNoise, porta em `porta.ts`) → `MediaStreamDestination`. Mudo é `trilha.enabled = false`.
  - O RNNoise é o WebAssembly de `@sapphi-red/web-noise-suppressor`, sem a cola do Emscripten (importa só `emscripten_memcpy_big`, `emscripten_resize_heap` e `__assert_fail`). Chame `emscripten_stack_init` **antes** de `__wasm_call_ctors`.
  - O RNNoise roda sempre, mesmo com outra supressão escolhida: a chance de voz dele faz a sensibilidade automática.
- **Saída:** amigo → `GainNode` → mestre → `AudioContext` com `setSinkId`. O som da conexão vai também num `<audio muted>`, senão o Chrome não entrega o WebRTC ao Web Audio.
- Quem fala: amigos pelo `audioLevel` de `getSynchronizationSources()` a cada 100 ms; eu, pela porta aberta.
- Opus de voz: mono, 64 kbps, FEC e DTX (`opusDeVoz`).
- **Atalhos** (`voz/atalhos.ts`): Ctrl+Shift+M (mudo), Ctrl+Shift+D (som) e apertar para falar (sem tecla padrão). No app, valem com o jogo na frente (veja "Atalhos globais"); no navegador, só com a página em foco (`LeitorDeAtalhos`, a mesma regra). Uma tecla sozinha não dispara com um campo de texto em foco. **Apertar para falar** segura 150 ms depois de soltar.
- **Chamar a atenção:** toca o som `chamado` mesmo com os sons e as notificações desligados; no app, pisca o ícone. Quem eu silenciei não me chama.
- **Qualidade da conexão** (`voz/qualidade.ts`): a cada 2 s, ida e volta, perda e jitter da conexão de voz; o ícone aparece só quando não está boa.

### Sala

- **Conta na sala:** `chaveDe(id)` reconhece a pessoa (`conta:<id>`): é a chave da volta depois de uma queda (`saidas`), do freio de chamar, e dos volumes e do silenciado guardados. Mudou a conta com a sala aberta (sair, apagar): `renovarConexao()` abre outra conexão com o servidor, que lê a sessão nova (sem conta, a recusa leva à entrada). **O nome novo vale só na próxima entrada**: refazer a conexão no meio da conversa cortava a voz de todos.
- **Reconexão** (`perderConexao` → `agendarReconexao` → `conectar`):
  - queda pelo `onclose` ou pelo silêncio: `ping` a cada 30 s, e 70 s sem mensagem (`SILENCIO_MAXIMO`) derrubam; com a página voltando a ficar visível depois de 35 s, já conta como caída;
  - esperas de 1, 2, 5 e depois 10 s, para sempre; o evento `online` força uma tentativa;
  - o `bem-vindo` traz uma `ficha` secreta; na reconexão, o servidor (`Salas.donoDaFicha`) tira a conexão antiga da sala;
  - **o id muda na reconexão**: quem volta é reconhecido **pela conta** (`saidas`, 2 min). `voltei` refaz as conexões, reenvia `comecei` e volta a assistir;
  - as conexões WebRTC abertas continuam durante a queda;
  - recusado ao reconectar, ou tirado da sala (`sala-cheia`, `expulso`, `servidor-apagado`, `fora-do-servidor`): volta para a página do servidor com o motivo.
- **Entrada** (`Entrada.tsx`): sem conta, só o login; com conta, "Seus servidores" e criar um. **Não entra sozinha em sala nenhuma**: o app abre na lista, como o Discord (pedido do dono, 28/10/2026). O cliente apaga uma vez o que as salas com senha guardavam (`esquecerOQueSaiu`: senhas, último lugar). **No celular, o cartão da entrada não cresce até o texto mais largo** (`grid-template-columns: minmax(0, 1fr)` em `.entrada`).
- **Chat** (`PainelChat.tsx`): até 200 mensagens na memória da página. O cliente confere o mesmo freio do servidor (`LIMITE_DO_CHAT`, `CHAT_RAJADA`, `CHAT_JANELA`: mude junto com o servidor). **O texto do chat não vai para o relatório** (`mostrarAviso`, não `avisar`).
- **Imagens do chat** (`imagens/`): **direto entre os PCs**, pelo canal de dados id 1 da conexão de voz; o servidor não vê nenhuma.
  - **O arquivo original nunca sai do PC:** `compressor.worker.ts` redesenha (apaga metadados como o GPS) e comprime com o libwebp do jSquash. **Não troque pelo WebP do canvas** (sem `use_sharp_yuv`, desbota linhas coloridas; o Safari devolve PNG).
  - Regras e números em `regras.ts`, usados por quem manda e por quem recebe (até 2560×1440 e 1,5 MB).
  - **Quem recebe confere tudo antes de mostrar** (`Recepcao`): tamanho, soma dos pedaços e o **cabeçalho do WebP** (uma imagem gigante travaria a página); o resto vira `recusei`. Cada lado manda `ola` ao abrir: sem resposta em 5 s, a página do outro não tem imagens.
  - Enquanto a pessoa transmite, as imagens saem a no máximo 3 Mbps (`RITMO_DAS_IMAGENS_TRANSMITINDO`). Com texto junto, o texto vai antes.
  - Bandeja (`bandeja.ts`): colar, arrastar, o botão e o print da transmissão; **só vai com Enter**.
- **Relatório** (`relatorio()` em `cliente.ts`): as últimas 15 mil linhas na memória, baixado em JSON pela pessoa. Acontecimento importante novo → `registrar`.
- **Teste de desempenho e gravação da sala** (`desempenho/`): **sem botão, de propósito**. Ctrl+Shift+X (teste simulado, `TesteDesempenho.tsx`), Ctrl+Shift+G (gravação da sala, `gravadorDaSala.ts`), e no app Ctrl+Shift+N (alterna entre a captura do app e a do Chromium).
  - O simulado cria espectadores com `RTCPeerConnection` locais (`criarSimulado`). Os vídeos precisam estar **na tela** (`requestVideoFrameCallback`).
  - A gravação da sala: o servidor (`Salas.gravador`, uma por sala) repassa as `medidas` de cada PC só para quem grava. Tudo é gerado num worker (`trabalhadorDaSala.ts`), que **não pode importar código com DOM**. Para em 2 h.
  - **O relatório para IA tem orçamento** (`LINHAS_DA_SALA`): ~45 mil tokens com 1 h e 4 pessoas. Não tire.
  - `analise.ts` tem todas as regras dos diagnósticos; os limites também estão no glossário do `relatorioIa.ts`: mude os dois. Mudou um campo dos dados? Suba `FORMATO`/`FORMATO_DA_SALA` em `tipos.ts`.
  - O processador vem do `app.getAppMetrics` (`percentCPUUsage` **já é** % do processador inteiro). A placa vem do `OzamigosSom.exe --contadores` (contadores "GPU Engine" pelo nome em inglês, `PdhAddEnglishCounter`).
- **Estatísticas:** `medir()` a cada 1 s. No Firefox, os Mbps são por `tipo:ssrc` (ids mudam a cada consulta).
- **Versão na tela** (`Versao.tsx`): a do app e o commit da interface (`__COMMIT__`, do `RENDER_GIT_COMMIT` no Docker ou do `git rev-parse`). Para conferir um deploy, compare com a `main`.
- Outros: tela acordada com mais alguém na sala (`telaAcordada.ts`); notificações por tipo, só com a janela fora de foco, guardando só as desligadas (`ozamigos-notificacoes-desligadas`); volume por nome (`ozamigos-volume:<nome>`); janela flutuante por `requestPictureInPicture()`.

## Site (`site/`)

- https://kayokalinauskas.github.io/ozamigos/, publicado pelo `site.yml` a cada push que mexe em `site/`.
- **Sem build e sem dependências.** Caminhos relativos, menos no `404.html` (`/ozamigos/...`).
- Funciona sem JavaScript; o `site.js` só melhora (link direto do instalador, "Usar no navegador" fora do Windows, acordar o servidor).
- **Duas línguas:** `site/index.html` e `site/en/index.html`. **Mudou uma, mude a outra, e confira as duas** antes de dizer que terminou.
- O `site.yml` põe `?v=<hash>` no CSS e no JS na publicação; no código-fonte, sem `?v=`. Ao conferir o publicado, use Ctrl+F5 ou `?nc=<número>`.
- **Privacidade (LGPD):** `site/privacidade.html` e `site/en/privacy.html` **descrevem o que o código faz de verdade**. Se o app ou o servidor passar a registrar algo novo (log com IP ou nome, mensagens, estatísticas), atualize as duas e a data. Hoje nenhum log tem IP (o único, o do bloqueio por senhas erradas, saiu com as senhas em 28/10/2026).
- Imagens em WebP com `srcset`, geradas de `docs/imagens` (veja "Imagens"). Nada de PNG grande no site.

## App Electron (`desktop/`)

- **Segurança, não afrouxe:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; permissões só para a origem do servidor (`PERMISSOES`); navegação para fora abre no navegador; **cada `ipcMain` confere a origem** com `origemDe(evento.senderFrame?.url)` (normaliza e não lança).
- **Endereço do servidor**, por prioridade: `OZAMIGOS_SERVIDOR` → `configuracao.json` em `%APPDATA%\Ozamigos Share` → `ozamigos.servidor` no `package.json`. Só `https://`, ou `http://` para `localhost`.
- **Janela sem barra de título** (`titleBarStyle: 'hidden'`, `titleBarOverlay`): a página reserva a faixa com `--barra-da-janela` (`env(titlebar-area-height)`); **nada clicável nos 32 px do topo** (`-webkit-app-region: drag`). Em tela cheia, `.janela-em-tela-cheia` zera a faixa. Sem menu, os atalhos de recarregar, tela cheia e DevTools ficam no `before-input-event`.
- **Recuperação:** a posição guardada só vale numa tela que existe (`posicaoVisivel`); a página que cai abre de novo (caindo de novo em 30 s, tela de início com o erro); navegar desliga os auxiliares.
- **Acordar o servidor:** antes de abrir a página, o `main.js` consulta `/actuator/health` (`esperarOServidor`); sem resposta em 1,5 s, a tela de início mostra "Conectando…". 502/503/504 contam como dormindo.
- **Convites `ozamigos://convite/CODIGO`** (1.3.1): o app instalado se registra ao abrir (a portátil não); o desinstalador limpa pelo `build/installer.nsh`. Aberto por um convite, o app começa na página dele (`/c/CODIGO`, `caminhoDoLink`); já aberto, a página recebe `abrir-convite` (`ponte.aoAbrirConvite` → `cliente.abrirConvite`: fora de uma sala vai ao convite, numa sala pergunta antes). **O link nunca traz o servidor** (levaria a pessoa e o login dela ao servidor de outra pessoa). No navegador do Windows, a página do convite pergunta antes (`AbrirNoApp.tsx`): ela não sabe se o app está instalado, então tenta o `ozamigos://` e observa se a janela perde o foco. Os links `ozamigos://sala/` de antes dos servidores chegam à página, que avisa que não valem mais.
- **Seletor de fontes:** `setDisplayMediaRequestHandler` → `escolher-fonte` → `SeletorDeFonte.tsx` responde com `fonte-escolhida`. Abre já em "carregando", antes de a lista chegar.
- **Captura de vídeo do app** (`desktop/captura/`, `OzamigosCaptura.exe`; na página, `videoDoApp.ts`), **a captura padrão no app:**
  - Windows Graphics Capture da janela (HWND do id `window:HWND:0`) ou da tela, com cursor e sem a borda amarela; reduz no processador de vídeo da placa e converte para NV12 BT.709 (`Conversor.cs`); escreve na saída padrão com cabeçalho de 24 bytes ("OZQ1"). Só manda quadro quando a imagem muda; parada, repete a cada 100 ms.
  - **Fluxo:** o seletor pede `captura`; o `main.js` liga o auxiliar, espera o primeiro quadro (até 4 s) e **recusa o `getDisplayMedia` de propósito**, devolvendo `videoDoApp: true`; a página usa a trilha de um `MediaStreamTrackGenerator`.
  - **Canal direto:** os quadros vão por um `MessageChannelMain` até um worker da página (`videoDoApp.worker.ts`), com no máximo 3 a caminho (`QUADROS_A_CAMINHO`). Pelo IPC comum, o atraso crescia sem parar em 1080p · 60.
  - **Volta para a captura do Chromium sozinha:** auxiliar que não abre, cai ou fica 3 s mudo (`capturarPelaFonte`, sem refazer conexões). A janela que fecha encerra a transmissão.
  - **Armadilhas:** o `MediaStreamTrackGenerator` só existe na janela (não em worker) neste Chromium; um `<video>` com trilha sem quadros segura o `load` da página; a trilha do app não aceita `applyConstraints`; o auxiliar **precisa de placa de vídeo** (por isso a fumaça dele pula no CI). Fechar a escrita do gerador dispara `ended` (o `pararVideoDoApp` tira o aviso antes).
  - As interfaces WinRT são chamadas **pela vtable** (`Wgc.cs`), sem a projeção do .NET: **ao acrescentar uma chamada, confira o índice no `.idl`/`winmd`** (0–2 IUnknown, 3–5 IInspectable). O auxiliar pede `MinUpdateInterval` (senão o Windows limita a ~52 fps num monitor de 155 Hz), não espera a placa ao ler (três texturas em rodízio), escreve numa thread própria e marca o processo contra a economia de energia. A bancada fica em `desktop/captura/bancada/`.
- **Atalhos globais** (`OzamigosSom.exe --atalhos`, `Atalhos.cs`): lê o estado das teclas a cada ~10 ms (`GetAsyncKeyState`). **Não troque por `globalShortcut` nem `RegisterHotKey`:** eles tiram a tecla do jogo e não avisam quando ela é solta. Um jogo aberto como administrador esconde as teclas.
- **Som do PC sem eco** (`desktop/som/`, `OzamigosSom.exe`):
  - loopback de processo (`VAD\Process_Loopback`, modo INCLUIR), **um processo por captura**: o auxiliar captura cada processo que toca som, menos o app (pela árvore de processos) e os de `SEM_SOM_DE` (`main.js`), e mistura. Quem tem um excluído entre os descendentes fica de fora; filho de processo já capturado não é capturado de novo; PIDs validados pela hora de criação.
  - Saída: float32 estéreo, 48 kHz, blocos de 10 ms. Saída de erro: `pronto` ou `sem-suporte`. **Entrada padrão fechada encerra o auxiliar** (é o que garante que ele morre com o app).
  - Na página, `somDoApp.ts` (AudioWorklet) vira uma trilha, por um canal direto (`som-canal`). A fila de cada programa mira 20 ms; a reserva do AudioWorklet mira 30 ms e acelera 2% acima de 60.
  - Sem o auxiliar (Windows antigo), vai o som do sistema inteiro (`audio: 'loopback'`).
  - Os COM também são chamados **por índice da vtable** (`Com.Metodo(obj, i)`), para o `.exe` poder ser *trimmed*.
- **Relógio fino** (`honrarRelogioFino`, `OzamigosSom.exe --relogio <pid>`): marca o processo principal com `PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION`. Sem isso, com a janela tapada ou minimizada, o Windows 11 tirava o relógio fino e a captura do Chromium caía para ~21 fps. **Não tire sem medir de novo** (a bancada: minimizar o app por 40 s capturando).
- **Login pelo navegador** (1.3.0; `loginPeloNavegador` no `main.js`, RFC 8252): o Google não deixa entrar em janela embutida. O app abre uma porta só no `127.0.0.1` (porta livre), sorteia um `estado` e abre `/conta/entrar/{provedor}?app=<porta>&estado=` no navegador do sistema; a volta só vale com o `estado` certo (senão 404), e a página troca o `codigo` pela sessão (`POST /api/conta/codigo`), no cookie da janela. Ligar outro provedor é igual, com `ligacao` (o código que a página pede em `POST /api/eu/ligacao`), mas **a ligação só vale quando a página do app confirma** (`POST /api/eu/ligacao/confirmar`) com o código que voltou à porta dela: sem isso, quem pedisse um código de ligação o mandaria num link, e quem o abrisse ligaria o próprio Discord à conta de quem mandou. O código de ligação sem `app` é recusado pelo mesmo motivo. Um login por vez, 5 min de prazo; dando certo, a janela vem para a frente. Funciona na portátil. **Não troque por login dentro da janela** (o Google recusa) nem pelo `ozamigos://` (a portátil não se registra). O teste no app de verdade troca o `shell.openExternal` por um "navegador" que segue o login.
- **Bandeja:** o X só esconde a janela (desliga em Configurações → Geral). **`saindo` é o que deixa a janela fechar** (`before-quit`, `session-end`): sem ele, a atualização e o desligamento do Windows ficam presos.
- **Não lidas:** número sobre o ícone da barra de tarefas (`setOverlayIcon`) e da bandeja (`marcaDoChat.js`, que precisa estar nos `files` do `package.json`), e o ícone pisca com a janela fora de foco.
- **Atualização automática** (`electron-updater`): ao abrir, confere o `latest.yml` da última release (6 s de prazo), mostra `atualizando.html`, baixa e `quitAndInstall(true, true)`. Só no app instalado. **Não feche o aviso antes de criar a janela principal** (o app encerraria). O app não é assinado: **não configure `publisherName`**, ou toda atualização falha.

## Versões do app

- Mudou só `web/` ou `src/`: push na `main` e pronto (o app carrega a interface do servidor).
- Mudou `desktop/`: aumente `version` em `desktop/package.json`, faça commit e push, e envie a marca (`git tag vX.Y.Z`, `git push origin vX.Y.Z`). O `release.yml` confere a marca, gera e publica os dois `.exe`, o `latest.yml` e o `.blockmap`. **Sem `latest.yml` e `.blockmap`, nenhum app se atualiza.** Para refazer: `gh workflow run release.yml --ref vX.Y.Z`.
- Registre no `CHANGELOG.md` (Keep a Changelog).
- O `ci.yml` roda as cinco camadas de teste em cada push na `main` e em cada PR.

## Como testar (sem câmera nem jogo)

- **Várias pessoas num PC:** cada uma num contexto do navegador (o cookie da sessão é por contexto), logada no login de teste, no mesmo servidor salvo (veja "Contas" abaixo). Para a tela, troque `getDisplayMedia` por um `OffscreenCanvas` num Worker alimentando um `MediaStreamTrackGenerator` (um canvas na thread principal fica a 1 fps com o painel escondido). Para preencher campos do React, use o *setter* nativo de `value` e dispare `input`.
- Abas em segundo plano não decodificam vídeo: meça na aba da frente.
- **Electron em teste:** **nunca abra o app do repositório com a pasta de dados do dono** (é a mesma do app instalado: fecharia na hora, ou gravaria por cima da sessão da conta, dos volumes e da posição). Abra por um script que troca `userData` antes de `require('<repo>/desktop/main.js')`, e troque também o AppUserModelID (`dev.ozamigos.teste`); apague o `Electron.lnk` que sobrar. Controle pelo CDP (`--remote-debugging-port=9333`).
- **Medir a transmissão:** `getStats` a cada segundo nas duas pontas. Para ver o `encoderImplementation`, a página precisa de um microfone em uso. **Não use `--use-fake-ui-for-media-stream` ao medir captura** (troca a tela por uma falsa de 20 fps).
- **Som sem eco:** tons diferentes em processos diferentes (`Media.SoundPlayer` no PowerShell); para simular um app de chamada, uma cópia renomeada do `powershell.exe`. Silencie a aba de teste, senão o som recebido volta para a transmissão.
- **Contas e salas nos e2e:** toda sala é de um servidor salvo, e entrar pede conta. O `e2e/infra.ts` (globalSetup) sobe em Docker um Postgres e o "Google" falso (mock-oauth2-server, `OZAMIGOS_GOOGLE_EMISSOR`) e o servidor na **8090**; sem o Docker, os e2e não rodam. `e2e/conta.ts` faz o login (`entrarComOGoogle`) e a sala (`entrarNaSala`: o primeiro cria o servidor e um convite, os outros aceitam), cada pessoa de um endereço próprio (`CF-Connecting-IP`), senão o freio dos logins segura. Para olhar à mão: o README (o banco do `compose.yaml`, o mock na 8091 e o servidor com as variáveis). O login do app (porta no `127.0.0.1`) tem fumaça própria no `desktop/teste/app.e2e.js`.
- **E2e que estoura o tempo no PC em uso:** o `.\testar.ps1` completo, com o dono usando o PC, às vezes perde um e2e da sala por tempo (1 min), um diferente a cada rodada, que passa rodado sozinho (`npx playwright test -g "<nome>"` em `web`). O CI é a referência: passou lá, está certo (o dono, 28/10/2026). Um e2e que falha sempre, ou também no CI, é defeito.
- **Simular o deploy:** clone limpo, `npm ci` e `npm run build` em `web`, `mvnw -DskipTests package`, jar com `PORT=10000`. O WebSocket dá 101 com a mesma origem e 403 com outra.

## Imagens

`docs/imagens` (README) e `site/imagens` são geradas com a interface de verdade. **Refaça quando a interface mudar de cara:**

1. Servidor na **8090** com o banco e o login de teste: `docker compose up --build`. O `captura.js` entra cada amigo com uma conta (o login de teste, cada um de um endereço próprio, pelos freios) no servidor salvo "Ozamigos", que a Ana cria. **Rode com o PC livre** (sem jogos, navegador pesado ou compilações): são cinco PCs num só, e com o processador ocupado as transmissões travam e a foto sai com "instável" (o script avisa e fotografa assim mesmo; confira antes de usar).
2. `desktop\node_modules\.bin\electron docs\vitrine\captura.js`: cinco amigos fictícios com "jogos" desenhados por código (**nunca imagem de jogo de verdade**); gera as telas e o `demo.gif` (precisa do ffmpeg).
3. `desktop\node_modules\.bin\electron docs\vitrine\marca.js`: logotipos claro e escuro e a `social.png`.
4. `node docs\vitrine\site.js`: WebP nas larguras do site.

## Armadilhas

- **Endereço guardado vence o do instalador**, e desinstalar não apaga. Ao trocar o endereço oficial, **ponha o antigo em `SERVIDORES_APOSENTADOS`** (`main.js`).
- **Cache da interface:** o jar data os arquivos de 1980. Três proteções, **não remova nenhuma**: `Cache-Control: no-cache` sem `Last-Modified` em tudo menos `/assets/**` (`CacheConfig`); o app pede com `no-cache`; e apaga o cache HTTP na primeira abertura de cada versão (`limparCacheSeAtualizou`).
- **"Live" no Render não garante a interface nova:** confira o commit ao lado do logo; se vier o antigo, *Clear build cache & deploy*. O `ARG RENDER_GIT_COMMIT` no `Dockerfile` refaz a etapa da interface a cada commit.
- `src/main/resources/static/` é gerada: `localhost` dando 404 é falta de `npm run build` em `web`.
- O `.gitignore` ignora `build/`; `desktop/build/` é liberada com `!desktop/build/`.
- **Não rode `npx @electron/asar extract-file` dentro de `desktop/`** (sobrescreve o `package.json`).
- Num sandbox, o `%APPDATA%` que o terminal vê pode não ser o do app. Para ler o real, use um `.bat` aberto pelo `explorer.exe` ou `Ozamigos.exe --inspect=9229`.
- Nos *heredocs* do Git Bash, `\\n` vira quebra de linha real no código gerado: edite com as ferramentas de edição ou scripts em arquivo.

## Limitações conscientes (não são bugs)

- Retransmissão limitada à franquia gratuita: sem ela, CGNAT, 4G/5G e redes corporativas podem não conectar.
- Quem está em cada sala fica na memória, num servidor só (os servidores, os membros e os convites ficam no banco).
- Cada pessoa nova assistindo liga mais um codificador e congela a imagem dos outros por ~¼ s, uma vez.
- O instalador não tem assinatura digital (o SmartScreen avisa).
