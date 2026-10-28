# TODO

Pendências que ficaram para depois, com o que falta para fechar cada uma.

## Conferir o backup do banco

As contas estão no ar desde 27/10/2026 (o banco migrado, o login com o Google e o Discord no navegador e no app
1.3.0). Falta: em *Actions → Backup do banco → Run workflow*, rodar uma vez e conferir que o artefato `banco-...`
aparece; baixar, abrir com a `BACKUP_CHAVE` (`gpg -d`) e conferir com `pg_restore -l`.

## Depois do deploy dos servidores (só servidores, com conta)

- No Render, apagar a variável `OZAMIGOS_SENHA` (o servidor não a usa mais; deixá-la não quebra nada).
- Criar o servidor do grupo pela interface e mandar o convite aos amigos (o `/ozamigos` leva à entrada).

## Refazer as imagens da vitrine

O `docs/vitrine/captura.js` entra numa sala com senha, que saiu em 28/10/2026. Para refazer as telas do README e do site,
ele precisa entrar com conta (o login de teste, como os e2e em `web/e2e/conta.ts`), num servidor salvo.

## Retransmissão (TURN da Cloudflare)

Ligada desde 26/10/2026, com os limites do `AGENTS.md`. Ainda por decidir: o limite de vídeo por pessoa (10 GB por
dia, umas 5 horas de 720p retransmitido). Desde as contas, ela é só para quem tem conta (o amigo do Rio foi avisado).
