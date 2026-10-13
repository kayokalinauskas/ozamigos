# Histórico de versões

As mudanças de cada versão do app para Windows. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Os arquivos de cada versão estão em [Releases](https://github.com/kayokalinauskas/ozamigos/releases).

O servidor e a versão web não têm número de versão: cada push na `main` vai para o ar no Render.

## [Não publicado]

As melhorias da interface chegam a todos no próximo push na `main` (o app carrega a interface do servidor);
só as miniaturas em JPEG dependem de uma versão nova do app.

### Alterado
- O seletor de janelas e telas abre já no clique em Transmitir, com espaços reservados, e as miniaturas entram quando o app termina de listar (cerca de 0,5 s). As miniaturas agora são JPEG: 10 vezes mais rápidas de gerar e um terço do tamanho.
- A captura já sai no tamanho da qualidade escolhida (por exemplo, 1280×720 em "720p"). Antes, cada amigo assistindo tinha o seu codificador reduzindo a mesma imagem, e o tamanho ficava errado se a janela do jogo mudasse no meio da transmissão.
- O som da transmissão pelo navegador vai sem cancelamento de eco, redução de ruído e controle de volume, que são feitos para voz e estragam som de jogo.

### Corrigido
- Quem transmitia congelava por até 1,6 s quando o primeiro amigo clicava em Assistir (o WebRTC consultava a placa de vídeo na hora), e o som do PC picotava nesse momento. Agora essa consulta é feita logo ao entrar na sala.
- Uma transmissão que caía por oscilação de rede ficava congelada para sempre. Agora quem assiste pede o vídeo de novo sozinho (até 3 vezes) e, se a rede não deixar conectar, o aviso traz o botão "Tentar de novo".

## [1.2.2] - 2026-10-12

### Corrigido
- O ícone pequeno da barra de título não sai mais torto: o app e o instalador usam um ícone com cada tamanho desenhado à parte.

## [1.2.1] - 2026-10-12

### Alterado
- A tecla OZ ocupa o ícone inteiro, sem a placa escura em volta. Na barra de tarefas, ela fica do tamanho dos outros ícones.

## [1.2.0] - 2026-10-12

### Adicionado
- **Atualização automática.** Ao abrir, o app instalado procura uma versão nova. Se houver, mostra o progresso, baixa, instala e abre de novo, já atualizado. Sem internet, abre normalmente.
- A versão portátil não se atualiza sozinha.

## [1.1.3] - 2026-10-12

### Corrigido
- O app esquece sozinho o endereço do servidor aposentado (`ozamigos-share-app.onrender.com`) e abre o atual.
- Escolher o servidor padrão na tela inicial não grava mais o endereço. Assim, uma troca futura de servidor chega a todos.

## [1.1.2] - 2026-10-12

### Corrigido
- Depois de atualizar, o app podia mostrar a interface antiga, guardada no cache. Agora ele sempre busca a interface mais nova e limpa o cache na primeira abertura de cada versão.

## [1.1.1] - 2026-10-12

### Alterado
- O servidor padrão passa a ser `https://ozamigos.onrender.com`.

## [1.1.0] - 2026-10-12

### Adicionado
- Reconexão automática: se a internet oscilar ou o servidor reiniciar, o app volta sozinho para a sala.
- Janela flutuante: uma transmissão numa janelinha que fica por cima do jogo.

### Alterado
- O app passa a se chamar **Ozamigos** (antes "Ozamigos Share"), com o ícone da tecla OZ e a paleta verde-limão.

## [1.0.2] - 2026-10-12

### Alterado
- A release passa a ser gerada pelo GitHub Actions.

## [1.0.1] - 2026-10-12

### Corrigido
- Se o som do PC não puder ser montado, a transmissão segue só com vídeo e o app avisa.
- Trocar a fonte rapidamente não duplica mais o som da transmissão.
- O som toca sem precisar de clique quando um amigo retoma a transmissão.
- Copiar o link da sala mostra o link num aviso quando a área de transferência não está disponível.
- Mais estabilidade em sessões longas.

## [1.0.0] - 2026-10-12

### Adicionado
- Primeira versão do app para Windows: salas com senha, várias transmissões ao mesmo tempo, volume por transmissão, grade ou destaque, até 1080p e som do PC sem o eco do Discord.

[1.2.2]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/kayokalinauskas/ozamigos/compare/v1.1.3...v1.2.0
[1.1.3]: https://github.com/kayokalinauskas/ozamigos/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/kayokalinauskas/ozamigos/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/kayokalinauskas/ozamigos/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/kayokalinauskas/ozamigos/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/kayokalinauskas/ozamigos/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/kayokalinauskas/ozamigos/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/kayokalinauskas/ozamigos/releases/tag/v1.0.0
