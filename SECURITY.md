# Segurança

## Como relatar uma falha

**Não abra uma issue pública.** Use o relato privado do GitHub: aba **Security** → **Report a vulnerability** ([link direto](../../security/advisories/new)).

Inclua, se puder:

- o que a falha permite fazer (por exemplo, entrar numa sala sem a senha ou ver a transmissão de outra sala);
- os passos para reproduzir;
- a versão do app ou o commit do servidor.

Você recebe uma resposta assim que possível. A correção sai numa versão nova, e o relato fica público depois disso, com o seu crédito, se quiser.

## Versões cobertas

Só a [versão mais recente](../../releases/latest) do app e a `main` do servidor recebem correções.

## O que já se sabe

As limitações conscientes, como a senha única por servidor (só com um freio de tentativas por endereço) e a ausência de servidor TURN, estão descritas nas seções **Segurança** e **Limitações conhecidas** do [README](README.md). Relatos sobre elas são bem-vindos, mas não são novidade.
