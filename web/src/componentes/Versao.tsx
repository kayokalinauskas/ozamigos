import { ponte } from '../ponte';

/**
 * A versão, bem pequena: a do app para Windows (ou "web", no navegador) e o commit de onde a interface saiu.
 * O app carrega a interface do servidor, então as duas mudam separadas: o app a cada release, a interface a cada deploy.
 */
export function Versao() {
  const app = ponte?.versao ? `v${ponte.versao}` : 'web';
  const titulo = `${ponte?.versao ? `App para Windows ${ponte.versao}` : 'Versão web'}${__COMMIT__ ? ` · interface ${__COMMIT__}` : ''}`;
  return (
    <span className="versao" title={titulo}>
      {app}
      {__COMMIT__ && ` · ${__COMMIT__}`}
    </span>
  );
}
