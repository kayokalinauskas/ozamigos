import { useEffect, useRef, useState } from 'react';
import { AppWindow, Monitor } from 'lucide-react';
import { lembrado, lembrar } from '../armazenamento';
import { aoCarregarSeletor, ponte, responderFonte, type FonteDeCaptura } from '../ponte';
import { qualidadeEscolhida } from '../escolhaDeQualidade';
import { prepararVideoDoApp, usarCapturaDoApp } from '../videoDoApp';

type Fase = 'fechado' | 'carregando' | 'escolhendo';

/**
 * O seletor do app para Windows: janelas e telas com miniaturas, e o som do PC com um clique.
 * Ele aparece quando a página pede getDisplayMedia; o Electron espera a resposta para começar a captura.
 * Abre já no clique em Transmitir ("carregando"), e as fontes entram quando o app termina de listá-las.
 */
export function SeletorDeFonte() {
  const [fase, setFase] = useState<Fase>('fechado');
  const [fontes, setFontes] = useState<FonteDeCaptura[]>([]);
  const [aba, setAba] = useState<FonteDeCaptura['tipo']>('janela');
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [audio, setAudio] = useState(() => lembrado('ozamigos-audio') !== 'nao');
  const dialogo = useRef<HTMLDialogElement>(null);
  // Cancelou enquanto o app ainda listava: quando a lista chegar, a resposta já é "nada".
  const cancelouAntes = useRef(false);

  useEffect(() => {
    ponte?.aoPedirFonte((novas) => {
      if (cancelouAntes.current) {
        cancelouAntes.current = false;
        responderFonte(null);
        return;
      }
      setFontes(novas);
      setEscolhida(null);
      setAba(novas.some((f) => f.tipo === 'janela') ? 'janela' : 'tela');
      setFase('escolhendo');
    });
    return aoCarregarSeletor((carregando) => {
      if (carregando) {
        cancelouAntes.current = false;
        setFase((atual) => (atual === 'fechado' ? 'carregando' : atual));
      } else {
        setFase('fechado'); // a captura terminou (ou o app recusou antes de mostrar as fontes)
      }
    });
  }, []);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    if (fase !== 'fechado' && !elemento.open) elemento.showModal();
    if (fase === 'fechado' && elemento.open) elemento.close();
  }, [fase]);

  if (!ponte) return null;

  function responder(id: string | null) {
    if (fase === 'carregando') {
      cancelouAntes.current = true; // ainda não há pedido do app para responder
    } else {
      lembrar('ozamigos-audio', audio ? '' : 'nao');
      // A captura do app (1.2.18 em diante), a não ser que a antiga esteja escolhida (Ctrl+Shift+N na sala).
      const captura = id && usarCapturaDoApp() ? prepararVideoDoApp(qualidadeEscolhida()) : null;
      responderFonte(id ? { id, audio, captura } : null);
    }
    setFase('fechado');
  }

  const carregando = fase === 'carregando';
  const visiveis = fontes.filter((f) => f.tipo === aba);

  return (
    <dialog
      ref={dialogo}
      className="seletor"
      aria-labelledby="titulo-seletor"
      aria-busy={carregando}
      onCancel={(e) => {
        e.preventDefault();
        responder(null); // Esc cancela, e o Electron precisa saber
      }}
    >
      {fase !== 'fechado' && (
        <>
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
            {carregando &&
              Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="fonte fonte-reservada" aria-hidden="true">
                  <span className="fonte-reservada-imagem" />
                  <span className="fonte-reservada-nome" />
                </div>
              ))}
            {!carregando &&
              visiveis.map((fonte) => (
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
            {!carregando && visiveis.length === 0 && <p className="ajuda">Nada para mostrar aqui.</p>}
          </div>
          <p className="visualmente-escondido" aria-live="polite">
            {carregando ? 'Procurando janelas e telas…' : ''}
          </p>

          <footer>
            <label className="caixa">
              <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
              <span>
                Transmitir o som do PC
                <small>Vai o som do PC, sem a voz dos amigos.</small>
              </span>
            </label>
            <div className="botoes">
              <button type="button" className="botao botao-secundario" onClick={() => responder(null)}>
                Cancelar
              </button>
              <button type="button" className="botao botao-primario" disabled={!escolhida || carregando} onClick={() => responder(escolhida)}>
                Transmitir
              </button>
            </div>
          </footer>
        </>
      )}
    </dialog>
  );
}
