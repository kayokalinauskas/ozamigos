# Histórico de versões

As mudanças de cada versão do app para Windows. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Os arquivos de cada versão estão em [Releases](https://github.com/kayokalinauskas/ozamigos/releases).

O servidor e a versão web não têm número de versão: cada push na `main` vai para o ar no Render.

## [Não lançado]

### Adicionado
- **Conversa por voz na sala**: quem entra já está na conversa, sem outro programa, e o microfone abre só quando a pessoa fala.
  - Supressão de ruído com o **RNNoise** por padrão, ou a do navegador, ou nenhuma.
  - Sensibilidade do microfone **automática** (pela detecção de voz do RNNoise, acima do barulho do ambiente) ou manual, com medidor.
  - Botões de microfone e de som no seu cartão, e anel verde em quem está falando. Quem desliga o microfone ou o som aparece com o ícone para os outros.
  - Engrenagem com microfone, saída de áudio, volumes de entrada e de saída, teste do microfone, cancelamento de eco, controle automático de ganho e os sons de aviso.
  - Volume da voz de cada amigo (até 200%) e "silenciar para mim", clicando no avatar dele.
  - Um limitador suave antes da caixa de som: vários amigos falando juntos, ou um volume em 200%, não estouram.
  - A sensibilidade automática não corta mais o começo das palavras que abrem com chiado ("**s**im", "**f**ala", "**ch**ega"), ao custo de 30 ms a mais de atraso na voz. Cliques de teclado continuam de fora.

### Alterado
- **Menos atraso para quem assiste:** a folga contra soluços da rede era fixa em 200 ms e agora se ajusta à rede de cada um (de 80 a 250 ms, começando em 100). Na bancada, o atraso estimado caiu de ~195 ms para ~100 ms.
- O sino dos sons de aviso e o "Trocar o servidor" saíram do cartão de baixo e foram para a engrenagem.
- **Revisão visual:**
  - Os nomes não são mais cortados na lista da sala: "Assistir" e "Parar" viraram botões de ícone.
  - O cartão de baixo mostra o nome e um status curto ("Mudo", "Som desligado", "Ao vivo").
  - O botão de sair da sala foi para o alto da barra lateral, ao lado do logo.
  - Nas miniaturas, o nome não quebra mais em duas linhas.
  - Os avisos ganharam ícone e nunca passam da borda; o aviso de estatísticas salvas não mostra mais o caminho inteiro da pasta.
  - No modo Destaque, a transmissão principal fica em 16:9. Quando o palco não é largo (estatísticas abertas, janela estreita), as outras vão para uma fileira embaixo dela, e ela fica bem maior.
  - Barras de rolagem finas, na cor do app.
  - Em telas de 2560×1440 sem escala do Windows, a interface fica 20% maior.
- **Suíte de testes** (`.\testar.ps1`, também na CI): sinalização com clientes WebSocket de verdade, regressão do áudio do microfone, ponta a ponta com navegadores (entrar, transmitir, assistir, falar e sair) e fumaça do app para Windows.

### Corrigido
- Quando duas pessoas saíam da sala ao mesmo tempo, quem ficava podia não ser avisado de uma delas e continuava vendo um "fantasma" na lista.
- A voz com um amigo cuja rede não deixa conectar ficava tentando ligar de novo para sempre, sem nunca avisar. Agora são 3 tentativas e um aviso.
- Trocar dois ajustes do microfone em seguida podia deixar valendo o microfone aberto com os ajustes antigos.
- Um caminho de rede recusado pelo navegador interrompia a resposta à transmissão, e o vídeo ficava em "Conectando…" para sempre.
- Alguém com a internet lenta demais para receber os avisos da sala podia derrubar a conexão de quem mandou a mensagem.
- Uma mensagem malformada derrubava a conexão com o servidor; agora volta como erro.
- Os nomes perdem caracteres invisíveis e os que invertem a direção do texto, e o limite de 20 caracteres não parte mais um emoji ao meio.

### Segurança
- Depois de 10 senhas erradas em 5 minutos, o mesmo endereço espera antes de tentar de novo: adivinhar a senha do grupo deixou de ser de graça.
- No app para Windows, a página do servidor só pode voltar para a tela de início do app, nunca abrir outro arquivo do PC.
- Electron 44.7.2, com as correções de segurança do Chromium.

## [1.2.11] - 2026-10-13

### Adicionado
- **Gravação das estatísticas da sala** (Ctrl+Shift+G, de novo para parar). Grava a sala de verdade, com os amigos: quem transmite, quem assiste quem, ou as duas coisas ao mesmo tempo.
  - Os amigos não precisam fazer nada: veem o selo "Gravando estatísticas" no alto da sala, e o PC de cada um manda as próprias medidas (o que transmite, o que assiste, processador e placa de vídeo) só para quem grava.
  - Salva sozinho em `Documentos\Ozamigos\Estatísticas`: o relatório para IA a cada 30 s (a sala inteira, uma seção por transmissão com os piores segundos e o PC de cada pessoa, num tamanho que cabe numa conversa com a IA) e, no fim, uma página com gráficos por transmissão e os dados em JSON.
  - Continua se o servidor reiniciar no meio, e para sozinha depois de 2 horas.

### Alterado
- O teste com Ctrl+Shift+D fica só com os espectadores simulados: o modo "com os amigos assistindo" virou a gravação da sala.
- O teste de desempenho fica escondido: sem botão no painel de Estatísticas, abre só com Ctrl+Shift+D.
- Relatório do teste: os quadros "Para o app" não ficam mais espremidos numa coluna estreita, e quando a captura do jogo limita o fps em todas as qualidades, a recomendação diz isso em vez de recomendar a qualidade mais alta.

## [1.2.10] - 2026-10-13

### Adicionado
- **Teste de desempenho** (Ctrl+Shift+D). Grava tudo o que acontece com a imagem do seu jogo, da captura até a tela de quem assiste, e mostra onde está o gargalo:
  - com **espectadores simulados** no seu PC, num roteiro automático pelas 4 qualidades e por 1, 3 e 7 pessoas assistindo (~4 min, ou ~1 min no rápido);
  - ou **com os amigos assistindo de verdade**: cada amigo manda como a imagem chega no PC dele (fps na tela, engasgos, perdas, ida e volta).
- O relatório traz a recomendação (qualidade e quantas pessoas o PC aguenta), os achados com as evidências e gráficos. Ele sai em três formatos: página HTML, JSON e um texto **para colar numa IA** e pedir melhorias no app, com o contexto do Ozamigos, as regras de cada conclusão e os dados de cada segundo.
- No app, o teste mede também o processador e a placa de vídeo, incluindo o motor de codificação de vídeo, pelos mesmos contadores do Gerenciador de Tarefas.

### Alterado
- Logotipo alinhado: o "oz" da tecla passa a apoiar na mesma base de "amigos" (antes ficava um pouco acima, porque a tecla era centralizada pela caixa). No app, vale também na tela de início e na janela de atualização.

## [1.2.9] - 2026-10-13

### Alterado
- A janela não tem mais a barra de título cinza do Windows: o app ocupa a janela toda, como o Discord, e só os botões de minimizar, maximizar e fechar ficam no canto, na cor do app. Arraste a janela pela faixa de cima. O encaixe de janelas do Windows 11 continua funcionando.
- Sem a barra, o menu da tecla Alt deixa de existir: recarregar (Ctrl+R), tela cheia (F11) e "Trocar o servidor" (ícone de servidor na sala e na entrada) continuam.
- No logotipo, o "oz" da tecla passa a ter o mesmo tamanho e peso de "amigos" (com as letras do ícone, ficava maior). O ícone do app não muda.

## [1.2.8] - 2026-10-13

### Alterado
- Ícone maior na barra de tarefas: a tecla passa a ocupar o quadro inteiro, sem cortar nada, e o "oz" cresceu. O Windows dá o mesmo espaço a todos os apps, e o ícone usava só o miolo dele.

## [1.2.7] - 2026-10-13

### Alterado
- Ícone e logotipo novos: a tecla agora traz "oz" em minúsculas, na mesma fonte de "amigos", com o "z" verde. O "z" pequeno no canto fazia o ícone parecer "O₂". Muda o ícone do atalho, da barra de tarefas, da janela e do instalador.
- O logotipo ficou maior no site e na sala, para as letras da tecla não sumirem.

## [1.2.6] - 2026-10-13

### Alterado
- Logotipo novo: a tecla "Oz" do ícone, com o mesmo desenho, seguida de "amigos" (antes eram duas teclas, "O" e "Z"). Muda na tela de início, na janela de atualização, na interface, no site e no README.

## [1.2.5] - 2026-10-13

As melhorias da interface valem também para quem ainda está numa versão anterior (o app carrega a interface
do servidor); só a abertura mais rápida depende desta versão.

### Alterado
- O app abre mais rápido: a interface carrega enquanto ele confere se há versão nova, em vez de esperar a conferência terminar (~0,5–1 s a cada abertura).
- Quem assiste segura cerca de 200 ms de imagem antes de mostrar. Os soluços curtos do Wi-Fi, que viravam congelamentos, agora passam despercebidos. Para assistir, esse atraso não se nota.
- Com a tela parada (área de trabalho, Explorer), a captura caía para 1 fps e quem assistia via dezenas de "congelamentos" e a etiqueta vermelha, sem nada ter travado. Agora a captura repete o último quadro para nunca ficar abaixo de 10 fps, e a etiqueta só fica vermelha com congelamento de verdade ou abaixo de 8 fps.
- A banda indicada em cada qualidade passa a ser a que sai de verdade (o codificador da placa gasta uns 25% a mais que o pedido): ~6 Mbps por amigo em 1080p · 30 fps, não ~5.

## [1.2.4] - 2026-10-13

As melhorias da interface valem também para quem ainda está numa versão anterior (o app carrega a interface
do servidor); só o fim do descarte de quadros depende desta versão.

### Adicionado
- **Relatório da sessão.** Nas estatísticas, "Salvar relatório" baixa um arquivo com as medidas de cada segundo (fps, resolução, Mbps, captura, congelamentos, rede) e o que aconteceu na sessão (quem entrou, quedas, trocas de qualidade, conexões refeitas). Serve para entender depois um travamento.
- Aviso "Captura a N fps" ao lado da qualidade quando o PC de quem transmite copia a imagem do jogo mais devagar do que a qualidade pede (os amigos veem no máximo esse fps). Clicar abre as estatísticas, que explicam que não é a internet.

### Corrigido
- **Engasgos de 1 segundo em 1080p.** Em cenas pesadas, o codificador da placa passava um pouco do alvo e o WebRTC jogava fora os quadros seguintes: quem assistia via 5 a 9 fps por um instante, com a captura estável em 21. O app não descarta mais esses quadros (só no app, não no navegador).
- A "1080p · 30 fps" caía para 720p numa queda curta da internet (comum no Wi-Fi) e demorava quase dois minutos para voltar. Agora fica sempre em 1080p; se a internet apertar, a imagem perde um pouco de nitidez, mas não de tamanho.
- As estatísticas diziam que captura baixa era "o jogo usando a placa de vídeo inteira". Medido com o Path of Exile, a captura ficou em ~21 fps com a placa a 95% e também a 57%.

## [1.2.3] - 2026-10-12

As melhorias da interface valem também para quem ainda está numa versão anterior (o app carrega a interface
do servidor); só as miniaturas em JPEG dependem desta versão.

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

[Não lançado]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.11...HEAD
[1.2.11]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.10...v1.2.11
[1.2.10]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.9...v1.2.10
[1.2.9]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.8...v1.2.9
[1.2.8]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.7...v1.2.8
[1.2.7]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.2...v1.2.3
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
