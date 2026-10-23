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

## Como o app se protege

- **Senha do grupo:** fica só na variável de ambiente, é conferida antes de qualquer outra coisa e é comparada em tempo constante. Depois de 10 senhas erradas em 5 minutos, o mesmo endereço é bloqueado.
- **Sinalização:** só páginas do próprio servidor abrem o WebSocket. O servidor diz quem enviou cada mensagem e só repassa dentro da mesma sala.
- **App para Windows:** roda isolado (`contextIsolation`, `sandbox`, sem `nodeIntegration`), e as permissões só valem para o servidor configurado.
- **Voz e vídeo:** criptografados de ponta a ponta, mesmo quando passam pela retransmissão. A retransmissão tem limites de consumo por pessoa e no total.

## Limitações conhecidas

- A senha do grupo fica salva no navegador ou no app de quem entrou. Num PC compartilhado, outra pessoa pode lê-la.
- Os grupos criados na hora existem só na memória e somem quando o servidor reinicia.
- O instalador não tem assinatura digital, então o Windows avisa na primeira execução.
