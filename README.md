<br>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/imagens/logo-tema-escuro.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/imagens/logo-tema-claro.png">
    <img src="docs/imagens/logo-tema-claro.png" alt="Ozamigos" width="340">
  </picture>
</p>

<h3 align="center">Transmita seu jogo para os amigos, direto de um PC para o outro.</h3>

<p align="center">
  Até 1080p, sem servidor de vídeo no meio. App para Windows e versão web, com salas protegidas por senha,<br>
  várias transmissões ao mesmo tempo e som do PC sem o eco do Discord.
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/badge/Baixar%20para%20Windows-b6f24a?style=for-the-badge" alt="Baixar para Windows" height="34"></a>
  <a href="https://kayokalinauskas.github.io/ozamigos/"><img src="https://img.shields.io/badge/Conhecer%20o%20site-1f261c?style=for-the-badge" alt="Conhecer o site" height="34"></a>
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/kayokalinauskas/ozamigos?style=flat-square&label=vers%C3%A3o&color=b6f24a" alt="Última versão"></a>
  <a href="../../actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kayokalinauskas/ozamigos/ci.yml?branch=main&style=flat-square&label=CI" alt="Estado do CI"></a>
  <a href="../../releases"><img src="https://img.shields.io/github/downloads/kayokalinauskas/ozamigos/total?style=flat-square&label=downloads&color=1f261c" alt="Total de downloads"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-1f261c?style=flat-square" alt="Windows 10 e 11">
  <img src="https://img.shields.io/badge/Java-25-1f261c?style=flat-square" alt="Java 25">
  <img src="https://img.shields.io/badge/Spring%20Boot-4.1-1f261c?style=flat-square" alt="Spring Boot 4.1">
  <img src="https://img.shields.io/badge/React-19-1f261c?style=flat-square" alt="React 19">
  <img src="https://img.shields.io/badge/Electron-44-1f261c?style=flat-square" alt="Electron 44">
  <img src="https://img.shields.io/badge/v%C3%ADdeo-WebRTC%20P2P-1f261c?style=flat-square" alt="Vídeo por WebRTC P2P">
  <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-b6f24a?style=flat-square" alt="Licença MIT">
</p>

<p align="center">
  <a href="#recursos">Recursos</a> ·
  <a href="#como-funciona">Como funciona</a> ·
  <a href="#rodar-localmente">Rodar localmente</a> ·
  <a href="#deploy-no-render">Deploy</a> ·
  <a href="#publicar-uma-versão-do-app">Publicar uma versão</a> ·
  <a href="CHANGELOG.md">Novidades</a>
</p>

---

## Sumário

- [Recursos](#recursos)
- [Instalação (para quem só vai usar)](#instalação-para-quem-só-vai-usar)
- [Como funciona](#como-funciona)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Requisitos de desenvolvimento](#requisitos-de-desenvolvimento)
- [Rodar localmente](#rodar-localmente)
- [Deploy no Render](#deploy-no-render)
- [Publicar uma versão do app](#publicar-uma-versão-do-app)
- [O que fazer quando algo muda](#o-que-fazer-quando-algo-muda)
- [Configuração](#configuração)
- [Protocolo de sinalização](#protocolo-de-sinalização)
- [Qualidade, banda e diagnóstico](#qualidade-banda-e-diagnóstico)
- [Segurança](#segurança)
- [Testes](#testes)
- [Problemas comuns](#problemas-comuns)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

---

## Recursos

<table>
  <tr>
    <td width="50%"><img src="docs/imagens/sala-grade.png" alt="Sala em grade com quatro transmissões ao vivo e a lista de quem está na sala"></td>
    <td width="50%"><img src="docs/imagens/sala-destaque.png" alt="Uma transmissão em destaque, as outras ao lado e o painel de estatísticas aberto"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Grade:</b> até 4 transmissões lado a lado, e quem está ao vivo na lateral</sub></td>
    <td align="center"><sub><b>Destaque:</b> uma grande, as outras ao lado, e as estatísticas de cada conexão</sub></td>
  </tr>
</table>

**Na sala**
- **Presença em tempo real:** quem está na sala, quem está **ao vivo** e quantas pessoas assistem cada transmissão.
- **Assistir sob demanda:** você escolhe uma ou mais transmissões. O vídeo só sai do PC de quem transmite para quem clicou em **Assistir**, o que poupa o upload e a placa de vídeo de quem transmite.
- **Todos podem transmitir ao mesmo tempo**, em salas de até 5 pessoas.
- **Layouts:** **Grade**, com tudo lado a lado, ou **Destaque**, com uma transmissão grande e as outras em miniatura. Dois cliques no vídeo abrem a tela cheia, e o botão **Janela flutuante** solta a transmissão numa janelinha que fica por cima do jogo.
- **Áudio por transmissão:** volume e silenciar de cada uma, lembrados por amigo, mais um volume geral.
- **Qualidade ajustável ao vivo:** 1080p ou 720p, a 30 ou 60 fps, sem derrubar ninguém. Cada transmissão mostra um indicador de saúde (verde, amarelo ou vermelho), e o painel de **Estatísticas** mostra fps, resolução, taxa, codificador e o motivo de qualquer queda.
- **Avisos:** quando alguém entra ou começa a transmitir, aparece um aviso com o botão **Assistir**. Há sons curtos, que dá para desligar, e notificação do Windows quando o app está atrás do jogo.
- **Volta automática:** se quem você assiste para e volta a transmitir, você volta a assistir sem clicar em nada.
- **Reconexão automática:** se a internet oscilar ou o servidor reiniciar, o app volta sozinho para a sala. Quem transmitia continua transmitindo, e quem assistia continua assistindo. As transmissões já abertas não param enquanto isso.

**Só no app para Windows**
- **Seletor próprio** de janelas e telas, com miniaturas e ícones.
- **Som do PC sem eco:** captura o som de todos os programas, menos o **Discord** e o próprio **Ozamigos**. Os amigos não ouvem a própria voz nem o próprio jogo de volta. O áudio vai em estéreo.
- **Sem engasgos atrás do jogo:** a janela não é freada pelo Windows quando fica escondida.
- **Atualização automática da interface:** o app carrega a interface do servidor, então cada deploy chega a todos sem reinstalar.
- **O app se atualiza sozinho** (a partir da 1.2.0, na versão instalada): ao abrir, ele procura uma versão nova nas releases, baixa, instala e abre de novo. A versão portátil continua sendo atualizada à mão.

---

## Instalação (para quem só vai usar)

1. Baixe o `Ozamigos-Instalador-x.y.z.exe` na [última versão](../../releases/latest).
2. Abra o arquivo. Se o Windows mostrar **"O Windows protegeu o computador"**, clique em **Mais informações** e depois em **Executar assim mesmo**. O instalador não tem assinatura digital paga.
3. Entre com o seu nome e a **senha do grupo**, que quem administra o servidor passa para você.

<p align="center"><img src="docs/imagens/entrada.png" alt="Tela de entrada com nome, senha do grupo e código da sala" width="640"></p>

**Sem instalar:** use o `Ozamigos-Portatil-x.y.z.exe`, que abre com dois cliques.

**Pelo navegador:** abra o endereço do servidor no Chrome ou no Edge. A entrada tem um link para o [site](https://kayokalinauskas.github.io/ozamigos/), que apresenta e baixa o app para Windows. Pelo navegador dá para assistir e transmitir, mas o som do PC vai inteiro, sem a exclusão do Discord.

**Requisitos:** Windows 10 (versão 2004 ou mais nova) ou Windows 11, 64 bits.

---

## Como funciona

O vídeo nunca passa pelo servidor. O servidor Java só apresenta as pessoas umas às outras (sinalização por WebSocket) e confere a senha. Depois disso, cada PC manda o vídeo direto para quem pediu, por WebRTC.

```mermaid
flowchart LR
    subgraph Render["Servidor (Render)"]
        S["Spring Boot<br/>salas · senha · sinalização"]
        UI["Interface web<br/>(React, servida pelo Spring)"]
    end
    A["App Windows<br/>(quem transmite)"] -- WebSocket --> S
    B["App ou navegador<br/>(quem assiste)"] -- WebSocket --> S
    A -. carrega a interface .-> UI
    B -. carrega a interface .-> UI
    A == "vídeo + áudio (WebRTC P2P)" ==> B
```

**Assistir sob demanda:** quem transmite só abre uma conexão de vídeo para quem pediu.

```mermaid
sequenceDiagram
    participant V as Quem assiste
    participant S as Servidor
    participant T as Quem transmite
    V->>S: assistir {para: T}
    S->>T: assistir {de: V}
    S-->>V: plateia {id: T, ids: [...]}
    S-->>T: plateia {id: T, ids: [...]}
    T->>S: oferta (SDP)
    S->>V: oferta
    V->>S: resposta (SDP)
    S->>T: resposta
    Note over V,T: candidatos ICE vão e voltam pelo servidor
    T-->>V: vídeo e áudio direto (P2P)
```

**Som do PC sem o Discord.** O Windows 10 (2004+) e o 11 capturam o som **de um programa (e dos que ele abriu) por vez**. O auxiliar `OzamigosSom.exe` (C#), que vai dentro do instalador:

1. confere, a cada 2 segundos, quais programas estão tocando som, em todas as saídas ativas;
2. captura cada um deles com o *loopback* de processo do Windows, menos o Discord (`Discord.exe`, `DiscordPTB.exe`, `DiscordCanary.exe`) e o processo do próprio app;
3. mistura tudo a 48 kHz em estéreo e entrega ao app pela saída padrão.

No app, um `AudioWorklet` transforma esse fluxo numa faixa de áudio que vai junto com o vídeo. O auxiliar:
- roda sem janela;
- liga quando a transmissão com som começa e desliga quando ela para;
- fecha sozinho se o app fechar.

Num Windows que não tenha esse recurso, o app volta a mandar o som do sistema inteiro.

---

## Estrutura do repositório

```text
.
├── src/                    Servidor Java (Spring Boot)
│   ├── main/java/dev/ozamigos/
│   │   ├── SinalizacaoHandler.java   WebSocket /sinal: entrada, plateias e repasse de SDP/ICE
│   │   ├── Salas.java                Estado das salas em memória (participantes e plateias)
│   │   ├── SenhaDoGrupo.java         Senha do grupo (variável de ambiente, comparação em tempo constante)
│   │   └── WebSocketConfig.java      Registro do /sinal e limite de mensagem
│   └── test/                         Testes (JUnit + AssertJ)
├── web/                    Interface (React 19 + TypeScript + Vite)
│   └── src/
│       ├── cliente.ts                Núcleo: sinalização, WebRTC, qualidade e estatísticas
│       ├── somDoApp.ts               Faixa de áudio do auxiliar de som (AudioWorklet)
│       ├── ponte.ts                  Contrato com o app Electron
│       └── componentes/              Entrada, Sala, BarraLateral, Palco, Transmissao, ...
├── site/                   Site de apresentação em português e inglês (en/), publicado no GitHub Pages
├── desktop/                App para Windows (Electron 44)
│   ├── main.js                       Janela, permissões, seletor de fontes e auxiliar de som
│   ├── preload.js                    Ponte segura entre a página e o app
│   ├── inicio.html|js|css            Tela de escolher o servidor
│   ├── build/                        Ícone (e o script que o gera) e a fonte do logotipo
│   └── som/                          Auxiliar de som em C# (.NET 10): OzamigosSom.exe
├── docs/imagens/           Logotipo, telas e GIF de demonstração deste README
├── docs/vitrine/           Scripts que geram as imagens de docs/imagens
├── .github/                CI, release do app, site, Dependabot e modelos de issue e PR
├── CHANGELOG.md            Histórico de versões do app
├── Dockerfile              Build em 3 etapas: Node (interface) → JDK (servidor) → JRE (imagem final)
└── pom.xml
```

O build da interface (`web/`) grava em `src/main/resources/static/`. A pasta não é versionada; o Dockerfile a monta no deploy.

---

## Requisitos de desenvolvimento

| Ferramenta | Versão | Para quê |
|---|---|---|
| JDK | 25 | Servidor. O Maven vem pelo `mvnw`, sem instalar |
| Node.js | 22 ou mais novo | Interface e app Electron |
| .NET SDK | 10 | Compilar o auxiliar de som. Só para gerar o instalador |
| GitHub CLI (`gh`) | qualquer recente | Criar repositório e releases (opcional) |
| Chrome ou Edge | atual | Testar pelo navegador |

---

## Rodar localmente

Os comandos estão em PowerShell, um por linha, a partir da raiz do repositório.

**1. Monte a interface** (de novo sempre que mexer em `web/`):
```powershell
cd web
npm install
npm run build
cd ..
```

**2. Suba o servidor:**
```powershell
$env:OZAMIGOS_SENHA = "teste"
.\mvnw.cmd spring-boot:run
```
Abra `http://localhost:8080` e entre com a senha `teste`.

**3. (Opcional) Interface com recarga instantânea.** Com o servidor rodando, numa outra janela do terminal:
```powershell
cd web
npm run dev
```
Abra `http://localhost:5173`. O Vite repassa o WebSocket `/sinal` para a porta 8080.

**4. (Opcional) O app Electron apontando para o seu PC:**
```powershell
cd desktop
npm install
npm run som
npm start
```
Na tela de início, use `http://localhost:8080`. O app só aceita `http://` para `localhost`; qualquer outro endereço precisa de `https://`.

**Testar o som sem eco no mesmo PC:** a aba do navegador onde você faz o papel do amigo não está na lista de exclusão. Silencie a transmissão nessa aba, senão o som recebido volta para a transmissão. Para ouvir de verdade, use outro PC na mesma rede (`http://IP-DO-SEU-PC:8080`).

---

## Deploy no Render

1. **Tenha o código num repositório seu:** faça um *fork* deste no GitHub, ou envie uma cópia com:
   ```powershell
   gh repo create ozamigos --private --source=. --push
   ```
2. No [Render](https://dashboard.render.com), clique em **New** → **Web Service** e escolha o repositório. Se ele não aparecer, clique em **Configure account** e libere o acesso a ele no GitHub.
3. Preencha:
   - **Name:** o nome vira o endereço (`ozamigos` → `https://ozamigos.onrender.com`);
   - **Language:** Docker;
   - **Branch:** `main`;
   - **Instance Type:** Free (ou Starter, para não dormir).
4. Em **Environment Variables**, adicione `OZAMIGOS_SENHA` com a senha do grupo.
5. Clique em **Deploy Web Service**. O build leva de 5 a 10 minutos e termina com `Tomcat started on port 10000` no log.

A cada `git push` na `main`, o Render publica de novo sozinho. Depois, coloque o endereço do seu serviço em `desktop/package.json` (`ozamigos.servidor`) e gere o instalador: é o endereço com que o app abre.

**Plano Free:**
- O serviço dorme depois de 15 minutos sem uso e leva cerca de 1 minuto para acordar.
- Enquanto alguém está numa sala, o ping do app a cada 30 segundos o mantém acordado.
- Um deploy ou reinício derruba as salas abertas por alguns segundos; o app reconecta sozinho.

---

## Publicar uma versão do app

**1. Configure o endereço do servidor** em `desktop/package.json`:
```json
"ozamigos": {
  "servidor": "https://ozamigos.onrender.com"
}
```

**2. Aumente a versão** em `desktop/package.json` (ex.: `"version": "1.0.2"`).

**3. Grave, envie o código e a marca da versão:**
```powershell
git add desktop/package.json
git commit -m "App 1.0.2: o que mudou"
git push
git tag v1.0.2
git push origin v1.0.2
```

**4. Pronto.** A marca `v1.0.2` dispara o workflow [`.github/workflows/release.yml`](.github/workflows/release.yml), que, numa máquina Windows do GitHub:
- confere se a marca bate com a versão do `desktop/package.json`;
- compila o auxiliar de som (.NET) e empacota o app (electron-builder);
- cria a release com o `Ozamigos-Instalador-1.0.2.exe` e o `Ozamigos-Portatil-1.0.2.exe`, mais o `latest.yml` e o `.blockmap`, que o app instalado lê para se atualizar sozinho.

Acompanhe na aba **Actions** do repositório (leva de 5 a 10 minutos) ou com `gh run watch`.

> **Custo:** repositório público não gasta nada. Repositório privado usa a cota grátis do GitHub Actions (2.000 minutos por mês no plano Free; a máquina Windows conta em dobro). Sem cartão cadastrado, o GitHub não cobra: se a cota acabar, o workflow só para até o mês seguinte.

**Gerar na sua máquina** (para testar o instalador antes, ou sem o GitHub):
```powershell
cd desktop
npm install
npm run instalador
```
Em `desktop\dist` saem o `Ozamigos-Instalador-x.y.z.exe` (instala com atalhos e entra em "Adicionar ou remover programas") e o `Ozamigos-Portatil-x.y.z.exe` (roda sem instalar). Para publicar à mão: `gh release create v1.0.2 desktop\dist\Ozamigos-Instalador-1.0.2.exe desktop\dist\Ozamigos-Portatil-1.0.2.exe --title "Ozamigos 1.0.2" --generate-notes`.

**Para corrigir uma release errada:** apague a release e a marca (o código não é afetado) e crie de novo.
```powershell
gh release delete v1.0.1 --cleanup-tag --yes
```

**Link fixo para os amigos:** `https://github.com/kayokalinauskas/ozamigos/releases/latest` (sempre a versão mais nova).

---

## O que fazer quando algo muda

| Mudou… | Precisa | Os usuários precisam… |
|---|---|---|
| Interface (`web/`) ou servidor (`src/`) | `git push` (o Render publica sozinho) | Nada; no máximo Ctrl+R no app |
| App (`desktop/`: `main.js`, `preload.js`, tela de início, auxiliar de som, ícone, endereço) | Aumentar a versão, `git push` e enviar a marca `vX.Y.Z` (o GitHub gera a release) | Nada: o app instalado se atualiza sozinho na próxima vez que abrir (a partir da 1.2.0). Quem usa a versão portátil, ou ainda está numa versão anterior à 1.2.0, baixa o `.exe` novo e instala por cima (as configurações continuam) |
| Senha do grupo | Editar `OZAMIGOS_SENHA` no Render (**Environment**) | Digitar a senha nova |

---

## Configuração

**Servidor**

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `OZAMIGOS_SENHA` | sim | — | Senha do grupo. Sem ela, o servidor não sobe |
| `PORT` | não | `8080` | Porta HTTP. O Render define `10000` |

**App para Windows**

| Onde | O quê |
|---|---|
| `desktop/package.json` → `ozamigos.servidor` | Endereço do servidor que vem no instalador |
| `%APPDATA%\Ozamigos Share\configuracao.json` | Endereço escolhido pela pessoa (tem prioridade) e posição da janela. A pasta mantém o nome antigo do app, para ninguém perder as configurações |
| `desktop/main.js` → `SEM_SOM_DE` | Programas cujo som nunca vai na transmissão |
| Variável `OZAMIGOS_SERVIDOR` | Força um endereço, útil em testes |

**Limites do servidor**

| Limite | Valor |
|---|---|
| Pessoas por sala | 5 |
| Código da sala | 6 a 20 letras e números |
| Nome exibido | até 20 caracteres (vazio vira "Amigo") |
| Mensagem de sinalização | até 64 KB |

---

## Protocolo de sinalização

WebSocket em `/sinal`, com mensagens JSON que têm sempre o campo `tipo`. O servidor carimba o remetente (`de`) em tudo o que repassa; o cliente nunca informa quem ele é.

**Cliente → servidor**

| `tipo` | Campos | Efeito |
|---|---|---|
| `entrar` | `sala`, `senha`, `nome`, `ficha` (opcional) | Confere a senha e entra na sala. Na reconexão, a `ficha` recebida no `bem-vindo` anterior tira da sala a conexão antiga, se o servidor ainda não percebeu a queda |
| `comecei` / `parei` | — | Começa ou para de transmitir |
| `assistir` / `deixar` | `para` | Entra ou sai da plateia de quem transmite |
| `oferta` / `resposta` / `candidato` | `para`, `sdp` ou `candidato`, `canal` | Repassado só ao destinatário, na mesma sala |
| `ping` | — | Mantém a conexão viva (a cada 30 s); o servidor responde `pong` |

**Servidor → cliente**

| `tipo` | Campos | Quando |
|---|---|---|
| `bem-vindo` | `id`, `ficha`, `outros[]`, `compartilhando[]`, `plateias{}` | Ao entrar. A `ficha` é secreta: só quem a recebeu pode usá-la para reconectar |
| `pong` | — | Resposta ao `ping`. Sem nenhuma mensagem por 70 s, o cliente considera a conexão morta e reconecta |
| `entrou` / `saiu` | `id` (e `nome`) | Alguém entrou ou saiu |
| `pode-compartilhar` | — | Confirma o `comecei` |
| `compartilhando` / `parou` | `id` | Alguém começou ou parou de transmitir |
| `plateia` | `id`, `ids[]` | Mudou quem assiste uma transmissão |
| `assistir` / `deixar` | `de` | (para quem transmite) alguém quer assistir ou desistiu |
| `oferta` / `resposta` / `candidato` | `de`, ... | Repasse do WebRTC |
| `erro` | `motivo` | `senha-errada`, `sala-cheia`, `codigo-invalido`, `ja-esta-numa-sala`, `destinatario-nao-esta-na-sala`, ... |

Com `senha-errada` e `sala-cheia`, o servidor fecha a conexão logo depois de avisar.

---

## Qualidade, banda e diagnóstico

Cada pessoa que assiste é mais um vídeo saindo do PC de quem transmite. O codec de vídeo preferido é o H.264, codificado pela placa de vídeo; o áudio vai em Opus estéreo, a até 128 kbps.

| Qualidade | Upload por pessoa assistindo | Quando usar |
|---|---|---|
| 1080p · 30 fps (padrão) | ~6 Mbps | Imagem nítida, metade do trabalho do PC |
| 1080p · 60 fps | ~10 Mbps | Jogos rápidos, com upload sobrando |
| 720p · 60 fps | ~6 Mbps | Fluidez com menos banda |
| 720p · 30 fps | ~4 Mbps | Internet fraca |

Exemplo: em 1080p a 30 fps para 4 amigos, são cerca de 25 Mbps de upload. Nos primeiros 15 a 25 segundos, uma resolução menor é normal: o WebRTC está medindo a rede.

**Fps baixo ou travando.** Abra **Estatísticas** no PC de quem transmite:

| O que aparece | Significado | O que fazer |
|---|---|---|
| `Captura` abaixo da qualidade escolhida | O jogo ocupa a placa de vídeo inteira | Limite o fps do jogo (60 é o ideal) e use "janela sem bordas" |
| `Limite: processador / placa de vídeo` | O codificador não dá conta | 720p, fps do jogo limitado, driver atualizado |
| `Limite: internet` / `Banda estimada` baixa | O upload não aguenta | Baixe a qualidade, use cabo ou tenha menos gente assistindo |
| Indicador vermelho só em quem assiste | A internet de quem assiste | Cabo ou Wi-Fi mais perto do roteador |

---

## Segurança

- **Senha do grupo:**
  - fica só na variável de ambiente e nunca no código;
  - é conferida antes de qualquer outra coisa, então quem erra não descobre nada sobre a sala;
  - é comparada em tempo constante.
- **Origem do WebSocket:** só páginas servidas pelo próprio servidor conseguem abrir o WebSocket (checagem de origem do Spring).
- **Remetente carimbado:** o servidor diz quem enviou cada mensagem (`de`) e só repassa dentro da mesma sala.
- **App Electron:**
  - roda com `contextIsolation`, `sandbox` e sem `nodeIntegration`;
  - a página só acessa as funções da `preload.js`, e o `main.js` confere a origem de cada pedido;
  - permissões (tela, notificações, tela cheia) só valem para o endereço do servidor configurado;
  - links externos abrem no navegador.
- **Nomes:** aparecem como texto, nunca como HTML.

---

## Testes

```powershell
.\mvnw.cmd test
```

Os testes cobrem:
- o limite de pessoas por sala;
- o que quem chega depois recebe (transmissões e plateias);
- as regras de plateia;
- a senha do grupo;
- a subida da aplicação.

Na interface (`cd web`):

```powershell
npm test           # Vitest: código e link da sala, preferências guardadas e opções de qualidade
npm run typecheck  # tipos
```

O workflow [CI](.github/workflows/ci.yml) roda tudo isso em cada push na `main` e em cada pull request: os testes e o build da interface, os testes do servidor e a checagem dos scripts do app. O workflow [Site](.github/workflows/site.yml) publica a pasta `site/` no [GitHub Pages](https://kayokalinauskas.github.io/ozamigos/) sempre que ela muda. O site não tem build: é HTML, CSS e um script pequeno que só melhora a página (link direto do instalador, versão e tamanho). Sem JavaScript, os botões continuam funcionando. O [Dependabot](.github/dependabot.yml) abre pull requests quando sai versão nova das dependências.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Servidor não sobe: "Defina a senha do grupo…" | Falta `OZAMIGOS_SENHA` | Defina a variável (no Render, em **Environment**) |
| `localhost:8080` dá 404 | Interface não montada | `cd web`, depois `npm install` e `npm run build` |
| App diz "Não foi possível abrir…" | Endereço errado, sem internet ou Render acordando | Confira o endereço; espere 1 minuto e clique em **Conectar** |
| App abre num endereço antigo | O endereço guardado tem prioridade sobre o do instalador | Ícone de servidor na sala, ou Alt → **Trocar o servidor** |
| Amigos ouvem o próprio som de volta | Transmissão pelo navegador (som do PC inteiro) | Transmita pelo app para Windows |
| Voz de chamada vai junto | Programa fora da lista (ex.: Discord no navegador) | Use o Discord instalado ou acrescente o programa em `SEM_SOM_DE` |
| Vídeo preto com o jogo em tela cheia | Tela cheia exclusiva não é capturável | "Janela sem bordas" ou transmita a tela inteira |
| "Não foi possível conectar direto com…" | 4G/5G, CGNAT ou rede corporativa | Outra rede. Esses casos exigem TURN (veja Limitações) |
| "A conexão com o servidor caiu. Reconectando…" | Render reiniciou ou a internet caiu | Espere: o app tenta de novo sozinho (1, 2, 5 e depois a cada 10 s). **Tentar agora** força uma tentativa |
| Comando com `&&` falha no terminal | O PowerShell 5 não aceita `&&` | Use `;` ou um comando por linha |

---

## Limitações conhecidas

- **Sem servidor TURN:** quem está atrás de CGNAT, em 4G/5G ou em rede corporativa pode não conseguir conectar. O TURN repassa o vídeo e tem custo por GB.
- **Senha única por servidor:** pensada para grupos de amigos, cada grupo com o próprio deploy. Para uso público, seriam necessários senha por sala e limite de tentativas.
- **Estado em memória:** as salas vivem num servidor só. Para mais de um servidor, seria preciso um armazenamento compartilhado (ex.: Redis).
- **Exclusão de som por grupo de processos:** programas abertos *a partir* do Discord ou do Ozamigos também ficam de fora. Jogos abertos pela Steam, pela Epic ou pelo menu Iniciar não são afetados.
- **Programa que começa a tocar no meio:** o som dele entra na transmissão em até 2 segundos.
- **Instalador sem assinatura digital:** o SmartScreen avisa na primeira execução.
- **Atualização da versão portátil:** o app instalado se atualiza sozinho (desde a 1.2.0), mas a versão portátil exige baixar o arquivo novo.

---

## Licença

Distribuído sob a [licença MIT](LICENSE): pode usar, copiar, modificar e distribuir, inclusive para fins comerciais, desde que o aviso de copyright e a licença acompanhem as cópias. O software é fornecido sem garantia.

**Marca:** a licença MIT vale para o código, não para a marca. O nome **Ozamigos**, o ícone "Tecla oz" e o logotipo pertencem a kayokalinauskas. Se você publicar uma versão modificada, use outro nome e outro ícone, para ninguém confundir com o app original.

A fonte Sora, usada no logotipo, é distribuída sob a [SIL Open Font License 1.1](desktop/build/sora-licenca-OFL.txt).
