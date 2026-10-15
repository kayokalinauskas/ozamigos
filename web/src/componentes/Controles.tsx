import { useEffect, useRef, useState } from 'react';
import { AppWindow, ArrowDown, ChartColumn, ChevronUp, MessageSquare, Monitor, MonitorUp, MonitorX, RefreshCw, TriangleAlert } from 'lucide-react';
import { cliente } from '../cliente';
import { noApp } from '../ponte';
import { QUALIDADES, capturaAbaixo, ehQualidade } from '../qualidade';
import { useCliente } from '../useCliente';

type Props = { estatisticasAbertas: boolean; aoAlternarEstatisticas: () => void };

export function Controles({ estatisticasAbertas, aoAlternarEstatisticas }: Props) {
  const { minhaTela, qualidade, qualidadeEscolhida, qualidadeReduzida, enviosReduzidos, metricas, chatAberto, chatNaoLidas } = useCliente();
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
            title={`Seu PC está copiando ${capturaBaixa} fps da imagem do jogo, menos do que a qualidade pede, e os amigos veem no máximo isso. Não é a internet: quase sempre é o jogo sem limite de fps ocupando a placa de vídeo. Limite o fps do jogo a 60 (ou ligue o VSync). Clique para ver as estatísticas.`}
          >
            <TriangleAlert size={16} aria-hidden="true" /> Captura a {capturaBaixa} fps
          </button>
        )}
        {transmitindo && (qualidadeReduzida || enviosReduzidos.length > 0) && (
          <button
            type="button"
            className="aviso-captura"
            onClick={() => !estatisticasAbertas && aoAlternarEstatisticas()}
            title={
              qualidadeReduzida
                ? `Seu PC não estava dando conta de ${QUALIDADES[qualidadeEscolhida].rotulo}, e a transmissão desceu sozinha para não travar. Ela volta quando folgar. Clique para ver as estatísticas.`
                : `A conexão com ${enviosReduzidos.map((id) => cliente.nomeDe(id)).join(', ')} não aguentava ${QUALIDADES[qualidadeEscolhida].rotulo}: só ${enviosReduzidos.length === 1 ? 'essa pessoa recebe' : 'essas pessoas recebem'} uma imagem menor, e os outros continuam na qualidade escolhida. Volta sozinho quando folgar. Clique para ver as estatísticas.`
            }
          >
            <ArrowDown size={16} aria-hidden="true" />{' '}
            {qualidadeReduzida
              ? `Em ${QUALIDADES[qualidade].rotulo.split(' ')[0]}`
              : `720p para ${enviosReduzidos.length === 1 ? cliente.nomeDe(enviosReduzidos[0]) : `${enviosReduzidos.length} amigos`}`}
          </button>
        )}
        <label className="seletor-qualidade">
          <span className="rotulo">Qualidade</span>
          <select
            value={qualidadeEscolhida}
            onChange={(e) => ehQualidade(e.target.value) && void cliente.mudarQualidade(e.target.value)}
            title="Muda na hora, sem derrubar ninguém. A 1080p pesa mais para o seu PC, a sua internet e o PC de quem assiste; se não der conta, a transmissão desce sozinha para 720p."
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
        <button
          type="button"
          className="botao botao-secundario botao-chat"
          aria-pressed={chatAberto}
          aria-label={chatNaoLidas ? `Chat, ${chatNaoLidas} ${chatNaoLidas === 1 ? 'mensagem nova' : 'mensagens novas'}` : 'Chat'}
          onClick={() => cliente.abrirChat(!chatAberto)}
        >
          <MessageSquare size={18} /> Chat
          {chatNaoLidas > 0 && <span className="contador-nao-lidas">{chatNaoLidas > 99 ? '99+' : chatNaoLidas}</span>}
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
