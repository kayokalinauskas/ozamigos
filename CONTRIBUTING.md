# Como contribuir

Obrigado por querer ajudar o Ozamigos! Sugestões, relatos de problema e correções são bem-vindos.

## Relatar um problema ou sugerir uma ideia

Abra uma [issue](../../issues/new/choose) com o modelo certo:

- **Problema:** diga o que aconteceu, o que esperava e os passos para repetir. Se puder, inclua a versão do app (o nome do instalador), o Windows e o que aparece em **Estatísticas**.
- **Ideia:** conte o que você quer fazer e por quê. O problema que a ideia resolve ajuda mais que a solução pronta.

Falhas de segurança **não** vão em issue: veja [SECURITY.md](SECURITY.md).

## Mandar uma correção

1. Faça um *fork*, crie um branch a partir da `main` e faça a mudança.
2. Rode o básico antes de abrir o pull request:
   ```powershell
   cd web; npm ci; npm run typecheck; npm run build; cd ..
   .\mvnw.cmd test
   ```
3. Se mexeu no comportamento, teste rodando o app (veja **Rodar localmente** no [README](README.md)).
4. Abra o pull request explicando o que mudou e por quê.

## Convenções

- **Português do Brasil** no código, nos identificadores, nos comentários, nas mensagens de commit e nos textos da interface. Os comentários explicam o *porquê*.
- Siga o estilo do código ao redor. O [AGENTS.md](AGENTS.md) explica a arquitetura, os contratos (como o protocolo de sinalização) e as armadilhas conhecidas.
- Mudou o protocolo? Mude o servidor (`src/`), o `web/src/conexao/protocolo.ts` e a seção do protocolo no README juntos.

## Marca

O código é MIT, mas o nome **Ozamigos**, o ícone e o logotipo não fazem parte da licença. Se publicar uma versão modificada, use outro nome e outro ícone.
