# TODO

Pendências que ficaram para depois, com o que falta para fechar cada uma.

## Conferir as contas no ar

Feito em 27/10/2026: o Supabase (East US, Session pooler, Data API desligada), os secrets do backup no GitHub e os
clientes de login do Google (publicado, só `openid` e `userinfo.profile`, sem logo) e do Discord (só `identify`), com
as variáveis no Render. Falta conferir, depois do deploy das contas:

1. No log do Render: `Banco pronto: 2 migrações aplicadas agora, esquema na versão 2` e `Login: google, discord`.
2. Entrar com o Google e com o Discord no navegador, e no app 1.3.0.
3. Em *Actions → Backup do banco → Run workflow*, rodar uma vez e conferir que o artefato `banco-...` aparece; baixar,
   abrir com a `BACKUP_CHAVE` (`gpg -d`) e conferir com `pg_restore -l`.

## Retransmissão (TURN da Cloudflare)

Ligada desde 26/10/2026, com os limites do `AGENTS.md`. Ainda por decidir: o limite de vídeo por pessoa (10 GB por
dia, umas 5 horas de 720p retransmitido). Desde as contas, ela é só para quem tem conta (o amigo do Rio foi avisado).
