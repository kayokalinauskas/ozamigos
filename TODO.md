# TODO

Pendências que ficaram para depois, com o que falta para fechar cada uma.

## Ligar a retransmissão (TURN da Cloudflare)

O código está pronto e no repositório desde 19/10/2026 (`Retransmissao.java`, `CloudflareHttp.java`; detalhes em "Retransmissão" no `AGENTS.md` e em "Segurança" no `README.md`). Ele **fica desligado enquanto as variáveis não existirem**: sem elas, o Ozamigos funciona como antes, só com conexões diretas. Motivo: um amigo (o correa) não conecta com o dono nem com VPN, porque as duas redes são restritivas; só a retransmissão resolve.

O último passo foi decidido, mas não feito: **pôr as credenciais nas variáveis de ambiente do Render**.

1. Na Cloudflare, em *Realtime → TURN Server → Create*, criar a chave `ozamigos` e anotar o **Turn Token ID** e o **API Token**.
2. Em *Manage account → Account API Tokens → Create Token*, criar um token **só com *Account Analytics: Read*** e anotar o **Account ID** da conta.
3. Em *Manage account → Billing*, conferir que **não há cartão cadastrado** (o dono não aceita nenhum risco de cobrança).
4. No Render, em *Environment*, criar as quatro variáveis. Os valores nunca vão para o código nem para o chat:

   | Variável | Valor |
   |---|---|
   | `OZAMIGOS_TURN_ID` | o Turn Token ID |
   | `OZAMIGOS_TURN_TOKEN` | o API Token do TURN |
   | `OZAMIGOS_CLOUDFLARE_CONTA` | o Account ID |
   | `OZAMIGOS_CLOUDFLARE_LEITURA` | o token só de leitura |

5. Depois do deploy, conferir no log do Render:
   - `Retransmissão ligada`;
   - logo depois, `Retransmissão: X GB em 31 dias, Y GB hoje`. **A consulta do consumo nunca rodou contra a Cloudflare de verdade.** Se aparecer `não deu para ler o consumo: ...`, a mensagem do GraphQL vem junto: corrigir a consulta em `CloudflareHttp.CONSULTA`. Até ela funcionar, ninguém recebe credencial (falha fechada).
6. Testar com o correa: no relatório do app (estatísticas → "Salvar relatório"), devem aparecer `retransmissão disponível` e, na conexão com ele, `voz com correa: retransmitido`.

**Ainda por decidir:**
- O limite por endereço é de 10 GB por dia (`LIMITE_POR_ENDERECO`). Em 720p, isso dá umas 5 horas de transmissão retransmitida para uma pessoa (em 1080p · 60, umas 2). Os limites totais são 50 GB no dia e 500 GB em 31 dias (baixados em 26/10/2026, com o cartão cadastrado na Cloudflare).
- Hoje a retransmissão vale para todos os grupos, e o dono vai medir o consumo. Se gastar muito, a ideia é limitar à sala fixa `ozamigos`.
