# TODO

Pendências que ficaram para depois, com o que falta para fechar cada uma.

## Depois da revisão de segurança (PR #21)

- Na próxima versão do app: tirar do `loginPeloNavegador` (`desktop/main.js`) a volta `ligou`, que o servidor não manda
  mais (a ligação volta com um `codigo`, que a página confirma).

## Refazer as imagens da vitrine

O `docs/vitrine/captura.js` entra numa sala com senha, que saiu em 28/10/2026. Para refazer as telas do README e do site,
ele precisa entrar com conta (o login de teste, como os e2e em `web/e2e/conta.ts`), num servidor salvo.

## Retransmissão (TURN da Cloudflare)

Ligada desde 26/10/2026, com os limites do `AGENTS.md`. Ainda por decidir: o limite de vídeo por pessoa (10 GB por
dia, umas 5 horas de 720p retransmitido). Desde as contas, ela é só para quem tem conta (o amigo do Rio foi avisado).
