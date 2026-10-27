# TODO

Pendências que ficaram para depois, com o que falta para fechar cada uma.

## Ligar o banco no Render (fase 0 das contas)

O código está pronto (`Banco.java`, `VidaDoBanco.java`, `compose.yaml`, `backup.yml`; plano em
`docs/plano-contas.md`). Sem as variáveis, o servidor funciona como antes, sem banco. Os valores nunca vão para o
código nem para o chat.

1. Em https://supabase.com, criar a conta (**sem cartão**: o plano Free não pede) e um projeto:
   - **Region: East US (North Virginia)**, a mesma do Render;
   - uma senha forte para o banco (guardar num gerenciador de senhas).
2. No projeto, em *Connect*, copiar a conexão do **Session pooler** (não a *Direct connection*, que é só IPv6, nem a
   *Transaction pooler*). Ela vem assim (o `aws-0` pode ter outro número; use o que aparecer): `postgresql://postgres.XXXX:[SENHA]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`.
3. No Render, em *Environment*, criar:

   | Variável | Valor (do exemplo acima) |
   |---|---|
   | `OZAMIGOS_BANCO_URL` | `jdbc:postgresql://aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require` |
   | `OZAMIGOS_BANCO_USUARIO` | `postgres.XXXX` |
   | `OZAMIGOS_BANCO_SENHA` | a senha do banco |

4. No GitHub, em *Settings → Secrets and variables → Actions*, criar:
   - `BANCO_BACKUP_URL`: a conexão do passo 2, com a senha no lugar de `[SENHA]`;
   - `BACKUP_CHAVE`: uma frase longa e aleatória, **guardada também fora do GitHub** (sem ela, o backup não abre).
5. Depois do deploy, conferir no log do Render: `Banco pronto: 1 migrações aplicadas agora, esquema na versão 1`. Se
   aparecer `Banco: não deu para preparar (...)`, a mensagem diz o motivo (senha, endereço); as salas continuam
   funcionando enquanto isso.
6. Em *Actions → Backup do banco → Run workflow*, rodar uma vez e conferir que o artefato `banco-...` aparece.

## Retransmissão (TURN da Cloudflare)

Ligada desde 26/10/2026, com os limites do `AGENTS.md`. Ainda por decidir: o limite de vídeo por endereço (10 GB por
dia, umas 5 horas de 720p retransmitido). Na fase 1 das contas, ela passa a ser só para quem tem conta.
