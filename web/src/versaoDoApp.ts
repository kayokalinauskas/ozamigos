// O instalador mais recente, lido das releases do GitHub: a página de apresentação mostra a versão e
// o tamanho e baixa o arquivo direto. Sem resposta (sem internet, limite da API), o botão leva para a
// página da release, que sempre tem o instalador.

import { useEffect, useState } from 'react';

export const REPOSITORIO = 'https://github.com/kayokalinauskas/ozamigos';
export const PAGINA_DA_RELEASE = `${REPOSITORIO}/releases/latest`;
const API = 'https://api.github.com/repos/kayokalinauskas/ozamigos/releases/latest';

export type Instalador = { versao: string; url: string; megabytes: number };

type Release = { tag_name: string; assets: { name: string; size: number; browser_download_url: string }[] };

let pedido: Promise<Instalador | null> | null = null; // uma consulta por visita, mesmo voltando à página

function buscarInstalador(): Promise<Instalador | null> {
  pedido ??= fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then((resposta) => (resposta.ok ? (resposta.json() as Promise<Release>) : null))
    .then((release) => {
      const arquivo = release?.assets.find((a) => /^Ozamigos-Instalador-.*\.exe$/.test(a.name));
      if (!release || !arquivo) return null;
      return {
        versao: release.tag_name.replace(/^v/, ''),
        url: arquivo.browser_download_url,
        megabytes: Math.round(arquivo.size / 1024 / 1024),
      };
    })
    .catch(() => null);
  return pedido;
}

/** null enquanto carrega ou se não deu para consultar. */
export function useInstalador(): Instalador | null {
  const [instalador, setInstalador] = useState<Instalador | null>(null);
  useEffect(() => {
    let ativo = true;
    buscarInstalador().then((resultado) => ativo && setInstalador(resultado));
    return () => {
      ativo = false;
    };
  }, []);
  return instalador;
}
