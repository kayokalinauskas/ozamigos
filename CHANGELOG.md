# Histórico de versões

As mudanças de cada versão do app para Windows. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e as versões seguem o [Versionamento Semântico](https://semver.org/lang/pt-BR/).
Os arquivos de cada versão estão em [Releases](https://github.com/kayokalinauskas/ozamigos/releases).

O servidor e a versão web não têm número de versão: cada push na `main` vai para o ar no Render.

## [Não lançado]

### Novo
- **Quem usa muito a conexão de reserva perde só o vídeo, e continua conversando:** para quem não consegue se conectar direto aos amigos, a voz e o vídeo passam por um caminho de reserva, que tem um limite diário. Agora, ao passar dele, só o vídeo por esse caminho para até o dia seguinte, com um aviso explicando o motivo; a voz continua normalmente.
- **Conecta mesmo com redes mais fechadas:** quando dois amigos não conseguem se conectar direto (internet de operadora com IP compartilhado, 4G, rede de empresa), a voz, as imagens e a transmissão passam por um caminho de reserva, criptografadas. Quem conecta direto continua direto. (Servidor: a retransmissão TURN da Cloudflare, com credenciais por pessoa e limites de consumo para nunca passar da franquia gratuita; liga com as variáveis `OZAMIGOS_TURN_*` e `OZAMIGOS_CLOUDFLARE_*`.)

### Corrigido
- **A voz com um amigo que ficava em "conectando…" para sempre:** às vezes a combinação inicial entre os dois PCs não terminava (por exemplo, numa atualização do Ozamigos, com todos voltando juntos), e a voz entre aqueles dois nunca conectava, mesmo funcionando com os outros. Agora, se não conecta em 20 segundos, ela é refeita sozinha.

### Mudado
- **O Ozamigos lembra onde você estava:** ao abrir de novo, o app para Windows entra sozinho no último grupo ou sala em que você estava, como o Discord. Se você tinha saído com "Sair da sala", ele só mostra a entrada, já preenchida. Se a senha mudou ou a sala está cheia, a entrada aparece com o motivo. No navegador, a entrada vem preenchida com o último lugar. Para escolher outro, use "Ir para a entrada do Ozamigos" (nos grupos) ou o botão ao lado do campo da sala.
- **Chamar a atenção bem mais alto, e até 5 vezes por minuto:** o som de quem é chamado ficou bem mais alto que os outros avisos, para ser ouvido com o jogo ligado. E dá para chamar a mesma pessoa até 5 vezes por minuto (era uma).

## [1.2.21] - 2026-10-18

### Novo
- **O número de mensagens novas no ícone** (app para Windows): a marca de mensagens não lidas do chat agora mostra quantas são (de 1 a 9, e "9+"), sobre o ícone da barra de tarefas e no ícone perto do relógio (no canto de cima). Some quando você abre o chat. Antes, era um ponto verde sem número, e o ícone perto do relógio não mudava.
- **Chamar a atenção de um amigo:** clicando no nome dele, "Chamar" toca um som e mostra um aviso para ele, mesmo com o som do Ozamigos e as notificações desligados ("Voltei, volta aí também"). O aviso traz o botão para ligar o som. Uma vez por minuto para cada amigo. No app para Windows, o ícone também pisca na barra de tarefas.
- **Grupos com nome e senha seus:** na entrada, "Criar um grupo com outra senha" cria um grupo no endereço `.../nome-do-grupo`, com a senha que você escolher. Mande o link e a senha para os amigos. O grupo fica até o Ozamigos ser atualizado ou reiniciado, e quem abrir o link depois cria de novo, com a mesma senha, em um clique. O grupo de sempre continua na entrada, e ganhou o endereço fixo `.../ozamigos`, sempre na mesma sala.

### Corrigido
- **O botão de tela cheia da transmissão agora também sai dela:** antes ele só entrava, e era preciso apertar Esc.

## [1.2.20] - 2026-10-18

### Mudado
- **O som da transmissão mais perto da imagem:** o som do PC saía da sua máquina ~0,1 s depois da imagem. O caminho dele ficou mais curto (o auxiliar de som guarda menos e não perde o ritmo quando o Windows o considera em segundo plano, e o som vai direto ao processador de áudio, sem passar pela interface). Medido em 720p a 60 fps: o som chegava 0,11 s depois da imagem, agora 0,06 s.

### Corrigido
- **A sala caía transmitindo em 1080p** (principalmente a tela inteira, com Alt+Tab): o codificador H.265 da placa se perdia ao se ajustar no meio da transmissão, e a página do Ozamigos fechava. Em 1080p, a transmissão vai agora em H.264; em 720p, continua o H.265.

## [1.2.19] - 2026-10-17

### Corrigido
- **1080p e 60 fps sem atraso crescendo:** na 1.2.18, nessas qualidades, a imagem chegava ao app mais depressa do que a página dava conta, e o atraso da transmissão crescia sem parar (até segundos). Agora os quadros vão por um caminho próprio, fora da interface, e quando o PC aperta o app deixa um quadro de fora em vez de atrasar todos. Medido com o jogo aberto: 1080p a 60 fps com ~20 ms até a transmissão. As qualidades acima de 720p a 30 só aparecem a partir desta versão.

- **60 fps de verdade:** a captura do Windows entregava no máximo ~52 quadros por segundo num monitor acima de 60 Hz. Agora a transmissão a 60 fps sai a 60 (medido no jogo, em 720p e em 1080p).
- Trocar o que você transmite da captura nova para a antiga (Ctrl+Shift+N) no meio da transmissão encerrava a transmissão.

### Mudado
- **Captura mais firme com o jogo pesado:** a captura do app não espera mais a placa de vídeo nem a escrita de cada quadro, pega cada imagem assim que o Windows a entrega (sem pular quadros de um jogo a 60 fps), não perde o ritmo quando o Windows a considera "em segundo plano", e troca sozinha para a captura antiga se o driver da placa reiniciar.

## [1.2.18] - 2026-10-17

### Adicionado
- **Captura própria do app, mais fluida em jogo pesado:** o app passa a capturar a janela ou a tela direto do Windows e a reduzir a imagem na placa de vídeo, em vez de usar a captura do navegador. Num jogo que ocupa a placa inteira, a captura antiga ficava em ~21 fps; a nova dá 28–30 no mesmo jogo, com o cursor e sem a borda amarela do Windows. Se ela falhar no meio, a transmissão continua pela captura antiga, sozinha. As estatísticas dizem qual está valendo, e **Ctrl+Shift+N** na sala troca entre as duas (para comparar).
- **1080p e 60 fps, como opção:** na engrenagem, aba Geral, a qualidade da transmissão pode ir para 720p a 60 fps, 1080p a 30 ou 1080p a 60, com o custo explicado (mais internet de envio para cada amigo assistindo e mais placa de vídeo). O padrão continua 720p a 30 fps.
- **Prévia de links de vídeo no chat:** um link do YouTube, da Twitch, da Kick, do TikTok, do Streamable ou do Medal vira um cartão com a imagem, o título e o canal. O link de um canal da Twitch ou da Kick transmitindo mostra **AO VIVO**, o título da live e o jogo. Clique para abrir. Quem busca a prévia é o servidor: ninguém da sala acessa o site só por receber o link.

### Mudado
- **Imagem mais nítida nas transmissões, com a mesma internet:** quando a placa de vídeo de quem transmite e a de quem assiste aguentam, a transmissão vai em H.265 (HEVC) em vez de H.264. Medido: com os mesmos 4 Mbps, a imagem do H.265 ficou melhor que a do H.264 com 6,5 Mbps. Sem suporte de um dos lados, continua o H.264.

### Corrigido
- Uma imagem em pé esticava a miniatura da bandeja do chat por cima das mensagens, e passava da tela ao abrir em tamanho grande.

## [1.2.17] - 2026-10-17

### Adicionado
- **Imagens no chat:** cole um print com Ctrl+V, arraste para a sala ou use o botão de imagem (até 4 por vez, numa bandeja, e só vão com o Enter). Elas vão direto de um PC para o outro, sem passar pelo servidor, e nada fica guardado. Cada imagem é comprimida em WebP no tamanho da tela (até 2560×1440): um print de jogo de 8 MB chega com ~1 MB, com o texto legível. Clique para ver grande, copiar ou salvar. Se não chegar para alguém, aparece para quem e um "Tentar de novo".

- **Atalhos com o jogo na frente:** Ctrl+Shift+M liga e desliga o microfone e Ctrl+Shift+D o som, como no Discord, sem tirar a tecla do jogo. Na engrenagem, a aba nova **Atalhos** troca as teclas (até os botões laterais do mouse) e liga o **apertar para falar**. No navegador, os atalhos valem com a aba em foco.
- **Print da transmissão para o chat:** o botão de câmera no vídeo de quem você assiste põe o quadro na bandeja do chat; ele vai com o Enter.
- **Tela "Conectando…":** quando o servidor demora a responder, a janela aparece na hora com uma tela de espera, e a sala abre sozinha assim que ele responde. Antes, a janela podia levar até um minuto para aparecer.
- **A conexão com cada amigo:** um ícone de sinal ao lado do nome quando ela está instável ou ruim, e o tempo de ida e volta e a perda no menu de voz da pessoa.

### Mudado
- O teste de desempenho escondido passou de Ctrl+Shift+D para **Ctrl+Shift+X** (o D agora desliga o som).

### Corrigido
- **Amigo repetido na lista depois de um deploy:** quando todos voltavam juntos ao servidor (depois de um deploy, ou de uma queda), às vezes uma pessoa aparecia duas vezes na barra lateral, ocupando uma vaga a mais na contagem.

## [1.2.16] - 2026-10-17

### Adicionado
- **Convites que abrem o app:** um link `ozamigos://sala/...` abre o Ozamigos direto na sala. Com o app aberto em outra sala, ele pergunta antes de trocar. No navegador do Windows, o link de uma sala pergunta antes: abrir no app, baixar o app ou continuar no navegador. Se o app não abre, o download vira o botão principal, e o navegador lembra a escolha para os próximos links.

### Corrigido
- **O chat perdia o campo quando um amigo falava:** com o volume de um amigo aberto na barra lateral, cada vez que ele começava ou parava de falar, o foco pulava do chat para o volume dele.

## [1.2.15] - 2026-10-15

### Corrigido
- **O app abre na tela mesmo se a janela estava num monitor que foi desligado.** Antes, ele abria fora da tela e parecia não abrir.
- **Se a página do Ozamigos travar e cair, ela abre de novo sozinha**, em vez de deixar a janela vazia até um Ctrl+R.
- Recarregar a página no meio de uma transmissão com som não deixa mais o capturador de som do PC rodando à toa.
- A senha do grupo é conferida sem deixar o tempo de resposta revelar o tamanho dela.

## [1.2.14] - 2026-10-15

### Corrigido
- **A transmissão não fica mais presa em ~21 fps quando outro app fica entre o jogo e o Ozamigos** (por exemplo, o navegador com o YouTube, aberto antes de voltar para o jogo). O Windows 11 deixava o Ozamigos com o relógio mais lento por achar que ele estava escondido, e a captura só conseguia ~21 quadros por segundo, mesmo com a placa de vídeo folgada.

### Alterado
- **A imagem não cai mais de 720p.** Quando a internet aperta, a transmissão perde um pouco de nitidez ou de fps por alguns segundos e volta sozinha. Antes ela caía para 540p ou 360p e, em jogo pesado, ficava presa ali mesmo depois de a internet melhorar.
- **Menos atraso no celular:** a imagem não espera mais o som da transmissão. Num celular Android, ela chegava ~0,6 s atrasada por causa disso.

## [1.2.13] - 2026-10-14

### Alterado
- **A transmissão sai sempre em 720p a 30 fps**, como no Discord sem Nitro, e não há mais escolha de qualidade. As opções de 1080p e de 60 fps saíram: em jogo pesado, a captura já ficava entre 21 e 29 fps, e elas dobravam o custo de codificar e de enviar sem melhorar o que os amigos viam.
- Quando falta processador ou internet, a imagem de quem não aguenta diminui sozinha em vez de travar, e quem está bem continua em 720p.

### Adicionado
- **O Ozamigos fica na bandeja, como o Discord:** fechar a janela não encerra mais o app, e a conversa e as transmissões continuam. O ícone fica perto do relógio; para sair, clique nele com o botão direito e escolha **Sair**. Dá para desligar em Configurações → Geral.
- **Mensagens novas do chat na barra de tarefas:** um ponto verde no ícone do Ozamigos enquanto houver mensagem não vista, e o ícone pisca quando chega uma com o jogo na frente.
- **A tela não apaga no meio da sala:** com mais alguém na sala (conversando ou assistindo), o PC e o celular não apagam a tela nem dormem, como numa chamada do Discord.
- **Chat da sala**: mensagens de texto num painel à direita, com links clicáveis. Com o painel fechado, a mensagem aparece como aviso e o botão do chat mostra quantas são novas; com o app atrás do jogo, vira notificação do Windows. Nada fica guardado: quem entra depois não vê o que foi dito antes.
- A versão do app e da interface aparecem bem pequenas ao lado do logo e na tela de entrada.
- **Notificações do Windows à escolha:** na engrenagem, cada tipo liga e desliga (alguém entrou, começou a transmitir, mensagem no chat).
- As configurações ficaram em abas: **Voz e áudio**, **Notificações** e **Geral** (versão e servidor).

### Corrigido
- **No celular**, a página tinha rolagem de lado e os botões de Estatísticas e Chat só apareciam rolando. Agora tudo cabe na largura da tela, e o chat e as estatísticas abrem na tela inteira.
- No celular, ao voltar para a página do Ozamigos, a conexão com o servidor é conferida e refeita na hora, em vez de mostrar "Sem conexão" por vários segundos.
- No navegador e no celular, as configurações falam em "padrão do sistema", e não "do Windows".

### Segurança
- O freio contra quem tenta adivinhar a senha passa a usar o endereço informado pela Cloudflare, que não dá para forjar. Antes, quem forjava o cabeçalho X-Forwarded-For a cada tentativa escapava do freio.

## [1.2.12] - 2026-10-14

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
- **Por dentro:** as mensagens com o servidor ganharam um tipo para cada uma (`web/src/conexao/protocolo.ts`), e o núcleo da interface foi dividido em peças menores (sinalização, captura, medições, relatório). O servidor ganhou a verificação de saúde `/actuator/health`, para o Render reiniciá-lo se travar.
- **Menos atraso com o som do jogo:** a folga contra soluços da rede passou a valer só para o vídeo. Com ela também no som, a imagem esperava o som para os dois saírem juntos, e chegava ~200 ms mais tarde (medido num celular pelo Wi-Fi).
- **Menos congelamentos quando alguém começa a assistir:** cada pessoa nova recebe com metade do bitrate nos primeiros 6 segundos, enquanto o WebRTC mede a rede.
- **Captura abaixo da qualidade:** o aviso e o relatório agora apontam a causa mais comum, o jogo sem limite de fps ocupando a placa de vídeo, e sugerem limitar o jogo a 60 (num teste, a captura foi de 21 para 29 fps).
- **Relatório de estatísticas:** mede o buffer do som e a folga em uso, avisa quando outro programa (uma gravação em segundo plano) usa o codificador de vídeo da placa, e dá mais peso ao atraso quando a imagem espera além do limite da folga.

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

[Não lançado]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.21...HEAD
[1.2.21]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.20...v1.2.21
[1.2.20]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.19...v1.2.20
[1.2.19]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.18...v1.2.19
[1.2.18]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.17...v1.2.18
[1.2.17]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.16...v1.2.17
[1.2.16]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.15...v1.2.16
[1.2.15]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.14...v1.2.15
[1.2.14]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.13...v1.2.14
[1.2.13]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.12...v1.2.13
[1.2.12]: https://github.com/kayokalinauskas/ozamigos/compare/v1.2.11...v1.2.12
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
