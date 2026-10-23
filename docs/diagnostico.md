# Qualidade e diagnóstico

## Banda

A transmissão sai em **720p a 30 fps**, com cerca de 4 Mbps de upload **para cada pessoa assistindo**. No app, a engrenagem (aba **Geral**) oferece também 720p a 60 fps, 1080p a 30 fps e 1080p a 60 fps, que gastam mais.

A voz usa no máximo ~450 kbps de upload, mesmo com a sala cheia.

Quando falta processador ou internet, a imagem perde nitidez ou fps em vez de travar. Isso vale só para quem tem a conexão ruim.

## Estatísticas

Se o fps estiver baixo ou a imagem travando, abra **Estatísticas** no PC de quem transmite:

| O que aparece | O que fazer |
|---|---|
| `Captura` abaixo de 30 fps | Limite o fps do jogo a 60 e use "janela sem bordas" |
| `Limite: processador / placa de vídeo` | Limite o fps do jogo e atualize o driver |
| `Limite: internet` | Use cabo ou deixe menos gente assistindo |
| Indicador vermelho só em quem assiste | O problema é a internet de quem assiste |

## Testes de desempenho

Estas ferramentas não têm botão na tela; abrem pelos atalhos:

- **Ctrl+Shift+X**: com o jogo transmitindo, simula 1, 3 e 7 pessoas assistindo e diz quantas o seu PC aguenta.
- **Ctrl+Shift+G**: grava as estatísticas da sala de verdade, de todos os PCs. Para parar, aperte de novo.

Os relatórios saem em HTML (com gráficos), em Markdown (para colar numa IA) e em JSON. No app, eles ficam em `Documentos\Ozamigos\Estatísticas`.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| O servidor não sobe: "Defina a senha do grupo…" | Defina a variável `OZAMIGOS_SENHA` |
| `localhost:8080` dá 404 | Monte a interface: `npm install` e `npm run build` em `web/` |
| O app diz "Não foi possível abrir…" | Confira o endereço, espere um minuto e clique em **Conectar** |
| Os amigos não me ouvem | Na engrenagem, escolha o microfone certo e use **Testar o microfone** |
| O começo das palavras some | Ligue **Ajustar sozinho** na sensibilidade |
| Os amigos ouvem eco | Use fone, ou ligue o **Cancelamento de eco** na engrenagem |
| Os amigos ouvem o próprio som de volta | Transmita pelo app para Windows, não pelo navegador |
| O vídeo fica preto com o jogo em tela cheia | Use "janela sem bordas" ou transmita a tela inteira |
| "Não foi possível conectar direto com…" | A rede bloqueia a conexão direta (4G/5G ou rede corporativa). Ligue a retransmissão ou troque de rede |
