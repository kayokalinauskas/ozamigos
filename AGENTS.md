# AGENTS.md — guia para agentes de código

Este arquivo explica o projeto para quem vai mexer no código (pessoas ou agentes). O `README.md` é para quem usa e publica; aqui ficam as regras, os contratos e as armadilhas.

## O que é

Ozamigos: transmissão de tela de jogos entre amigos, em até 1080p, **P2P por WebRTC**.

São três peças num repositório só:

| Pasta | Tecnologia | Papel |
|---|---|---|
| `src/` | Java 25, Spring Boot 4.1 (Jackson 3: `tools.jackson.*`) | Salas, senha do grupo, sinalização por WebSocket em `/sinal`. **O vídeo nunca passa por aqui.** Serve a interface pronta |
| `web/` | React 19, TypeScript 7, Vite 8 | Interface. O build vai para `src/main/resources/static/` (não versionado) |
| `desktop/` | Electron 44 + auxiliar C# (.NET 10) em `desktop/som/` | App Windows: carrega a interface **do servidor** (`loadURL`) e acrescenta seletor de fontes, som do PC sem Discord, notificações |

Deploy: Render (Docker). O `Dockerfile` tem 3 etapas: Node monta `web/`, o JDK compila, e a imagem final roda no JRE. O Render publica a cada push na `main`.

## Convenções do projeto (siga sempre)

- **Idioma:** código, identificadores, comentários, mensagens de commit e textos da interface em **português do Brasil**. Os comentários explicam o *porquê*, no tom dos já existentes.
- **Commits:** adicione **caminhos explícitos** (`git add caminho/arquivo`), nunca `git add -A` ou `git add .`. Faça push só quando pedirem.
- **Terminal do dono:** é o PowerShell 5.1, que **não aceita `&&`**. Nas instruções para ele, use um comando por linha ou `;`.
- **Testes:** só o básico (JUnit no servidor). As mudanças de comportamento se verificam rodando o app (veja "Como testar").
- **Telas prioritárias:** 1920×1080 e 2560×1440. A interface é tema escuro, com os tokens CSS em `web/src/estilo.css`.
- **Segredos:** a senha do grupo vem só da variável `OZAMIGOS_SENHA`. Nunca coloque segredos no código.

## Marca

- **Nome:** "Ozamigos" (até a 1.0.2 era "Ozamigos Share"). O nome novo vale para tudo o que o usuário vê. O repositório público é `kayokalinauskas/ozamigos`. O antigo, `ozamigos-share-app`, ficou privado e parado, com o histórico anterior à troca do e-mail dos commits. Os nomes internos ficam como estão: o pacote `dev.ozamigos`, o `OzamigosSom.exe`, a variável `OZAMIGOS_SENHA`, as chaves `ozamigos-*` do `localStorage` e o endereço no Render.
- **Não mude:**
  - o `appId` (`dev.ozamigos.share`): com ele, o instalador novo reconhece e substitui o antigo;
  - a pasta de dados `%APPDATA%\Ozamigos Share`, fixada com `app.setPath('userData', ...)` no topo do `main.js`. Sem isso, o nome novo levaria o Electron para uma pasta vazia e todos perderiam o servidor, o nome, a senha e os volumes.
- **Ícone "Tecla OZ":** uma tecla de teclado com o "O" claro e o "z" verde no canto. A geometria (em 96×96) existe em **dois lugares, que precisam ficar iguais**: `web/public/icone.svg` (favicon) e `desktop/build/gerar-icone.js`, que desenha o `desktop/build/icone.png` (ícone do app e do instalador; rode `npm run icone` em `desktop`).
- **Logotipo:** "O" e "Z" em teclas (`.tecla`, com a borda de baixo verde fazendo a lateral) seguidos de "amigos", na fonte Sora. Na interface, vem do pacote `@fontsource-variable/sora` (`Logo.tsx`); na tela de início do app, de `desktop/build/sora.woff2` (licença OFL ao lado).
- **Paleta Lima** (tokens em `web/src/estilo.css`, repetidos em `desktop/inicio.css`): fundo grafite esverdeado (`--fundo` `#0b0e0a`) e destaque verde-limão (`--destaque` `#b6f24a`). **Texto em cima do verde é escuro** (`--no-destaque`), nunca branco. O vermelho continua reservado para "ao vivo" (`--ao-vivo`).

## Comandos (PowerShell, a partir da raiz)

```powershell
# Interface (sempre que mexer em web/)
cd web; npm install; npm run build; cd ..
# Verificar tipos
cd web; npm run typecheck; cd ..
# Servidor local
$env:OZAMIGOS_SENHA = "teste"
.\mvnw.cmd spring-boot:run
# Testes do servidor
.\mvnw.cmd test
# App Electron em desenvolvimento (compila o auxiliar de som antes)
cd desktop; npm install; npm run som; npm start
# Instalador e versão portátil (desktop\dist); compila o auxiliar também
cd desktop; npm run instalador
```

**Porta 8080:** o dono costuma ter outro projeto rodando nela. Para testes, prefira outra porta (`$env:PORT = "8090"`) e **não mate processos que você não abriu**.

**Servidor de teste servindo a interface direto da pasta,** para não refazer o jar a cada build da interface:
```powershell
java -jar target\ozamigos-share-0.0.1-SNAPSHOT.jar --spring.web.resources.static-locations=file:src/main/resources/static/ --spring.web.resources.cache.period=0
```

## Arquitetura e contratos importantes

### Servidor (`src/main/java/dev/ozamigos/`)

- `Salas`: estado **em memória**, com todos os métodos `synchronized`.
  - Cada sala guarda `participantes` (id → sessão), `nomes` e `plateias` (quem transmite → quem assiste).
  - **Existir uma chave em `plateias` é o que significa "está transmitindo".**
  - Limite: `LIMITE_POR_SALA = 5`.
- `SinalizacaoHandler`:
  - **a senha é conferida antes de tudo**; quem erra recebe `senha-errada` e a conexão é fechada;
  - o servidor **carimba `de`** em tudo o que repassa (o cliente nunca diz quem é) e só repassa dentro da mesma sala;
  - os envios usam `ConcurrentWebSocketSessionDecorator` (a sessão "segura").
- `WebSocketConfig`: **sem `setAllowedOrigins`**. Só páginas do próprio servidor conectam; o app Electron funciona porque carrega a interface do servidor. Mensagens de texto vão até 64 KB.
- Protocolo completo: seção "Protocolo de sinalização" do `README.md`. **Se mudar o protocolo, mude o servidor, o `web/src/cliente.ts` e o README juntos.**

### Interface (`web/src/`)

- `cliente.ts` é o núcleo, sem React: um *store* com `inscrever`/`ler` consumido por `useSyncExternalStore` (`useCliente`). Os componentes só leem o estado e chamam as ações.
- **Duas conexões por par, uma por sentido:** a chave é `${canal}:${id}`, com `canal` igual a `'envio'` (minha tela para a pessoa) ou `'recebimento'` (a tela dela para mim).
  - O candidato ICE carrega o `canal` **do ponto de vista de quem mandou**, e quem recebe inverte (`envio` ↔ `recebimento`). Não remova essa inversão.
  - Quem transmite **sempre** é quem faz a oferta; isso evita colisão de ofertas (*glare*).
- **Assistir sob demanda:**
  1. quem quer assistir manda `assistir {para}`;
  2. o servidor põe a pessoa na plateia, avisa quem transmite (`assistir {de}`) e manda `plateia` para todos;
  3. quem transmite cria a conexão de envio e faz a oferta;
  4. quem assiste só aceita a oferta se ainda estiver em `estado.assistindo`.
- **`assistindo` é intenção, não conexão:** a pessoa continua na lista quando quem transmite para. Quando chega `compartilhando` dessa pessoa, o cliente manda `assistir` sozinho (volta automática). A pessoa só sai da lista com `deixarDeAssistir` ou com `saiu`.
- **Trocar a fonte não renegocia:** a conexão é sempre criada com um *transceiver* de áudio (mesmo sem áudio no momento), e a troca usa `replaceTrack`.
- **Qualidade:** `QUALIDADES` em `qualidade.ts`. A troca vale ao vivo, via `setParameters` (`maxBitrate`, `maxFramerate`, `scaleResolutionDownBy`, `degradationPreference`) e `applyConstraints` na captura. O codec preferido é H.264 (hardware). O Opus vai em estéreo pela edição do SDP (`opusEstereo`), aplicada **na oferta e na resposta**.
- **Estatísticas:** `medir()` roda a cada 1 s.
  - O Firefox não informa `qualityLimitationReason`, o fps da captura nem `encoderImplementation`.
  - O Firefox gera ids de relatório novos a cada consulta, então os Mbps são calculados por `tipo:ssrc`.
- **Reconexão automática** (`perderConexao` → `agendarReconexao` → `conectar`; `voltei` no `bem-vindo` seguinte):
  - a queda é detectada pelo `onclose` **ou** pelo silêncio: o servidor responde `pong` a cada `ping` (30 s), e 70 s sem mensagem nenhuma (`SILENCIO_MAXIMO`) derrubam a conexão do lado do cliente;
  - tentativas com espera de 1, 2, 5 e depois 10 s, para sempre; o evento `online` do navegador força uma tentativa;
  - o `bem-vindo` traz uma `ficha` secreta. Na reconexão, o `entrar` a reenvia, e o servidor (`Salas.donoDaFicha`) **tira da sala a conexão antiga** que ele ainda não viu cair (senão sobra uma pessoa fantasma ocupando vaga);
  - **o id muda na reconexão.** Por isso, quem volta é reconhecido **pelo nome** (`saidas`, janela de 2 min): `voltei` fecha todas as conexões WebRTC, reenvia `comecei` se eu transmitia e volta a assistir quem eu assistia; do outro lado, `saiu` + `entrou` com o mesmo nome vira "reconectou", e `compartilhando` dessa pessoa retoma a plateia;
  - durante a queda, as conexões WebRTC abertas **continuam** (o vídeo não passa pelo servidor); elas só são refeitas quando a sinalização volta;
  - recusado ao reconectar (`senha-errada`, `sala-cheia`): desfaz tudo e volta para a entrada com o erro.
- **Janela flutuante:** `requestPictureInPicture()` no `<video>` da transmissão (funciona no Chrome, no Edge e no Electron). O volume continua valendo, porque é o mesmo elemento.
- **Volume:** é o `video.volume` (de 0 a 1, multiplicado pelo volume geral), lembrado por **nome** (`ozamigos-volume:<nome>`).
- O `localStorage` está sempre dentro de `try/catch` (`armazenamento.ts`).

### App Electron (`desktop/`)

- **Segurança, não afrouxe:**
  - `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`;
  - permissões só para a origem do servidor configurado;
  - navegação para fora abre no navegador;
  - cada `ipcMain` confere a origem de quem pediu (`origemDe(evento.senderFrame?.url)`).
  - Use sempre `origemDe()`: ela normaliza (`http://x/` vira `http://x`) e não lança exceção.
- **Endereço do servidor, em ordem de prioridade:**
  1. a variável `OZAMIGOS_SERVIDOR`;
  2. o `configuracao.json` em `%APPDATA%\Ozamigos Share`, gravado pela tela de início (a pasta guarda o nome antigo de propósito: veja "Marca");
  3. `ozamigos.servidor` no `desktop/package.json`.
- O app só aceita `https://`, ou `http://` para `localhost`.
- **Seletor de fontes:** `setDisplayMediaRequestHandler` lista as fontes e manda `escolher-fonte` para a página; o `SeletorDeFonte.tsx` responde com `fonte-escolhida` (`invoke`), que devolve `{ somDoApp }`.
- **Som do PC sem eco** (`desktop/som`, C#):
  - O `OzamigosSom.exe` usa o *loopback* de processo do Windows (`ActivateAudioInterfaceAsync`, `VAD\Process_Loopback`, modo INCLUIR). O Windows só aceita **um processo por captura**, por isso o auxiliar captura cada processo que toca som, menos os excluídos (Discord por nome; o app pelo PID principal, com toda a árvore de processos), e mistura tudo.
  - **Regras da árvore de processos:**
    - capturar um processo leva junto os filhos dele;
    - quem tem um processo excluído entre os descendentes fica de fora;
    - quem é filho de outro processo já capturado não é capturado de novo, para o som não sair dobrado.
    - Os PIDs são validados pela hora de criação, porque o Windows reaproveita números.
  - **Saída:** float32 estéreo, 48 kHz, intercalado, em blocos de 10 ms, pela saída padrão. A saída de erro manda `pronto` (quando começou) ou `sem-suporte`. **Entrada padrão fechada faz o auxiliar terminar**, e é isso que garante que ele morre junto com o app.
  - No `main.js`, o caminho do áudio é: `ligarAuxiliarDeSom()` (que nunca abre dois ao mesmo tempo), depois os quadros inteiros de 8 bytes vão por IPC (`som`) até o `somDoApp.ts`, onde um `AudioWorklet` (com reserva de 40 ms e corte acima de 150 ms) vira um `MediaStreamTrack` adicionado à tela capturada.
  - **Fallback:** se o auxiliar não subir (Windows antigo), o `main.js` responde com `audio: 'loopback'`, que é o som do sistema inteiro.
  - Os COM do Windows são chamados **por índice da vtable** (`Com.Metodo(obj, i)`), sem a interop embutida do .NET, para o `.exe` poder ser *trimmed*. **Ao acrescentar uma chamada, confira o índice no cabeçalho do Windows** (0–2 são as funções básicas de COM).
  - A lista de exclusão é `SEM_SOM_DE`, em `desktop/main.js`.
- **Atualização automática** (`atualizarSeHouver()`, com `electron-updater`):
  - Ao abrir, antes da janela principal, o app confere o `latest.yml` da última release do GitHub (`build.publish` no `desktop/package.json`), com prazo de 6 s.
  - Havendo versão nova, mostra a janelinha `atualizando.html`, baixa e chama `quitAndInstall(true, true)`: instala sem tela e reabre o app.
  - Sem internet, sem versão nova ou com erro, segue abrindo normal; a próxima abertura tenta de novo.
  - Só no app instalado: em desenvolvimento (`!app.isPackaged`) e na versão portátil (`PORTABLE_EXECUTABLE_DIR`) não faz nada.
  - **Não feche o aviso antes de criar a janela principal**: sem janelas, o `window-all-closed` encerra o app.
  - O app não é assinado: o updater confere só o SHA-512 do `latest.yml`. Não configure `publisherName`, ou toda atualização vai falhar.

## Como testar (sem câmera nem jogo)

- **Várias pessoas num PC só:** abra várias abas em `http://localhost:<porta>/?sala=Teste01`.
  - Para simular a tela, troque `navigator.mediaDevices.getDisplayMedia` por uma tela falsa: um `OffscreenCanvas` num *Worker* gerando `VideoFrame`, que alimenta um `MediaStreamTrackGenerator`, mais um oscilador de `AudioContext` para o som. Com o painel escondido, um canvas comum na thread principal fica preso a 1 fps.
  - Para preencher campos do React, use o *setter* nativo de `value` e dispare o evento `input`.
- **Abas em segundo plano** mostram fps de recebimento perto de 0, porque o Chrome não decodifica vídeo de aba escondida. Para medir fps, use a aba da frente.
- **Electron:** rode `npx electron . --remote-debugging-port=9333` com `OZAMIGOS_SERVIDOR=http://localhost:<porta>` e controle a janela pelo CDP (`/json`, depois `Runtime.evaluate` e `Page.captureScreenshot`).
  - A janela aparece na tela do dono, que pode interagir com ela.
  - Ao clicar em botões que dependem de estado do React, espere uns 300 ms (o botão Transmitir do seletor só habilita depois de escolher uma fonte).
- **Som sem eco:** toque tons diferentes em processos diferentes (por exemplo, `Media.SoundPlayer` no PowerShell com WAVs de 440 Hz e 1200 Hz). Para simular o Discord, use uma cópia do `powershell.exe` renomeada para `Discord.exe`. Depois meça com `AnalyserNode` em quem recebe, silenciando o vídeo na aba de teste. **O navegador de teste também é capturado se não estiver silenciado**, e o som recebido volta para a transmissão.
- **Simular o deploy:** clone limpo; em `web`, `npm ci` e `npm run build`; na raiz, `mvnw -DskipTests package`; rode o jar com `PORT=10000`. O handshake do WebSocket deve dar 101 com a mesma origem e 403 com uma origem estranha.

## Imagens do README

O logotipo, as telas e o GIF em `docs/imagens` são gerados por scripts em `docs/vitrine`, com a interface de verdade. **Refaça-os quando a interface mudar de cara.**

1. Monte a interface (`npm run build` em `web`) e suba o servidor local na porta **8090** com a senha **teste**.
2. Na raiz: `desktop\node_modules\.bin\electron docs\vitrine\captura.js`. São janelas invisíveis, com o som mudo e as notificações bloqueadas.
   - Cinco amigos fictícios (Ana, Beto, Caio, Duda e Eli) entram na sala `Ozamigos26`, cada um transmitindo um "jogo" desenhado por código (`jogo-falso.js`). Nunca use imagem de jogo de verdade.
   - Saem `entrada.png`, `sala-grade.png`, `sala-destaque.png` e `demo.gif`. O GIF é montado pelo ffmpeg, que precisa estar no PATH.
   - No GIF, os cliques são eventos de mouse reais (`sendInputEvent`, para o `:hover` mostrar os controles), com um cursor desenhado por cima.
3. Depois: `desktop\node_modules\.bin\electron docs\vitrine\marca.js`. Ele gera o logotipo do topo do README em duas versões com fundo transparente, `logo-tema-escuro.png` e `logo-tema-claro.png`, escolhidas pelo `<picture>` conforme o tema do GitHub. Gera também a `social.png` (prévia de link, enviada à mão em *Settings* → *Social preview* no GitHub).

As janelas que ninguém fotografa rodam a 4 quadros por segundo, e os amigos fictícios não assistem uns aos outros. Sem isso, o PC fica sobrecarregado e as fotos saem com "instável" e congelamentos.

## Armadilhas conhecidas

- **Endereço do servidor guardado:** o `servidor` do `configuracao.json` vence o padrão do instalador, e desinstalar não apaga essa pasta. Por isso:
  - quem escolhe o endereço que já é o padrão não o tem guardado (`salvar-servidor`), e assim acompanha as mudanças de padrão;
  - **ao trocar o endereço oficial, ponha o antigo em `SERVIDORES_APOSENTADOS`** (em `main.js`). Quem o tiver guardado volta sozinho para o novo. Isso aconteceu na troca de `ozamigos-share-app.onrender.com` para `ozamigos.onrender.com`.
- **Os comandos do agente podem ver outra cópia do `%APPDATA%`:** num ambiente isolado (sandbox), o `configuracao.json` lido pelo terminal pode não ser o mesmo que o app usa quando aberto pelo atalho. Para ler o arquivo real, use um `.bat` aberto pelo `explorer.exe`, ou o inspetor do processo principal (`Ozamigos.exe --inspect=9229`).
- **Cache da interface:** o jar data todos os arquivos de 1980. Sem regra de cache, o navegador e o app guardavam o `index.html` por anos e mostravam a interface antiga depois de um deploy. Isso aconteceu na 1.1.1. Hoje há três proteções, **não remova nenhuma**:
  - o servidor manda `Cache-Control: no-cache`, sem `Last-Modified`, para tudo; só `/assets/**`, que tem hash no nome, recebe cache de um ano (`CacheConfig` e `application.properties`);
  - o app abre a página com `cache-control: no-cache` no pedido;
  - na primeira abertura de cada versão, o app apaga o cache HTTP (`limparCacheSeAtualizou`, com a versão anotada em `versaoDoCache` no `configuracao.json`). O `localStorage` não é apagado.
- O `.gitignore` da raiz ignora `build/`. A pasta `desktop/build/` (o ícone) é liberada com `!desktop/build/`. Arquivos novos nela continuam entrando.
- `src/main/resources/static/` é gerada pelo build e ignorada pelo git. Se `localhost` der 404, falta rodar `npm run build` em `web`.
- **Não rode `npx @electron/asar extract-file` dentro de `desktop/`:** ele grava `package.json` na pasta atual, por cima do arquivo real. Para inspecionar o `app.asar`, use `grep -a` ou extraia numa pasta temporária.
- Nos *heredocs* do Git Bash, `\\n` e `\\r` viram quebras de linha reais no Python ou no JS gerado. Para editar código, use as ferramentas de edição ou scripts em arquivo.
- O Render Free dorme depois de 15 min sem tráfego. O `ping` do WebSocket a cada 30 s mantém o serviço acordado com alguém na sala (isso ainda não foi medido por mais de 15 min). Um deploy reinicia o servidor e derruba as salas, mas as transmissões P2P já abertas continuam.
- O instalador não tem assinatura digital, então o SmartScreen avisa na primeira vez.

## Limitações conscientes (não são bugs)

- Sem TURN: CGNAT, 4G/5G e redes corporativas podem não conectar.
- Uma senha por servidor, sem limite de tentativas: o projeto não serve para uso público aberto sem antes mudar isso.
- Na reconexão, a pessoa ganha outro id e é reconhecida pelo nome. Dois amigos com o mesmo nome podem confundir a volta automática.
- Recarregar a página (Ctrl+R) não é reconexão: é uma entrada nova, e a volta automática a assistir não sobrevive a isso.
- Salas em memória, num servidor só.
- O volume é lembrado por nome; dois amigos com o mesmo nome dividem a configuração.

## Fluxo de versão do app

- Mudou `web/` ou `src/`: basta o push na `main`. A interface do app de todos se atualiza.
- Mudou `desktop/`:
  1. aumente `version` em `desktop/package.json`;
  2. faça commit e push;
  3. crie e envie a marca: `git tag vX.Y.Z` e `git push origin vX.Y.Z`.
  - O workflow `.github/workflows/release.yml` (máquina `windows-latest`) confere se a marca bate com a versão, roda `npm ci` e `npm run instalador` em `desktop/` e cria a release com os dois `.exe` (se a release já existir, só troca os arquivos).
  - O `npm run instalador` usa `--publish never`: quem publica é o `gh` do workflow, não o electron-builder.
  - **A release precisa ter o `latest.yml` e o `Ozamigos-Instalador-X.Y.Z.exe.blockmap`**, além dos `.exe`: sem eles, nenhum app instalado se atualiza. O workflow já envia os quatro.
  - Para refazer os arquivos de uma release que já existe: aba *Actions* → *Release do app* → *Run workflow*, escolhendo a tag em *Use workflow from* (`gh workflow run release.yml --ref vX.Y.Z`).
  - O repositório é público, então o Actions não tem custo. Mesmo assim, não cadastre forma de pagamento: o dono não aceita nenhum risco de cobrança.
