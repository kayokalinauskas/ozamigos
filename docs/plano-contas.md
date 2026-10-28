# Plano: contas, servidores salvos e salas

Plano de execução para o Ozamigos ganhar contas (login com Google e Discord), um banco de dados e servidores que
ficam salvos, no estilo do Discord. Escrito em 27/10/2026, a partir do código de hoje. **Nada aqui está feito ainda.**

## Como o trabalho anda (decisão do dono, 27/10/2026)

**A fase 1 em três PRs para o `contas`:** (1) `contas-login`, o servidor: contas, sessões, login, API, a conta na
sala, a retransmissão só com conta, a privacidade; (2) a interface e o app: os botões de login, Configurações → Conta,
a foto na sala, o login do app pelo navegador; (3) o ponta a ponta com o mock-oauth2-server e o teste no app de verdade.

- Tudo isto fica no branch **`contas`**, com um PR em rascunho para a `main`. **Nada vai para o ar pela metade:** cada
  push na `main` é um deploy no Render.
- Partes de uma fase entram no `contas` por PRs próprios (branches `contas-...`), com o CI rodando em cada um.
- O `contas` entra na `main` só com uma fase completa para quem usa: **a fase 0 vai junto com a fase 1**, porque
  sozinha não muda nada para ninguém. Depois, cada fase é um merge.
- As variáveis do banco e do login podem ser criadas no Render antes do merge: sem o código novo, ele as ignora.
- Correções do dia a dia continuam direto na `main`; o `contas` recebe a `main` por merge de tempos em tempos.

## Princípios (valem para todas as fases)

1. **Voz e vídeo continuam diretos entre os PCs.** O banco guarda só o que precisa sobreviver a um reinício: contas,
   servidores, salas, membros e convites. Quem está em cada sala agora, quem transmite e a sinalização continuam na
   memória, como hoje (`Salas`).
2. **Custo zero, sem cartão.** Nenhum serviço novo pede forma de pagamento.
3. **O mínimo de dados pessoais.** Sem e-mail, sem senha, sem IP no banco. Do Google e do Discord vêm só o id da conta,
   o nome e a foto.
4. **O modo de hoje continua.** Link + senha, sem conta: quem só quer entrar rápido (o celular, um amigo de passagem)
   entra como convidado. O grupo fixo `/ozamigos` e os grupos criados na hora continuam iguais.
5. **Cada fase termina funcionando e em produção**, com testes, documentação (`AGENTS.md`, `docs/protocolo.md`,
   `CHANGELOG.md`) e, quando muda o que se guarda, a privacidade nas duas línguas.
6. **O chat continua sem histórico.** Guardar mensagens é o que mais pesa em banco, privacidade e moderação; fica fora
   deste plano.

## Decisões técnicas

| Assunto | Decisão | Por quê |
|---|---|---|
| Banco | **PostgreSQL** | Padrão, grátis em vários lugares, roda igual no Docker local e na nuvem |
| Onde fica o banco | **Supabase, plano grátis** (500 MB, sem cartão), em **East US (North Virginia)**, a região do Render | O banco é consultado pelo servidor, não pelas pessoas: o que importa é ficar perto do Render (que não tem região no Brasil). Usado só como Postgres puro, sem os extras do Supabase, para poder trocar de lugar (Neon, Oracle) sem reescrever nada |
| Acesso ao banco | **`JdbcClient`** do Spring, com SQL escrito à mão | Explícito, sem a mágica do JPA (carregamento preguiçoso, sessões), combina com o estilo do código |
| Esquema | **Flyway**, migrações versionadas em `src/main/resources/db/migracao/` | O esquema muda junto com o código, e cada mudança fica no git |
| Login | **Spring Security OAuth2 Client**: Google (escopos `openid profile`) e Discord (`identify`) | Sem guardar senha de ninguém, sem e-mail de confirmação nem "esqueci a senha". Os escopos **não pedem o e-mail** |
| Sessão | **Spring Session JDBC** (sessões no Postgres), cookie `__Host-ozamigos`, `HttpOnly`, `Secure`, `SameSite=Lax`, 30 dias | O Render reinicia a cada deploy e quando dorme: sessão na memória deslogaria todo mundo |
| Login no app (Electron) | **Pelo navegador do sistema, com pareamento** (detalhes abaixo) | O Google bloqueia login dentro de janelas embutidas (`disallowed_useragent`) |
| Docker | `compose.yaml` com **app + Postgres** para rodar tudo localmente com um comando; o `Dockerfile` atual continua sendo o do deploy | O mesmo contêiner roda no Render, no PC ou numa VPS/Oracle no futuro |
| Testes do servidor | **Testcontainers** (Postgres de verdade em Docker) | O Docker já está instalado no PC, e os runners do GitHub têm Docker |
| Testes e2e do login | **mock-oauth2-server** (contêiner que imita um provedor OAuth) | Testa o fluxo inteiro **sem porta dos fundos no código de produção** |
| Backup | GitHub Action semanal: `pg_dump` **criptografado** (chave nos *secrets*), guardado como artefato por 90 dias | O Supabase grátis não faz backup. O repositório é público: sem criptografia, o backup ficaria visível |

### Cuidados que já sabemos

- **Saúde do servidor:** com um banco, o `/actuator/health` passa a incluir o banco. Se o Supabase pausar ou cair, o
  Render acharia que o servidor caiu e o app mostraria "Conectando…" para sempre. **O health continua só do servidor**
  (`management.health.db.enabled=false`), e as telas que dependem do banco mostram um erro próprio.
- **O banco fora do ar não derruba as salas:** convidados, o grupo fixo e os grupos criados na hora funcionam sem banco.
  Só o login e os servidores salvos ficam indisponíveis.
- **Supabase pausa depois de 7 dias sem uso:** o próprio servidor faz uma consulta leve por dia.
- **Conexões:** a conexão direta do Supabase grátis é só IPv6, que o Render não tem. Vai pelo **Session pooler** (IPv4),
  com um pool pequeno (Hikari com 5).

## O que entra e o que fica de fora

### Entra (decidido)

| Fase | Feature |
|---|---|
| 1 | Login com Google e Discord; perfil com nome e foto; sair; apagar a conta |
| 1 | Login no app pelo navegador, com pareamento |
| 1 | **Retransmissão só para quem tem conta**, contada por conta além de por endereço |
| 2 | Servidores salvos: criar, renomear, ícone, apagar |
| 2 | Membros com papéis: **dono**, **admin**, **membro**; expulsar; sair do servidor |
| 2 | Convites com código, validade e limite de usos; entrar sem senha sendo membro |
| 2 | Lista dos meus servidores na entrada (no lugar de "a última sala") |
| 3 | Várias salas de voz por servidor, criadas pelo dono e pelos admins |
| 3 | Ver quem está em cada sala do servidor sem entrar, e trocar de sala com um clique |
| 4 | Amigos (pedido, aceitar, remover) e quem está online |
| 4 | Chamar um amigo para a sala de qualquer lugar do app |

### Fica de fora (por enquanto)

| Feature | Motivo |
|---|---|
| Histórico do chat, salas de texto, mensagens diretas | Banco, privacidade e moderação: um projeto à parte |
| Login com e-mail e senha | Envio de e-mails, recuperação de senha, guardar senhas |
| Permissões finas por sala, cargos personalizados | Três papéis bastam para grupos de amigos |
| Bots, integrações, webhooks | Sem demanda |
| Servidor público / descoberta de servidores | Precisa de moderação |
| Fotos e anexos guardados no servidor | As imagens do chat continuam diretas entre os PCs |
| Mais de 8 pessoas por sala | O limite é o upload de quem transmite, não o servidor |

## Fase 0: fundação (sem nada novo para o usuário)

**Objetivo:** o servidor ganha banco, migrações e Docker, sem mudar nada do que as pessoas veem.

1. `compose.yaml` na raiz: serviços `banco` (Postgres 18, volume nomeado, healthcheck) e `ozamigos` (o `Dockerfile`
   atual, porta 8090, `OZAMIGOS_SENHA=teste`). `docker compose up` sobe tudo.
2. `pom.xml`: `spring-boot-starter-jdbc`, `spring-boot-starter-flyway` + `flyway-database-postgresql`, driver
   `postgresql`; nos testes, `testcontainers-postgresql`.
3. Primeira migração `V1__inicio.sql` (só a tabela de controle; as tabelas reais vêm em cada fase).
4. **O banco é opcional:** sem `OZAMIGOS_BANCO_URL`, o servidor sobe como hoje (sem login nem servidores salvos), igual à
   retransmissão sem as variáveis. Assim o deploy da fase 0 não depende de o banco já existir.
5. Health sem o banco; consulta diária para o Supabase não pausar.
6. `testar.ps1` e `ci.yml`: os testes do servidor com Testcontainers.
7. Workflow `backup.yml` (semanal, criptografado).

**Variáveis novas:** `OZAMIGOS_BANCO_URL`, `OZAMIGOS_BANCO_USUARIO`, `OZAMIGOS_BANCO_SENHA`.

**Passos do dono:** criar a conta no Supabase (sem cartão) e o projeto na região do Render (Render → *Settings →
Region*); pôr as três variáveis no Render; criar o *secret* `BACKUP_CHAVE` no GitHub.

**Pronto quando:** `docker compose up` funciona do zero; o Render sobe com o banco e loga as migrações; os testes passam
no CI; um backup de teste é restaurado num Postgres local.

## Fase 1: contas

**Objetivo:** entrar com Google ou Discord, ter um perfil, e o nome na sala vir da conta.

### Tabelas

```sql
usuarios    (id uuid, nome text, foto bytea null, criado_em, visto_em)
identidades (provedor text, id_externo text, usuario_id uuid, primary key (provedor, id_externo))
pareamentos (id text, resumo_do_segredo bytea, usuario_id uuid null, expira_em)   -- login do app
-- + as tabelas do Spring Session
```

- `nome`: vem do provedor no primeiro login, editável (as mesmas regras do `nomeLimpo` de hoje).
- `foto`: baixada do provedor **uma vez**, reduzida no servidor para 128 px, JPEG até 16 KB (o mesmo código das prévias
  de links). Ninguém da sala acessa o Google ou o Discord para ver a foto do outro; servida em `/api/fotos/{id}`.
- Uma pessoa pode ligar as duas contas (Google e Discord) ao mesmo usuário, logada, em Configurações → Conta. Sem
  e-mail, não há como ligar sozinho, e isso é de propósito.

### Fluxo no navegador

1. "Entrar com Google/Discord" → `/oauth2/authorization/google` (o Spring cuida do `state` e do PKCE).
2. Volta em `/login/oauth2/code/{provedor}` → cria ou acha o usuário → sessão no cookie.
3. A página pede `/api/eu` e sabe quem está logado.

### Fluxo no app (Electron)

Decidido na implementação (27/10/2026): **o redirecionamento para o 127.0.0.1, da RFC 8252** (a recomendação para apps
nativos), no lugar do pareamento por consulta. No pareamento, um link de login forjado por outra pessoa podia fazer a
vítima logar o app *do atacante*; com o 127.0.0.1, o código só chega ao PC de quem fez o login.

1. O app (processo principal) abre um servidor HTTP só no `127.0.0.1`, numa porta livre, e sorteia um `estado`.
2. Abre o navegador do sistema em `/conta/entrar/{provedor}?app=<porta>&estado=<estado>`. A pessoa faz o login normal.
3. No fim, o servidor manda o navegador para `http://127.0.0.1:<porta>/login?codigo=<código>&estado=<estado>`. O
   código vale 2 minutos, uma vez só, e só existe na memória do servidor.
4. O app confere o `estado`, mostra "Pode voltar para o Ozamigos" no navegador, fecha a porta e passa o código para a
   página, que o troca pela sessão (`POST /api/conta/codigo`), no cookie da janela do app.

Funciona no instalado e na versão portátil (sem depender do `ozamigos://`). **Muda `desktop/`**: sai uma versão nova
do app. Um app antigo não tem o botão de login (a página confere se a ponte tem a função).

### Na sala

- Logado, o `entrar` vai sem `nome`: o servidor usa o da conta (ninguém entra com o nome de outro). O WebSocket
  `/sinal` lê a sessão do cookie no *handshake*.
- Convidado continua como hoje. **Sem selo de "convidado"** na lista (decidido na implementação, 27/10/2026): com quase
  todos convidados no começo, seria ruído; quem tem conta se destaca pela foto.
- O volume por pessoa passa a ser guardado pelo id da conta (`ozamigos-volume:u:<id>`), e a reconexão reconhece a
  pessoa pela conta. Resolve a limitação de hoje: dois amigos com o mesmo nome.

### Telas

- Entrada: "Entrar com Google", "Entrar com Discord" e "Entrar como convidado".
- Configurações → **Conta**: nome, foto (a do provedor, ou só as iniciais), contas ligadas, **sair**, **apagar a conta**
  (apaga tudo na hora; os servidores de que a pessoa é dona passam para o admin mais antigo, senão para o membro mais antigo; vazios, somem).

### Segurança

- APIs só com `Content-Type: application/json` e conferindo o `Origin` (contra CSRF, junto com o `SameSite=Lax`).
- Freio de logins e de pareamentos por endereço (como `TentativasDeSenha`).
- O log diz o id e o nome de quem logou, nunca tokens nem o id externo.

### Retransmissão só para contas (decisão do dono, 27/10/2026)

- O `bem-vindo` só traz credenciais da retransmissão para quem está logado. Corta o abuso anônimo: hoje, qualquer um
  com o link do grupo fixo, ou que crie um grupo, pode gastar a franquia.
- Os limites por pessoa passam a contar **a conta e o endereço** (o que chegar primeiro): trocar de rede não renova o
  limite, e várias contas no mesmo endereço também não.
- Convidado que não consegue conexão direta vê: "Não foi possível conectar com {nome}. Entre com sua conta para usar
  a conexão de reserva." (o mesmo tom de hoje, sem bastidores).
- **Efeito no amigo do Rio:** ele precisa entrar com Google ou Discord. Avisar antes do deploy.

### Passos do dono

- **Google Cloud Console:** criar o projeto, a tela de consentimento (nome "Ozamigos", link da privacidade do site) e o
  cliente OAuth "Aplicativo da Web", com o retorno `https://<servidor>/login/oauth2/code/google`. Só com `openid
  profile`, não precisa de verificação do Google (com logo na tela de consentimento, o Google pode pedir verificação da
  marca: deixar sem logo no começo).
- **Discord Developer Portal:** criar o aplicativo, OAuth2 com o retorno `https://<servidor>/login/oauth2/code/discord`.
- Pôr no Render: `OZAMIGOS_GOOGLE_ID`, `OZAMIGOS_GOOGLE_SEGREDO`, `OZAMIGOS_DISCORD_ID`, `OZAMIGOS_DISCORD_SEGREDO`.

### Privacidade

Atualizar `site/privacidade.html` e `site/en/privacy.html`: o que se guarda (id do provedor, nome, foto reduzida,
datas), onde (o banco, com o provedor e o país), por quanto tempo (até apagar a conta), como apagar, e que **não** se
guarda e-mail, senha nem IP.

**Pronto quando:** login com os dois provedores no navegador e no app instalado e portátil (testado no Electron de
verdade, com `userData` isolado); apagar a conta apaga tudo; e2e com o mock-oauth2-server; privacidade publicada.

## Fase 2: servidores salvos

**Objetivo:** criar um servidor que não some, convidar amigos e entrar sem senha.

### Tabelas

```sql
servidores (id uuid, codigo text unique, nome text, icone bytea null, dono_id uuid, criado_em)
membros    (servidor_id, usuario_id, papel text check (papel in ('dono','admin','membro')), entrou_em)
convites   (codigo text, servidor_id, criado_por, expira_em null, usos_maximos null, usos int)
```

- Endereço `/s/<codigo>` (código curto aleatório): não disputa nome com os grupos de hoje (`/nome`).
- Limites: cada pessoa cria até 10 servidores e participa de até 100; até 100 membros por servidor; até 20 convites
  ativos por servidor.
- Papéis: o **dono** apaga o servidor e passa a posse; o **admin** convida, expulsa membros, cria e renomeia salas; o
  **membro** entra e convida (se o dono deixar).
- Ícone: como a foto, reduzido no servidor.
- Decidido na implementação (28/10/2026): o dono é o membro de papel `dono` (sem coluna própria); renomear e trocar o
  ícone são do dono e dos admins; apagar a conta passa o servidor ao admin mais antigo, **senão ao membro mais antigo**
  (some só se ficar vazio); um convite gasto ainda leva ao servidor quem já é membro.
- **Expulsar também bloqueia** (decisão do dono, 28/10/2026): quem foi expulso não volta por convite nenhum até o dono ou
  um admin desbloquear, numa lista de bloqueados nas configurações do servidor.

### Entrada

- Logado, a entrada mostra **"Meus servidores"** (a última sala usada primeiro). Substitui a "última sala" para quem tem
  conta; a entrada automática do app passa a ser "voltar ao último servidor".
- Convite `https://<servidor>/c/<codigo>` (e `ozamigos://convite/<codigo>`): sem conta, pede o login antes; com conta,
  vira membro e entra.
- Os grupos de hoje continuam, **descartáveis** (decisão do dono, 27/10/2026): qualquer um, até convidado, cria um
  grupo na hora, e ele some quando o servidor reinicia. Quem quer um lugar fixo cria um servidor salvo. Mais tarde,
  um botão "salvar este grupo" pode transformar um grupo criado na hora num servidor salvo.

### Protocolo

`entrar` ganha `servidor` (o código) e `salaDoServidor`; o servidor confere na hora que a pessoa é membro (sem senha).
Expulsar alguém tira a pessoa da sala na hora (`expulso`).

**Pronto quando:** criar, convidar, entrar, expulsar e apagar funcionam; o servidor reinicia e tudo continua lá; testes
das regras de papel (quem pode o quê) no servidor.

## Fase 3: várias salas por servidor

**Objetivo:** como os canais de voz do Discord.

- Tabela `salas (id, servidor_id, nome, posicao)`; cada servidor nasce com "Geral"; até 20 salas.
- Barra lateral com as salas do servidor e quem está em cada uma, **sem entrar**: um canal leve de presença por
  servidor (mensagem `presenca`), só para membros.
- Trocar de sala com um clique, sem refazer o WebSocket: sair de uma sala e entrar na outra na mesma conexão.
  **É a parte mais delicada:** hoje o cliente assume uma sala por conexão (`cliente.ts`, voz e reconexão).
- O limite de 8 por sala continua; o servidor não tem limite de pessoas, só cada sala.

**Pronto quando:** trocar de sala não perde a voz de quem fica; a presença atualiza em até 1 s; e2e com duas salas.

## Fase 4: amigos

- Tabela `amizades (de, para, estado: pedido|amigos)`. Pedido pelo perfil de alguém de um servidor em comum, ou por um
  link de amizade.
- Online/ausente/em sala: só na memória, por um canal de presença por pessoa (sem histórico).
- "Chamar para a sala": a mesma chamada de hoje, mas para um amigo que está em outro lugar do app.

## Ordem, tamanho e riscos

| Fase | Tamanho | Precisa de versão nova do app? | Maior risco |
|---|---|---|---|
| 0 | Pequena | Não | Conexão Render ↔ Supabase (região, pool) |
| 1 | Grande | **Sim** (login pelo navegador) | Fluxo do Electron; aprovação do Google |
| 2 | Média | Não (só `ozamigos://convite`, que pode ir na mesma versão da fase 1) | Regras de papel |
| 3 | Grande | Não | Trocar de sala sem quebrar a voz e a reconexão |
| 4 | Média | Não | Presença em escala |

**Riscos gerais:**
- **Banco grátis some ou muda as regras:** Postgres puro, backup semanal e migrações no git; trocar de provedor é
  restaurar o backup e mudar três variáveis.
- **Render grátis dorme:** a primeira consulta depois de acordar é mais lenta (pool frio). Aceitável; a entrada já
  mostra "Conectando…".
- **Vazamento do banco:** sem senhas, sem e-mails, sem IPs; o que vazaria são nomes, fotos e quem é membro de quê.
- **LGPD:** a pessoa apaga a própria conta na hora, sem pedir a ninguém.

## Decisões do dono (27/10/2026)

1. O Render está em **Virginia (US East)**: o Supabase vai em East US (North Virginia).
2. A retransmissão passa a ser **só para quem tem conta**, já na fase 1.
3. Convidados continuam **criando grupos na hora, descartáveis** (somem quando o servidor reinicia).
