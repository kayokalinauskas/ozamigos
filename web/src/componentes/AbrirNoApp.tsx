import { useEffect, useRef, useState } from 'react';
import { AppWindow, Check, Download, Globe, LoaderCircle } from 'lucide-react';
import { lembrado, lembrar } from '../armazenamento';
import { linkDoAppParaConvite } from '../conexao/codigoDaSala';
import { SITE } from './RodapeDaEntrada';

/** Este navegador já abriu um convite no app: os próximos tentam o app sozinhos. */
export const TEM_O_APP = 'ozamigos-tem-o-app';
/** A pessoa escolheu ficar no navegador: os próximos convites vão direto para a página do convite. */
export const FICA_NO_NAVEGADOR = 'ozamigos-fica-no-navegador';
/** Quanto esperar o Windows passar para o app antes de oferecer o download. */
const PRAZO_DO_APP = 2500;

type Etapa = 'pergunta' | 'abrindo' | 'abriu' | 'nao-abriu';

let jaTentouSozinho = false; // o StrictMode monta duas vezes: o app só pode ser chamado uma

/**
 * Quem abre o link de um convite (/c/<codigo>) no navegador do Windows escolhe, como no Discord: abrir no app, baixar
 * o app ou ficar no navegador. A página não tem como saber se o app está instalado (o navegador esconde isso de
 * propósito: seria um jeito de identificar o PC). Ela tenta abrir o link ozamigos://convite/<codigo> e observa: se a
 * janela perde o foco, o Windows passou para o app (ou o navegador perguntou se pode abrir); se nada acontece, o app
 * provavelmente não está instalado.
 */
export function AbrirNoApp({ convite, aoContinuar }: { convite: string; aoContinuar: () => void }) {
  const [etapa, setEtapa] = useState<Etapa>('pergunta');
  const desligar = useRef<(() => void) | null>(null);

  function abrirNoApp() {
    desligar.current?.();
    setEtapa('abrindo');
    // O foco pode sair só depois do prazo (a pessoa demorou para aceitar o "Abrir o Ozamigos?" do navegador):
    // por isso a escuta continua depois dele.
    const abriu = () => {
      lembrar(TEM_O_APP, '1');
      setEtapa('abriu');
      desligar.current?.();
    };
    const escondeu = () => document.visibilityState === 'hidden' && abriu();
    const prazo = setTimeout(() => setEtapa((e) => (e === 'abrindo' ? 'nao-abriu' : e)), PRAZO_DO_APP);
    window.addEventListener('blur', abriu);
    document.addEventListener('visibilitychange', escondeu);
    desligar.current = () => {
      clearTimeout(prazo);
      window.removeEventListener('blur', abriu);
      document.removeEventListener('visibilitychange', escondeu);
    };
    location.href = linkDoAppParaConvite(convite);
  }

  function continuar() {
    desligar.current?.();
    lembrar(FICA_NO_NAVEGADOR, '1');
    aoContinuar();
  }

  useEffect(() => {
    // Este navegador já abriu um convite no app: tenta de novo sem perguntar (os botões continuam ali).
    if (lembrado(TEM_O_APP) && !jaTentouSozinho) {
      jaTentouSozinho = true;
      abrirNoApp();
    }
    return () => desligar.current?.();
  }, []);

  return (
    <div className="convite" aria-live="polite">
      {etapa === 'abriu' ? (
        <>
          <p className="convite-titulo">
            <Check size={20} /> Convite aberto no app
          </p>
          <p className="subtitulo">Pode fechar esta aba.</p>
          <button type="button" className="botao botao-fantasma botao-pequeno trocar-servidor" onClick={continuar}>
            <Globe size={14} /> Prefiro continuar no navegador
          </button>
        </>
      ) : (
        <>
          <p className="convite-titulo">Convite para um servidor do Ozamigos</p>
          <p className="subtitulo">
            {etapa === 'nao-abriu'
              ? 'O app não abriu. Se o navegador perguntou, escolha Abrir; se você ainda não tem o app, baixe para Windows.'
              : 'Abra no app ou continue no navegador.'}
          </p>
          {etapa === 'nao-abriu' ? (
            <>
              <a className="botao botao-primario botao-grande" href={SITE}>
                <Download size={18} /> Baixar o app para Windows
              </a>
              <button type="button" className="botao botao-secundario" onClick={abrirNoApp}>
                <AppWindow size={16} /> Tentar abrir no app de novo
              </button>
            </>
          ) : (
            <>
              <button type="button" className="botao botao-primario botao-grande" onClick={abrirNoApp} disabled={etapa === 'abrindo'}>
                {etapa === 'abrindo' ? (
                  <>
                    <LoaderCircle size={18} className="girando" /> Abrindo o app…
                  </>
                ) : (
                  <>
                    <AppWindow size={18} /> Abrir no app
                  </>
                )}
              </button>
              <a className="botao botao-secundario" href={SITE}>
                <Download size={16} /> Não tenho o app: baixar para Windows
              </a>
            </>
          )}
          <button type="button" className="botao botao-fantasma botao-pequeno trocar-servidor" onClick={continuar}>
            <Globe size={14} /> Continuar no navegador
          </button>
        </>
      )}
    </div>
  );
}
