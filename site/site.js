// Melhorias do site. Sem este script, tudo continua funcionando: os botões levam para a página da
// release e para o app no navegador.
(() => {
  'use strict';

  const API = 'https://api.github.com/repos/kayokalinauskas/ozamigos/releases/latest';
  const SERVIDOR = 'https://ozamigos.onrender.com/';
  const CHAVE = 'ozamigos-instalador';

  const lerGuardado = () => {
    try {
      const guardado = JSON.parse(sessionStorage.getItem(CHAVE) || 'null');
      return guardado && Date.now() - guardado.momento < 10 * 60 * 1000 ? guardado : null;
    } catch {
      return null;
    }
  };

  const guardar = (instalador) => {
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify(instalador));
    } catch {
      // sem armazenamento: só consulta de novo na próxima página
    }
  };

  /** O instalador mais recente: link direto, versão e tamanho. Guardado por 10 min (a API limita consultas). */
  async function instalador() {
    const guardado = lerGuardado();
    if (guardado) return guardado;
    const resposta = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!resposta.ok) return null;
    const release = await resposta.json();
    const arquivo = (release.assets || []).find((a) => /^Ozamigos-Instalador-.*\.exe$/.test(a.name));
    if (!arquivo) return null;
    const resultado = {
      versao: String(release.tag_name).replace(/^v/, ''),
      url: arquivo.browser_download_url,
      megabytes: Math.round(arquivo.size / 1024 / 1024),
      momento: Date.now(),
    };
    guardar(resultado);
    return resultado;
  }

  // Fora do Windows, o app não instala: o navegador vira o botão principal.
  if (!/Windows/i.test(navigator.userAgent)) {
    document.querySelectorAll('.chamada-botoes').forEach((grupo) => {
      const baixar = grupo.querySelector('[data-baixar]');
      const navegador = grupo.querySelector('[data-navegador]');
      baixar.classList.replace('botao-primario', 'botao-secundario');
      navegador.classList.replace('botao-secundario', 'botao-primario');
      grupo.prepend(navegador);
    });
  }

  instalador()
    .then((dados) => {
      if (!dados) return;
      document.querySelectorAll('[data-baixar]').forEach((link) => {
        link.href = dados.url;
        link.addEventListener('click', () => {
          document.querySelectorAll('[data-depois]').forEach((aviso) => (aviso.hidden = false));
        });
      });
      document.querySelectorAll('[data-versao]').forEach((campo) => {
        campo.textContent = `Versão ${dados.versao} · ${dados.megabytes} MB · `;
      });
    })
    .catch(() => {
      // sem internet ou API fora: os botões continuam levando para a página da release
    });

  // O servidor gratuito dorme quando ninguém usa e leva até um minuto para acordar. Um pedido
  // pequeno logo que o site abre já o acorda, e "Usar no navegador" abre rápido.
  const acordar = () => fetch(`${SERVIDOR}icone.svg`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(acordar, { timeout: 3000 });
  else setTimeout(acordar, 1500);
})();
