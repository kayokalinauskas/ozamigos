import { useEffect, useRef, useState } from 'react';
import { AppWindow, Monitor } from 'lucide-react';
import { lembrado, lembrar } from '../armazenamento';
import { ponte, type FonteDeCaptura } from '../ponte';

/**
 * O seletor do app para Windows: janelas e telas com miniaturas, e o som do PC com um clique.
 * Ele aparece quando a página pede getDisplayMedia; o Electron espera a resposta para começar a captura.
 */
export function SeletorDeFonte() {
  const [fontes, setFontes] = useState<FonteDeCaptura[] | null>(null);
  const [aba, setAba] = useState<FonteDeCaptura['tipo']>('janela');
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [audio, setAudio] = useState(() => lembrado('ozamigos-audio') !== 'nao');
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ponte?.aoPedirFonte((novas) => {
      setFontes(novas);
      setEscolhida(null);
      setAba(novas.some((f) => f.tipo === 'janela') ? 'janela' : 'tela');
    });
  }, []);

  useEffect(() => {
    if (fontes) dialogo.current?.showModal();
  }, [fontes]);

  if (!ponte || !fontes) return null;

  function responder(id: string | null) {
    lembrar('ozamigos-audio', audio ? '' : 'nao');
    ponte!.responderFonte(id ? { id, audio } : null);
    dialogo.current?.close();
    setFontes(null);
  }

  const visiveis = fontes.filter((f) => f.tipo === aba);

  return (
    <dialog
      ref={dialogo}
      className="seletor"
      aria-labelledby="titulo-seletor"
      onCancel={(e) => {
        e.preventDefault();
        responder(null); // Esc cancela, e o Electron precisa saber
      }}
    >
      <header>
        <h2 id="titulo-seletor">O que você quer transmitir?</h2>
        <div className="segmentado" role="tablist">
          <button type="button" role="tab" aria-selected={aba === 'janela'} aria-pressed={aba === 'janela'} onClick={() => setAba('janela')}>
            <AppWindow size={16} /> Janelas
          </button>
          <button type="button" role="tab" aria-selected={aba === 'tela'} aria-pressed={aba === 'tela'} onClick={() => setAba('tela')}>
            <Monitor size={16} /> Telas
          </button>
        </div>
      </header>

      <div className="fontes" role="listbox" aria-label={aba === 'janela' ? 'Janelas abertas' : 'Telas'}>
        {visiveis.map((fonte) => (
          <button
            key={fonte.id}
            type="button"
            role="option"
            aria-selected={escolhida === fonte.id}
            className="fonte"
            onClick={() => setEscolhida(fonte.id)}
            onDoubleClick={() => responder(fonte.id)}
          >
            <img src={fonte.miniatura} alt="" />
            <span className="fonte-nome">
              {fonte.icone && <img src={fonte.icone} alt="" width={16} height={16} />}
              <span>{fonte.nome}</span>
            </span>
          </button>
        ))}
        {visiveis.length === 0 && <p className="ajuda">Nada para mostrar aqui.</p>}
      </div>

      <footer>
        <label className="caixa">
          <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
          <span>
            Transmitir o som do PC
            <small>Vai o som do computador inteiro: jogo, música e também o das transmissões que você está ouvindo.</small>
          </span>
        </label>
        <div className="botoes">
          <button type="button" className="botao botao-secundario" onClick={() => responder(null)}>
            Cancelar
          </button>
          <button type="button" className="botao botao-primario" disabled={!escolhida} onClick={() => responder(escolhida)}>
            Transmitir
          </button>
        </div>
      </footer>
    </dialog>
  );
}
