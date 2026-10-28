import { Download, Server } from 'lucide-react';
import { ponte } from '../ponte';
import { Versao } from './Versao';

export const SITE = 'https://kayokalinauskas.github.io/ozamigos/';

/** O servidor (no app), baixar o app (no navegador), a política de privacidade e a versão. */
export function RodapeDaEntrada() {
  return (
    <>
      {ponte ? (
        <button type="button" className="botao botao-fantasma botao-pequeno trocar-servidor" onClick={() => ponte!.trocarServidor()}>
          <Server size={14} /> Servidor: {location.host}
        </button>
      ) : (
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
