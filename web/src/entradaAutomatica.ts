// A entrada automática (21/10/2026, pedido do dono): o app abre sempre na raiz, e a raiz volta ao último lugar em que
// a pessoa entrou (cliente.ts). Com tudo lembrado, ele entra sozinho, como o Discord. As regras ficam aqui, sem estado,
// para os testes; quem guarda e lê o localStorage é o cliente.

/** Guardado como 'sim' quando a pessoa sai de propósito, ou quando a última entrada automática foi recusada. */
export const NAO_ENTRAR_SOZINHO = 'ozamigos-nao-entrar-sozinho';

export type SituacaoDaAbertura = {
  /** A página abriu na raiz, sem link, e voltou ao último grupo ou à última sala. */
  voltouAoUltimo: boolean;
  /**
   * Só no app: no navegador, outra aba aberta na raiz entraria de novo com o mesmo nome (a pessoa duas vezes na sala,
   * e a voz dela voltando pela outra aba).
   */
  noApp: boolean;
  nome: string;
  senha: string;
  /** Saiu da sala de propósito, ou a última entrada automática foi recusada (sala cheia, grupo de outra pessoa). */
  naoEntrarSozinho: boolean;
  /**
   * Sem conta, com o login disponível, e a pessoa nunca escolheu entrar como convidado: a entrada fica na tela, com os
   * botões de login. Sem isso, quem atualizou para a 1.3.0 caía direto na sala e nem via que podia entrar com a conta.
   */
  loginPorEscolher: boolean;
};

/** Guardado como 'sim' quando a pessoa entra como convidado com os botões de login na tela. */
export const ESCOLHEU_CONVIDADO = 'ozamigos-escolheu-convidado';

export function deveEntrarSozinho(s: SituacaoDaAbertura): boolean {
  return s.voltouAoUltimo && s.noApp && s.nome.trim() !== '' && s.senha !== '' && !s.naoEntrarSozinho && !s.loginPorEscolher;
}
