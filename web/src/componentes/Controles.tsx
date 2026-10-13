import { useEffect, useRef, useState } from 'react';
import { AppWindow, ChartColumn, ChevronUp, Monitor, MonitorUp, MonitorX, RefreshCw, TriangleAlert } from 'lucide-react';
import { cliente } from '../cliente';
import { noApp } from '../ponte';
import { QUALIDADES, capturaAbaixo, ehQualidade } from '../qualidade';
import { useCliente } from '../useCliente';

type Props = { estatisticasAbertas: boolean; aoAlternarEstatisticas: () => void };

export function Controles({ estatisticasAbertas, aoAlternarEstatisticas }: Props) {
  const { minhaTela, qualidade, metricas } = useCliente();
  const podeCapturar = Boolean(navigator.mediaDevices?.getDisplayMedia);
  const transmitindo = minhaTela !== null;
  const capturaBaixa = transmitindo
    ? capturaAbaixo(
        Object.values(metricas).filter((m) => m.canal === 'envio').map((m) => m.captura),
        qualidade,
      )
    : null;

  return (
    <footer className="controles">
      <div className="controles-grupo">
        {podeCapturar ? (
          <BotaoTransmitir transmitindo={transmitindo} />
        ) : (
          <span className="ajuda">Para transmitir, use o app para Windows, o Chrome ou o Edge no computador.</span>
        )}
        {transmitindo && (
          <button type="button" className="botao botao-perigo" onClick={() => cliente.pararDeTransmitir(true)}>
            <MonitorX size={18} /> Parar
          </button>
        )}
      </div>

      <div className="controles-grupo">
        {capturaBaixa !== null && (
          <button
            type="button"
            className="aviso-captura"
            onClick={() => !estatisticasAbertas && aoAlternarEstatisticas()}
            title={`Seu PC está copiando ${capturaBaixa} fps da imagem do jogo, menos do que a qualidade pede. Os amigos veem no máximo isso. Não é a internet. Clique para ver as estatísticas.`}
          >
            <TriangleAlert size={16} aria-hidden="true" /> Captura a {capturaBaixa} fps
          </button>
        )}
        <label className="seletor-qualidade">
          <span className="rotulo">Qualidade</span>
          <select
            value={qualidade}
            onChange={(e) => ehQualidade(e.target.value) && void cliente.mudarQualidade(e.target.value)}
            title="Muda na hora, sem derrubar ninguém"
          >
            {Object.entries(QUALIDADES).map(([valor, { rotulo, detalhe }]) => (
              <option key={valor} value={valor}>
                {rotulo} ({detalhe})
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="botao botao-secundario" aria-pressed={estatisticasAbertas} onClick={aoAlternarEstatisticas}>
          <ChartColumn size={18} /> Estatísticas
        </button>
      </div>
    </footer>
  );
}

/**
 * No app para Windows, um botão só: o seletor do Ozamigos mostra janelas e telas juntas.
 * No navegador, o seletor é o do próprio navegador, então perguntamos antes o que abrir.
 */
function BotaoTransmitir({ transmitindo }: { transmitindo: boolean }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuAberto) return;
    const fechar = (evento: MouseEvent | KeyboardEvent) => {
      if (evento instanceof KeyboardEvent ? evento.key === 'Escape' : !menu.current?.contains(evento.target as Node)) {
        setMenuAberto(false);
      }
    };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('keydown', fechar);
    return () => {
      document.removeEventListener('mousedown', fechar);
      document.removeEventListener('keydown', fechar);
    };
  }, [menuAberto]);

  const rotulo = transmitindo ? 'Trocar o que transmito' : 'Transmitir';
  const Icone = transmitindo ? RefreshCw : MonitorUp;
  const classe = transmitindo ? 'botao botao-secundario' : 'botao botao-primario';

  if (noApp) {
    return (
      <button type="button" className={classe} onClick={() => void cliente.transmitir('escolher')}>
        <Icone size={18} /> {rotulo}
      </button>
    );
  }
  return (
    <div className="menu-transmitir" ref={menu}>
      <button type="button" className={classe} aria-expanded={menuAberto} aria-haspopup="menu" onClick={() => setMenuAberto(!menuAberto)}>
        <Icone size={18} /> {rotulo} <ChevronUp size={16} />
      </button>
      {menuAberto && (
        <div className="menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuAberto(false);
              void cliente.transmitir('aplicativo');
            }}
          >
            <AppWindow size={18} />
            <span>
              Um aplicativo
              <small>Só a janela do jogo. Sem som pelo navegador.</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuAberto(false);
              void cliente.transmitir('tela');
            }}
          >
            <Monitor size={18} />
            <span>
              A tela inteira
              <small>Com o som do PC: marque "Compartilhar áudio do sistema".</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
