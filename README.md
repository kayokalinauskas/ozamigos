# Ozamigos Share

Transmita o seu jogo para até 4 amigos em até 1080p, de um PC direto para o outro (WebRTC P2P).
Funciona como **app para Windows** e também pelo **navegador**, com a mesma sala e a mesma senha.

- **Quem está na sala e quem está ao vivo:** a barra lateral mostra cada pessoa, o selo **Ao vivo** e quantas pessoas assistem cada transmissão.
- **Você escolhe o que assistir:** clique em **Assistir** em uma ou mais transmissões. O vídeo só sai do PC de quem transmite para quem pediu, o que economiza o upload e a placa de vídeo de quem transmite.
- **Volume de cada transmissão:** cada uma tem silenciar e volume próprios, e o volume fica guardado por amigo. Há também um volume geral.
- **Grade ou Destaque:** veja tudo lado a lado ou uma transmissão grande com as outras em miniatura. Dois cliques no vídeo abrem a tela cheia.
- **Qualidade ao vivo:** 1080p ou 720p, a 30 ou 60 fps, sem derrubar ninguém. Cada transmissão tem um indicador verde, amarelo ou vermelho de como o vídeo está chegando, e as estatísticas completas ficam a um clique.
- **Avisos:** quando alguém entra ou começa a transmitir, aparece um aviso com o botão **Assistir**. Há sons curtos, que você pode desligar, e notificação do Windows se a janela estiver atrás do jogo.
- **No app para Windows:**
  - um seletor próprio, com miniaturas de janelas e telas;
  - o som do PC com um clique, **sem o som do Discord e sem o som das transmissões que você está assistindo** (os amigos nunca ouvem a própria voz ou o próprio jogo de volta), em estéreo;
  - transmissão sem engasgar quando o jogo está na frente.

## Como as peças se encaixam

```text
web/        Interface (React + TypeScript + Vite). O build vai para src/main/resources/static.
src/        Servidor Java (Spring Boot): salas, senha do grupo e sinalização por WebSocket.
            Serve a interface pronta. O vídeo nunca passa por ele.
desktop/    App para Windows (Electron). Abre a interface que o servidor serve e acrescenta
            o seletor de fontes, o som do PC e as notificações.
desktop/som Auxiliar de som (C#, OzamigosSom.exe). Vai dentro do instalador e roda escondido
            enquanto alguém transmite com som.
```

**Como o som do PC deixa o Discord de fora.** O Windows 10 (versão 2004 em diante) e o 11 conseguem capturar o som de um programa por vez. O auxiliar:

1. confere, a cada 2 segundos, quais programas estão tocando som;
2. captura cada um deles, menos o Discord (`Discord.exe`, `DiscordPTB.exe` e `DiscordCanary.exe`) e o próprio Ozamigos Share;
3. mistura tudo e entrega ao app.

O auxiliar não abre janela nem ícone. Ele liga quando a transmissão com som começa e desliga quando ela para. Se o app fechar de repente, ele percebe e fecha junto. A lista de exclusões fica em `SEM_SOM_DE`, no `desktop/main.js`.

Num Windows mais antigo, em que o auxiliar não funciona, o app volta a mandar o som do Windows inteiro.

Como o app abre a interface direto do servidor, **cada deploy atualiza o app de todo mundo**. O instalador só precisa ser gerado de novo quando algo dentro de `desktop/` mudar.

## Requisitos

- **Java 25** (JDK). O Maven não precisa ser instalado, porque o `mvnw` baixa sozinho.
- **Node.js 22** ou mais novo, para montar a interface e o app.
- **.NET SDK 10**, só para gerar o instalador, porque ele compila o auxiliar de som. Os amigos não precisam instalar nada.
- **Para transmitir:** o app para Windows (Windows 10/11, 64 bits), ou o Chrome ou o Edge no computador.
- **Para assistir:** o app, ou qualquer navegador moderno.

## A senha do grupo

Para entrar numa sala, além do link é preciso a **senha do grupo**. Ela vem da variável de ambiente `OZAMIGOS_SENHA` e **nunca fica no código**. Sem a variável, o servidor não sobe e o log mostra `Defina a senha do grupo na variável de ambiente OZAMIGOS_SENHA`.

Use uma frase de quatro ou mais palavras sem relação entre si (exemplo: `pastel trombone feira azul`). É fácil de ditar para um amigo e difícil de adivinhar.

## 1. Rodar no seu computador

Monte a interface uma vez (e de novo sempre que mexer em `web/`):

```bash
cd web
npm install
npm run build
cd ..
```

Suba o servidor. No PowerShell:

```powershell
$env:OZAMIGOS_SENHA = "teste"
.\mvnw.cmd spring-boot:run
```

No Git Bash:

```bash
OZAMIGOS_SENHA=teste ./mvnw spring-boot:run
```

Abra `http://localhost:8080`. Para rodar os testes do servidor: `./mvnw test`.

**Mexendo na interface:** com o servidor rodando, `cd web && npm run dev` abre a interface em `http://localhost:5173`. Ela atualiza na hora a cada alteração e repassa o WebSocket para o servidor na 8080.

**O app apontando para o seu PC:**

```bash
cd desktop
npm install
npm start
```

Na primeira vez, o app pergunta o endereço do servidor: digite `http://localhost:8080`.

## 2. Deploy gratuito no Render

1. Crie o repositório no GitHub e envie o código. Com o [GitHub CLI](https://cli.github.com/):

   ```bash
   gh repo create ozamigos-share-app --public --source=. --push
   ```

2. Em [render.com](https://render.com), clique em **New** → **Web Service** → escolha o repositório `ozamigos-share-app`.
3. Confira **Language: Docker**, **Branch: main** e **Instance Type: Free**. O Dockerfile monta a interface e o servidor sozinho.
4. Em **Environment Variables**, adicione `OZAMIGOS_SENHA` com a senha do grupo.
5. Clique em **Deploy Web Service**. O primeiro build leva alguns minutos e termina quando o log mostra `Tomcat started on port 10000`.

Anote o endereço, algo como `https://ozamigos-share-app.onrender.com`. A cada `git push` na `main`, o Render publica de novo sozinho.

**Plano gratuito:** o serviço dorme depois de 15 minutos sem uso e leva cerca de 1 minuto para acordar. Abra o app uns minutos antes de chamar os amigos. Enquanto alguém está numa sala, o serviço fica acordado.

## 3. Gerar o app para Windows e mandar para os amigos

1. Em `desktop/package.json`, coloque o endereço do seu servidor. Assim ninguém precisa digitar:

   ```json
   "ozamigos": {
     "servidor": "https://ozamigos-share-app.onrender.com"
   },
   ```

2. Gere os executáveis:

   ```bash
   cd desktop
   npm install
   npm run instalador
   ```

   O comando compila o auxiliar de som com o .NET e gera os instaladores. Em `desktop/dist` saem dois arquivos:
   - `Ozamigos-Share-Instalador-1.0.0.exe` instala, cria o atalho e aparece em "Adicionar ou remover programas";
   - `Ozamigos-Share-Portatil-1.0.0.exe` roda sem instalar.

3. Publique o instalador numa Release do GitHub e mande o link para os amigos:

   ```bash
   gh release create v1.0.0 desktop/dist/Ozamigos-Share-Instalador-1.0.0.exe --title "Ozamigos Share 1.0.0" --notes "Primeira versão do app"
   ```

**Aviso do Windows na primeira vez:** o instalador não tem assinatura digital, porque o certificado custa caro. Por isso o Windows mostra "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**. Isso só acontece na primeira vez.

## 4. Roteiro de teste

Todos os itens dão para fazer num computador só, com o app e uma ou duas janelas do navegador.

**Entrada e senha**
- [ ] A senha errada mostra "Senha errada" e deixa tentar de novo. Com a senha certa, você entra na sala.
- [ ] No campo **Sala**, colar o link inteiro que um amigo mandou também funciona.
- [ ] A sexta pessoa vê "A sala está cheia (máximo de 5 pessoas)".

**Transmitir e assistir**
- [ ] No app, **Transmitir** abre o seletor com miniaturas, nas abas **Janelas** e **Telas**. Escolha uma e clique em **Transmitir**. Aparece a prévia "Ao vivo" na barra lateral.
- [ ] No navegador, quem está ao vivo aparece com o selo e o botão **Assistir**, e surge o aviso "começou a transmitir" com o botão **Assistir**.
- [ ] Ao clicar em **Assistir**, o vídeo aparece no palco e quem transmite vê "Assistindo você: (nome)".
- [ ] Com duas pessoas transmitindo, dá para assistir as duas ao mesmo tempo, em **Grade** e em **Destaque**. **Destacar** troca qual fica grande.
- [ ] O volume e o silenciar de cada transmissão funcionam sozinhos. O volume geral vale para todas. Ao recarregar a página, o volume de cada amigo continua o mesmo.
- [ ] O **X** de uma transmissão para de assistir só aquela. Quem transmitia vê o número de quem assiste diminuir.
- [ ] Quem transmite clica em **Parar** e depois em **Transmitir** de novo: quem assistia volta a assistir sozinho.
- [ ] **Trocar o que transmito** muda a fonte sem derrubar quem está assistindo.

**Som (no app, com "Transmitir o som do PC" marcado)**
- [ ] Um amigo ouve o jogo, ou uma música tocando no seu PC.
- [ ] Ele **não** ouve o Discord (a voz dos outros na chamada) nem o som das transmissões que você está assistindo no Ozamigos.
- [ ] Ao clicar em **Parar**, o `OzamigosSom.exe` some do Gerenciador de Tarefas.

**Qualidade**
- [ ] Em **Estatísticas**, quem transmite vê:
  - `1920×1080`;
  - os fps da qualidade escolhida;
  - o codificador de hardware (ex.: `NvencH264`, `AMDh264Encoder`, `MediaFoundationVideoEncodeAccelerator`);
  - `Limite: nenhum`.
- [ ] Nos primeiros 15 a 25 segundos, uma resolução menor é normal: é o WebRTC medindo a internet.

## Banda: quanto custa cada pessoa que assiste

Cada pessoa que assiste uma transmissão é mais um vídeo saindo do PC de quem transmite.

| Qualidade | Upload de quem transmite, por pessoa assistindo | Download de quem assiste, por transmissão |
|---|---|---|
| 1080p · 30 fps (padrão) | ~5 Mbps | ~5 Mbps |
| 1080p · 60 fps | ~8 Mbps | ~8 Mbps |
| 720p · 60 fps | ~5 Mbps | ~5 Mbps |
| 720p · 30 fps | ~3 Mbps | ~3 Mbps |

Exemplo: transmitindo em 1080p a 30 fps para 4 amigos, são cerca de 20 Mbps de upload. Se o upload não der conta, a linha `Limite` das estatísticas mostra `internet`, e o WebRTC baixa a resolução.

## Fps baixo ou travando: como descobrir o porquê

Abra **Estatísticas** no computador de quem transmite:

| O que aparece | O que significa | O que fazer |
|---|---|---|
| `Captura` baixa (abaixo da qualidade escolhida) | O PC nem consegue copiar a tela, porque o jogo está usando a placa de vídeo inteira | **Limite o fps do jogo** (60 é o ideal) e use "janela sem bordas" |
| `Limite: processador / placa de vídeo` | O codificador não dá conta | Escolha 720p, limite o fps do jogo e atualize o driver de vídeo |
| `Limite: internet` ou `Banda estimada` baixa | O upload de quem transmite não aguenta | Baixe a qualidade, use cabo em vez de Wi-Fi ou peça para menos pessoas assistirem |
| Tudo bem em quem transmite, mas quem assiste vê o indicador vermelho | A internet de quem assiste | Cabo, ou Wi-Fi mais perto do roteador |

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| O servidor não sobe: "Defina a senha do grupo…" | Falta a variável `OZAMIGOS_SENHA` | Defina a variável (no Render, em **Environment**) |
| `http://localhost:8080` mostra erro 404 | A interface não foi montada | `cd web && npm install && npm run build` |
| O app diz "Não foi possível abrir…" | Endereço errado, sem internet, ou o Render acordando | Confira o endereço; espere 1 minuto e clique em **Conectar** |
| Os amigos ouvem o próprio som de volta | Você transmite pelo **navegador**, que leva o som do computador inteiro. No app, isso não acontece | Transmita pelo app para Windows, ou silencie as transmissões que você assiste |
| A voz de uma chamada ainda vai junto | A chamada é por um programa que não está na lista, como o Discord aberto no navegador | Use o Discord instalado, ou acrescente o programa em `SEM_SOM_DE` (`desktop/main.js`) |
| Vídeo preto com o jogo em tela cheia | A tela cheia exclusiva não é capturável como janela | Use "janela sem bordas" no jogo ou transmita a tela inteira |
| "Não foi possível conectar direto com…" | A rede de alguém não permite conexão direta (4G/5G, CGNAT, rede corporativa) | Tente outra rede. Esses casos precisam de um servidor TURN, que esta versão não tem |
| "A conexão com o servidor caiu" | O Render reiniciou ou a internet caiu | Clique em **Entrar de novo** |

## Limitações conhecidas

- **O som que fica de fora:** o som de programas abertos *a partir* do Discord ou do Ozamigos também fica de fora, porque o Windows trata o programa e os que ele abriu como um grupo só. Jogos abertos pela Steam, pela Epic ou pelo menu Iniciar não são afetados.
- **Programa que começa a tocar no meio:** o som dele entra na transmissão em até 2 segundos.
- **Sem TURN:** quem está atrás de CGNAT ou de rede corporativa pode não conseguir conectar.
- **Até 5 pessoas por sala:** é o limite seguro para um PC de casa mandando vídeo direto para cada amigo.
