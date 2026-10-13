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
- **Ícone "Tecla oz":** uma tecla de teclado com "oz" na fonte Sora (peso 700), o "o" claro e o "z" verde (até a 1.2.6 eram um "O" oval desenhado e um "z" pequeno no canto, que lembrava "O₂"). A tecla ocupa o quadro inteiro, com fundo transparente: com uma placa escura em volta (até a 1.2.0) ela ficava menor que os outros ícones na barra de tarefas. As letras são contornos da fonte, em caminhos SVG (`LETRA_O` e `LETRA_Z`), e a geometria (em 96×96) existe em **dois lugares, que precisam ficar iguais**: `web/public/icone.svg` (favicon, copiado em `site/icone.svg`) e `desktop/build/gerar-icone.js`, que desenha o `desktop/build/icone.ico` (ícone do app, da janela e do instalador) e o `icone.png` de referência; rode `npm run icone` em `desktop`. O `.ico` tem cada tamanho, de 16 a 256, desenhado direto naquele tamanho (BMP até 128, PNG no 256): usar o PNG de 256 deixava torto o ícone de 16 da barra de título. O `site/imagens/icone-180.png` (ícone do iPhone) é o SVG fotografado em 180×180.
- **Logotipo:** a tecla "oz" do ícone, como SVG em linha (`.tecla-oz`, a mesma geometria, com `viewBox="4 5 88 87"` recortando a tecla), seguida de "amigos" na fonte Sora: a tecla tem 1,65 vez a altura do texto (22px no cabeçalho do site e na barra lateral). O SVG está repetido em `Logo.tsx`, no site (`index.html`, `en/index.html` e `404.html`), em `desktop/inicio.html`, `desktop/atualizando.html` e `docs/vitrine/marca.html`: se o ícone mudar, mude todos. A Sora vem do pacote `@fontsource-variable/sora` na interface, de `site/fontes/sora.woff2` no site e de `desktop/build/sora.woff2` na tela de início do app (licença OFL ao lado).
- **Paleta Lima** (tokens em `web/src/estilo.css`, repetidos em `desktop/inicio.css`): fundo grafite esverdeado (`--fundo` `#0b0e0a`) e destaque verde-limão (`--destaque` `#b6f24a`). **Texto em cima do verde é escuro** (`--no-destaque`), nunca branco. O vermelho continua reservado para "ao vivo" (`--ao-vivo`).

## Comandos (PowerShell, a partir da raiz)

```powershell
# Interface (sempre que mexer em web/)
cd web; npm install; npm run build; cd ..
# Verificar tipos e rodar os testes da interface (Vitest, DOM simulado com happy-dom)
cd web; npm run typecheck; npm test; cd ..
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
- **Qualidade:** `QUALIDADES` em `qualidade.ts`. A troca vale ao vivo:
  - o **tamanho e o fps saem da captura** (`tamanhoDaCaptura()`, no `getDisplayMedia` e no `applyConstraints`): o navegador reduz a imagem uma vez só, e não um codificador por amigo. Por isso `scaleResolutionDownBy` fica sempre em 1;
  - o codificador recebe `maxBitrate`, `maxFramerate` e `degradationPreference` por `setParameters`.
  - A "1080p · 30 fps" usa `maintain-resolution`: com `balanced`, uma queda curta da banda (Wi-Fi) a jogava para 720p por quase dois minutos.
  - O app desliga o descarte de quadros do WebRTC (`--force-fieldtrials=WebRTC-FrameDropper/Disabled/` no `main.js`). O codificador AMD passa do alvo em cena pesada e o descarte derrubava o envio para 5–9 fps por um segundo, com a captura em 21 (relatório real e A/B com o Path of Exile). Não remova. No navegador, o descarte continua.
  - O codec preferido é H.264 (hardware). O Opus vai em estéreo pela edição do SDP (`opusEstereo`), aplicada **na oferta e na resposta**. O som do navegador pede `echoCancellation`, `noiseSuppression` e `autoGainControl` desligados, e a faixa vai com `contentHint = 'music'`.
- **Folga de rede** (`FOLGA_DE_REDE` em `cliente.ts`): quem assiste pede `jitterBufferTarget` de 200 ms em cada receptor (vídeo e som). Num relatório real, o Wi-Fi do notebook que assistia tinha soluços (ida e volta de 8 para 222 ms) que viravam congelamentos com o PC de quem transmite enviando tudo certo. Na bancada, o atraso medido de exibição fica em ~160 ms.
- **Piso de fps da captura** (`FPS_MINIMO_DA_CAPTURA` = 10): entra por `applyConstraints` (`tamanhoDaCaptura(true)`), porque o `getDisplayMedia` não aceita `min`. Com a tela parada, o Chromium só entrega quadro quando algo muda (até 1 fps) e quem assiste contava congelamentos falsos. Com o piso, o Chromium pede um quadro repetido (`RequestRefreshFrame`, uma captura a mais) quando nenhum chega em 100 ms. Não suba muito: com o jogo limitado a ~21 fps de captura, um piso perto disso gastaria capturas extras.
- **`aquecerWebRtc()`:** o primeiro uso do WebRTC na página trava a thread principal por até 1,6 s (consulta de codecs à placa de vídeo, medido numa RX 7800 XT). A consulta é feita 300 ms depois do `bem-vindo`; sem isso, a trava caía no primeiro "Assistir" e picotava o som do app. Não remova.
- **Vídeo que cai volta sozinho** (`refazerVideo`): a conexão de recebimento em `failed`, ou em `disconnected` por mais de 2 s, é refeita com `deixar` + `assistir` (quem transmite fecha a velha e manda oferta nova). Até 3 vezes seguidas se já tinha conectado; 1 vez se nunca conectou (rede sem TURN), e então o aviso com "Tentar de novo". Sem a sinalização no ar, espera ela voltar, porque a conexão velha ainda pode se recuperar.
- **Relatório** (`relatorio()` em `cliente.ts`, botão "Salvar relatório" nas estatísticas): guarda em memória as últimas 15 mil linhas, que são as `Metrica` de cada segundo e os acontecimentos (todo `avisar` entra sozinho, mais entrar, transmitir, assistir, qualidade, estado das conexões e `refazerVideo`). Nada sai do PC: o arquivo JSON é baixado e a pessoa decide para quem manda. Ao acrescentar um acontecimento importante, chame `registrar`.
- **Seletor do app:** abre no clique, em estado "carregando" (`seletorCarregando` em `ponte.ts`), antes de o `main.js` terminar o `desktopCapturer.getSources` (~0,4 s com 7 janelas). Cancelar nesse meio-tempo responde `null` quando a lista chegar.
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
- A raiz `/` do servidor é sempre a entrada (o app Electron carrega `/`). No navegador, a entrada tem um link para o site (`SITE` em `Entrada.tsx`).

### Site (`site/`, GitHub Pages)

- Endereço: https://kayokalinauskas.github.io/ozamigos/. Publicado pelo workflow `site.yml` a cada push na `main` que mexe em `site/`.
- HTML, CSS e JS puros, **sem build e sem dependências**. Caminhos relativos (o site mora em `/ozamigos/`), exceto no `404.html`, que usa `/ozamigos/...` porque o Pages o serve em qualquer caminho.
- Precisa funcionar sem JavaScript: os botões apontam para `releases/latest` e para `https://ozamigos.onrender.com/`. O `site.js` só melhora a página:
  - troca o link pelo instalador direto, com versão e tamanho (API do GitHub, guardado 10 min no `sessionStorage`);
  - fora do Windows, põe "Usar no navegador" como botão principal;
  - faz um pedido pequeno ao Render para acordar o servidor gratuito.
- Duas línguas: `site/index.html` (português) e `site/en/index.html` (inglês, com caminhos `../`). **Mudou o texto de uma, mude a outra.** As duas se ligam por `hreflang` e pelo botão PT/EN; o `site.js` lê o `lang` da página. O app em si continua só em português (o FAQ em inglês avisa).
- **Confira as duas línguas antes de dizer que terminou**: abra `/` e `/en/` (ou tire foto das duas) depois de qualquer mudança no site.
- Cache: o Pages guarda cada arquivo por 10 min no navegador. O `site.yml` põe `?v=<hash>` no `estilo.css` e no `site.js` de cada HTML na publicação, para uma página guardada nunca abrir com o CSS de outra versão. No código-fonte, os links ficam sem `?v=`. Ao conferir o site publicado, recarregue com Ctrl+F5 ou use `?nc=<número>` no endereço.
- Seção de privacidade: se o servidor passar a registrar ou guardar algo novo (nome, IP, mensagens), atualize o texto nas duas línguas.
- Imagens em WebP (640, 800, 1200 e 1600 px, com `srcset`), geradas de `docs/imagens/*.png`. Fontes Inter e Sora (só latin) em `site/fontes/`, com as licenças OFL. Ícones: sprite SVG do Lucide no próprio HTML.
- Mudou a captura de tela? Gere de novo o WebP; não coloque PNG grande no site.

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
  - **Se o Ozamigos instalado estiver aberto, isso não funciona e é perigoso:** o app do repositório usa a mesma pasta de dados (`%APPDATA%\Ozamigos Share`) e, com ela, a mesma trava de instância única. Ele fecha na hora e traz a janela do dono para a frente; se abrisse, gravaria nome, senha e posição por cima dos do dono. Abra por um script que troca a pasta antes de carregar o `main.js`: `app.setPath` embrulhado para devolver outra pasta em `userData`, e depois `require('<repo>/desktop/main.js')`.
- **Medir a transmissão:** duas janelas do Electron (uma transmite, outra assiste) e `getStats` a cada segundo: `framesPerSecond` e `frameHeight` de quem recebe, `encoderImplementation`, `qualityLimitationReason` e o fps da `media-source` de quem envia.
  - Para ver o `encoderImplementation`, a página precisa ter um microfone em uso (o Chrome esconde o dado sem isso). Mas **não use `--use-fake-ui-for-media-stream` ao medir captura**: ele troca qualquer tela por uma tela falsa de 20 fps.
  - Uma fonte desenhada dentro da própria página (o Worker da tela falsa) fica mais lenta com a janela minimizada. Para medir minimizado, capture uma janela de verdade pelo `desktopCapturer`: com ela, a transmissão segue a 60 fps minimizada.
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
- **Captura de alguns jogos fica abaixo do fps pedido.** Com o Path of Exile (RX 7800 XT, tela 2560×1440), a captura do Chromium entrega ~21 fps fixos, tanto da janela quanto da tela inteira, enquanto uma janela comum de 1920×1080 sai a 60 fps com o jogo aberto. Cada quadro do jogo custa ~23 ms para copiar, e o Chromium nunca deixa a captura ocupar mais da metade do tempo (`DesktopCaptureDevice`). Testado e **descartado** como causa ou solução: carga da placa de vídeo (95%, 79% e 57% dão os mesmos ~21 fps), limite de fps do jogo, iluminação global e sombras, prioridade de GPU alta (`D3DKMTSetProcessSchedulingPriorityClass`, A/B alternado: 21,5 contra 21,5), prioridade de processo e as chaves `AllowWgc*`. O app avisa (`capturaAbaixo` em `qualidade.ts`: "Captura a N fps" nos controles e a explicação nas estatísticas). Caminhos não testados: o modo de janela do jogo (planos de sobreposição/MPO, formato de 10 bits) e uma captura própria pelo auxiliar C# (Windows Graphics Capture sem o limite do Chromium).
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
  - Registre a versão no `CHANGELOG.md` (mesmo texto das notas da release, no formato Keep a Changelog).
  - O workflow `ci.yml` roda em cada push na `main` e em cada PR: build da interface, `mvnw test` e `node --check` nos scripts do app.
  - O repositório é público, então o Actions não tem custo. Mesmo assim, não cadastre forma de pagamento: o dono não aceita nenhum risco de cobrança.
