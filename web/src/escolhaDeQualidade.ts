// A qualidade escolhida na engrenagem do app (aba Geral). Fica fora de qualidade.ts de propósito: lá não pode haver
// nada da janela (a ponte, o localStorage), porque os workers da gravação das estatísticas importam qualidade.ts.

import { lembrado, lembrar } from './armazenamento';
import { ponte } from './ponte';
import { QUALIDADE, QUALIDADES, type Qualidade } from './qualidade';

const CHAVE = 'ozamigos-resolucao'; // o id da qualidade escolhida na engrenagem (a chave antiga, ozamigos-qualidade, é apagada)

/**
 * As qualidades acima do padrão precisam do canal direto da captura do app (1.2.19 em diante). No app 1.2.18, os
 * quadros passavam pela thread da página, que não dava conta: em 1080p a 60, o atraso crescia sem parar.
 */
export function qualidadesAltas(): boolean {
  return Boolean(ponte?.video?.canalDireto);
}

/** A qualidade das próximas transmissões: a escolhida na engrenagem, ou o padrão (720p · 30). */
export function qualidadeEscolhida(): Qualidade {
  const guardada = lembrado(CHAVE);
  return Object.hasOwn(QUALIDADES, guardada) && qualidadesAltas() ? (guardada as Qualidade) : QUALIDADE;
}

export function escolherQualidade(qualidade: Qualidade) {
  lembrar(CHAVE, qualidade === QUALIDADE ? '' : qualidade);
}

