import { Download } from 'lucide-react';
import { ponte } from '../ponte';
import { Versao } from './Versao';

export const SITE = 'https://kayokalinauskas.github.io/ozamigos/';

/**
 * Baixar o app (só no navegador), a política de privacidade e a versão. O app não mostra mais o endereço do servidor
 * nem o botão de trocar (pedido do dono, 28/10/2026): é sempre o oficial.
 */
export function RodapeDaEntrada() {
  return (
    <>
      {!ponte && (
        <a className="botao botao-fantasma botao-pequeno trocar-servidor" href={SITE}>
          <Download size={14} /> Baixar o app para Windows (som do jogo sem eco)
        </a>
      )}
      {/* Onde se entra com a conta, o link para a política (LGPD: a pessoa sabe como os dados são tratados). */}
      <a className="entrada-privacidade" href={`${SITE}privacidade.html`} target="_blank" rel="noopener noreferrer">
        Política de privacidade
      </a>
      <Versao />
    </>
  );
}
