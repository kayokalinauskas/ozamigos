# Ozamigos Share

Compartilhe a tela do seu jogo com até 2 amigos, em 1080p a 60 fps, direto do navegador.
**Todos podem compartilhar ao mesmo tempo**: cada tela aparece num bloco, com o nome de quem compartilha.
O vídeo vai direto de navegador para navegador (WebRTC P2P).
O servidor Java só apresenta as pessoas umas às outras (sinalização por WebSocket) e confere a senha do grupo.

Esta é a versão com várias telas ao mesmo tempo do projeto Júnior **Ozamigos Share** da Trilha Java Backend.

## Requisitos

- **Java 25** (JDK). O Maven não precisa ser instalado: o `mvnw` baixa sozinho.
- **Chrome ou Edge** no computador para **compartilhar**. Para **assistir**, qualquer navegador moderno serve.

## A senha do grupo

Para entrar numa sala, além do link é preciso a **senha do grupo**. Ela vem da variável de ambiente `OZAMIGOS_SENHA` e **nunca fica no código**: este repositório pode ser público, e qualquer um a leria. Sem a variável, o servidor não sobe e o log mostra `Defina a senha do grupo na variável de ambiente OZAMIGOS_SENHA`.

Use uma frase de quatro ou mais palavras sem relação entre si (exemplo: `pastel trombone feira azul`). É fácil de ditar para um amigo e difícil de adivinhar.

## 1. Rodar no seu computador

No PowerShell:

```powershell
$env:OZAMIGOS_SENHA = "teste"
.\mvnw.cmd spring-boot:run
```

No Git Bash, Linux ou macOS:

```bash
OZAMIGOS_SENHA=teste ./mvnw spring-boot:run
```

No IntelliJ, defina a variável em *Run* → *Edit Configurations…* → *Environment variables*: `OZAMIGOS_SENHA=teste`.

Abra `http://localhost:8080`. Para rodar os testes: `./mvnw test` (não precisa da variável).

## 2. Roteiro de teste completo (antes do deploy)

Marque cada item. Todos dão para fazer sozinho, num computador só.

**Senha**
- [ ] Rodar **sem** a variável `OZAMIGOS_SENHA`: o servidor não sobe e o log explica por quê.
- [ ] Abrir `http://localhost:8080`, digitar seu nome e uma senha **errada** e teclar Enter: aparece "Senha errada" e dá para tentar de novo.
- [ ] Digitar a senha **certa**: entra na sala ("1 pessoa na sala") e o aviso some.
- [ ] Recarregar a página: o nome e a senha já vêm preenchidos.

**Sala e link**
- [ ] A URL tem `?sala=…`. **Copiar** o link e abrir numa segunda janela (não aba: duas janelas lado a lado). Entrar com outro nome: as duas mostram "2 pessoas na sala" com os nomes.
- [ ] Abrir o mesmo link numa terceira e numa quarta janela: a quarta mostra "A sala está cheia (máximo de 3 pessoas)."

**Compartilhar**
- [ ] Na janela 1, **Compartilhar um aplicativo**: o seletor abre na aba de janelas, sem a opção de tela inteira. Escolha um jogo ou qualquer janela.
- [ ] A janela 1 mostra "Você está compartilhando um aplicativo…" e o bloco "Sua tela"; a janela 2 mostra o bloco "Tela de (nome)", com **Silenciar** e **Tela cheia**.
- [ ] **Ao mesmo tempo:** a janela 2 também compartilha. As duas passam a ter dois blocos: "Sua tela" e a tela da outra.
- [ ] Com três janelas e duas pessoas compartilhando, a terceira vê dois blocos lado a lado.
- [ ] Na janela 1, **Trocar para a tela inteira**: marque "Compartilhar áudio do sistema". A janela 2 passa a ver a tela inteira **sem a imagem travar nem a conexão cair**, agora com som.
- [ ] Clicar em **Parar** (ou no "Parar compartilhamento" do Chrome): só o bloco dessa pessoa some nas outras janelas; as outras telas continuam.
- [ ] Recarregar uma janela que só assiste e entrar de novo: ela volta a receber todas as telas que estão sendo compartilhadas.
- [ ] Fechar a janela de quem compartilha: o bloco dela some nas outras e a contagem de pessoas diminui.

**60 fps, medido**
- [ ] Com um jogo em movimento, as estatísticas embaixo do vídeo mostram perto de **60 fps**, **1920x1080**, **H264** e, de quem compartilha, `codificador:` com o nome do encoder de hardware (ex.: `NvencH264`, `MediaFoundationVideoEncoder`). Nos primeiros 5 a 15 segundos, 720p é normal.
- [ ] Se aparecer `limitação: cpu`, o encoder está em software: atualize o driver de vídeo ou teste noutra máquina.

**Rede local (opcional)**: um segundo computador na mesma rede abre `http://IP-DO-SEU-PC:8080/?sala=…`. Ele consegue **assistir**, mas não compartilhar: fora do `localhost`, o navegador só libera a captura de tela em HTTPS. Depois do deploy isso deixa de ser problema.

## 3. Deploy gratuito no Render

1. **Criar o repositório no GitHub** e enviar o código. Com o [GitHub CLI](https://cli.github.com/) logado:

   ```bash
   gh repo create ozamigos-share-multi --public --source=. --push
   ```

   (Ou `--private`: o Render também publica repositórios privados, desde que você autorize o acesso a ele.)

2. Em [render.com](https://render.com), entrar com a conta do GitHub → **New** → **Web Service** → escolher o repositório `ozamigos-share-multi`.
3. Conferir: **Language: Docker**, **Branch: main**, **Instance Type: Free**.
4. Em **Environment Variables**, clicar em **Add Environment Variable**: nome `OZAMIGOS_SENHA`, valor a senha do grupo.
5. Clicar em **Deploy Web Service**. O primeiro build leva alguns minutos e termina quando o log mostra `Tomcat started on port 10000`.
6. Abrir `https://ozamigos-share-multi-xxxx.onrender.com` e refazer o roteiro da seção 2, agora pela internet.

A cada `git push` na `main`, o Render publica de novo sozinho. Para **trocar a senha**, edite a variável em **Environment** e salve: o serviço reinicia com a senha nova, e cada amigo digita a nova uma vez.

**Plano gratuito:** o serviço dorme depois de 15 minutos sem ninguém usando e leva cerca de **1 minuto para acordar**. Abra a página uns minutos antes de chamar os amigos. Enquanto alguém está numa sala, o ping a cada 30 s mantém o serviço acordado. Um redeploy derruba quem está numa sala; é só recarregar e entrar de novo.

## 4. Teste com amigos

1. Abra o seu endereço do Render, digite a senha e clique em **Entrar**.
2. Mande o link (com o `?sala=…`) para até 2 amigos, e a senha **separada do link** (falando, ou noutra conversa): quem achar só o link não entra.
3. Eles abrem o link, digitam o nome e a senha e clicam em **Entrar**. Quem quiser compartilha o jogo, quantos quiserem ao mesmo tempo.
4. Peça para cada amigo dizer os **fps** e a **resolução** que aparecem embaixo do vídeo, e se houve congelamentos.

Anote o resultado de cada amigo:

| Amigo | Rede dele (fibra, 4G/5G, trabalho…) | Conectou? | fps | Resolução | Congelamentos |
|---|---|---|---|---|---|
| | | | | | |

**Se aparecer "Não foi possível conectar direto com a outra pessoa"**, a rede de um dos dois não permite conexão direta (comum em 4G/5G, CGNAT de algumas operadoras e redes corporativas). Não é defeito do app: esses casos precisam de um servidor **TURN**, que repassa o vídeo, e esta versão usa só STUN. Tente outra rede (por exemplo, o Wi-Fi de casa em vez do celular).

**Banda:** cada tela custa até 8 Mbps por pessoa que assiste.

| Quem compartilha | Upload de quem compartilha | Download de cada pessoa |
|---|---|---|
| 1 pessoa | ~16 Mbps (2 amigos assistindo) | ~8 Mbps |
| 2 pessoas | ~16 Mbps cada | até ~16 Mbps |
| 3 pessoas | ~16 Mbps cada | ~16 Mbps |

Com menos banda, o WebRTC baixa a resolução para manter os 60 fps (veja `limite: INTERNET` nas estatísticas). Compartilhar e jogar ao mesmo tempo também pesa na placa de vídeo: cada amigo que assiste é mais uma codificação de vídeo no seu computador.

## Fps baixo ou travando: como descobrir o porquê

Olhe as estatísticas **no computador de quem compartilha**, embaixo dos vídeos. Cada amigo tem um bloco assim:

```text
enviando para Ana: 60 fps · 1920x1080 · 8.0 Mbps · video/H264
    captura: 60 fps · codificador: ... · limite: nenhum
    rede: pela internet · ida e volta 25 ms · banda estimada 13.5 Mbps
```

| O que aparece | O que significa | O que fazer |
|---|---|---|
| `captura` baixa (abaixo de 30) | O navegador nem consegue copiar a tela: o jogo está usando a placa de vídeo inteira | **Limite o fps do jogo** (60 é o ideal; nas opções do jogo ou no painel da NVIDIA/AMD), use "janela sem bordas" e confira se a aceleração por hardware do Chrome está ligada (`chrome://settings/system`) |
| `captura` em 60, mas `enviando` baixo, com `limite: PROCESSADOR/PLACA DE VÍDEO` | O codificador não dá conta | Escolha **720p a 60 fps** em **Qualidade**, limite o fps do jogo e atualize o driver de vídeo |
| `limite: INTERNET` ou `banda estimada` baixa | O upload de quem compartilha não aguenta | Escolha **1080p a 30 fps** ou **720p a 30 fps** em **Qualidade**; prefira cabo a Wi-Fi |
| Tudo bem em quem compartilha, mas quem assiste tem `congelamentos` | A internet de quem assiste | Cabo ou Wi-Fi mais perto do roteador |

A **Qualidade** começa em **1080p a 30 fps** (imagem nítida, ~5 Mbps por amigo e metade do trabalho do PC), muda na hora, sem derrubar ninguém, e o navegador lembra a escolha. Para jogos muito rápidos, experimente 1080p a 60 fps. Nos primeiros 10 a 15 segundos, a resolução e o fps sobem aos poucos: é o WebRTC medindo a rede.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Servidor não sobe: "Defina a senha do grupo…" | Falta a variável `OZAMIGOS_SENHA` (no terminal, no IntelliJ ou no Render) | Defina a variável; no Render, em **Environment** |
| "Senha errada" com a senha certa | Maiúsculas, espaço no fim, ou a senha mudou no Render | Confira o valor em **Environment** e digite de novo |
| Botões de compartilhar desativados | Navegador sem captura de tela (celular, Safari antigo) ou página fora de HTTPS/localhost | Compartilhe pelo Chrome ou Edge no computador |
| Vídeo preto com jogo em tela cheia | Tela cheia exclusiva não é capturável como janela | Use "janela sem bordas" no jogo ou compartilhe a tela inteira |
| Sem som do jogo | "Compartilhar áudio do sistema" não marcado, ou compartilhou um aplicativo | Compartilhe a tela inteira com o áudio marcado |
| "Conexão com o servidor perdida" | Render reiniciou, redeploy ou queda de rede | Recarregue a página e entre de novo |
| Página demora ~1 min para abrir | Serviço dormindo no plano gratuito | Normal; espere acordar |
| Build no Render falha com `bad interpreter` | `mvnw` com quebras de linha do Windows | O `.gitattributes` já resolve; confira se ele foi enviado |
