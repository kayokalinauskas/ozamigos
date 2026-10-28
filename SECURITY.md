# Segurança

## Como relatar uma falha

**Não abra uma issue pública.** Use o relato privado do GitHub: aba **Security** → **Report a vulnerability** ([link direto](../../security/advisories/new)).

Inclua, se puder:

- o que a falha permite fazer (por exemplo, entrar num servidor sem convite, agir na conta de outra pessoa ou ver a transmissão de outra sala);
- os passos para reproduzir;
- a versão do app ou o commit do servidor.

Você recebe uma resposta assim que possível. A correção sai numa versão nova, e o relato fica público depois disso, com o seu crédito, se quiser.

## Versões cobertas

Só a [versão mais recente](../../releases/latest) do app e a `main` do servidor recebem correções.

## Como o app se protege

- **Contas:** o login é feito no Google ou no Discord (OAuth com PKCE), e o Ozamigos não guarda senha, e-mail nem token deles. A sessão é um segredo aleatório de 256 bits num cookie `HttpOnly`, `Secure` e `SameSite=Lax`; o banco guarda só o resumo (SHA-256). Em Configurações → Conta, dá para sair de todos os aparelhos de uma vez.
- **Servidores:** só entra quem é membro, e só vira membro quem tem um convite. Para quem não é membro, um servidor que existe e um que não existe respondem igual. Quem é expulso fica bloqueado até o dono ou um admin desbloquear.
- **API:** as ações só valem vindas da própria página (o `Origin` é conferido, contra CSRF). Pedidos grandes demais e pedidos em excesso de um mesmo endereço são recusados antes de qualquer outra coisa, e cada conta tem limites de ações e de contas novas.
- **Login do app:** pelo navegador do sistema, com uma porta só no `127.0.0.1` e um estado sorteado pelo app (RFC 8252). Ligar outro provedor pelo app só vale depois que o próprio app confirma: um link de ligação mandado por outra pessoa não liga nada.
- **Sinalização:** só páginas do próprio servidor abrem o WebSocket, com limite de conexões por endereço. O servidor diz quem enviou cada mensagem e só repassa dentro da mesma sala.
- **Links e imagens:** as prévias de links só buscam sites de uma lista fechada; as imagens vindas de fora são redesenhadas no servidor, sem metadados.
- **App para Windows:** roda isolado (`contextIsolation`, `sandbox`, sem `nodeIntegration`), e as permissões só valem para o servidor configurado.
- **Voz e vídeo:** criptografados de ponta a ponta, mesmo quando passam pela retransmissão. A retransmissão tem limites de consumo por pessoa e no total.

## Limitações conhecidas

- A sessão fica salva no navegador ou no app de quem entrou: num PC compartilhado, saia da conta (ou de todos os aparelhos, se esqueceu).
- Quem está na mesma sala pode ver o endereço IP dos outros (a conexão é direta entre os participantes).
- O instalador não tem assinatura digital, então o Windows avisa na primeira execução.
