import { lembrado, lembrar } from './armazenamento';

// Quais acontecimentos viram notificação do Windows (ou do navegador). Elas só aparecem com o Ozamigos atrás de
// outra janela, o jogo por exemplo; com ele na frente, o aviso na tela basta. Cada tipo liga e desliga na engrenagem.

export type TipoDeNotificacao = 'entrou' | 'transmissao' | 'chat';

export const TIPOS_DE_NOTIFICACAO: { tipo: TipoDeNotificacao; titulo: string }[] = [
  { tipo: 'entrou', titulo: 'Alguém entrou na sala' },
  { tipo: 'transmissao', titulo: 'Alguém começou a transmitir' },
  { tipo: 'chat', titulo: 'Mensagens do chat' },
];

// Guarda só as desligadas: quem nunca mexeu recebe todas, e um tipo novo já nasce ligado.
const CHAVE = 'ozamigos-notificacoes-desligadas';

function desligadas(): string[] {
  return lembrado(CHAVE).split(',').filter(Boolean);
}

export function notificacaoLigada(tipo: TipoDeNotificacao): boolean {
  return !desligadas().includes(tipo);
}

export function ligarNotificacao(tipo: TipoDeNotificacao, ligada: boolean): void {
  const outras = desligadas().filter((t) => t !== tipo);
  lembrar(CHAVE, (ligada ? outras : [...outras, tipo]).join(','));
}
