import { useEffect, useState } from 'react';
import { Eye, LayoutGrid, Link, MonitorUp, RectangleHorizontal, Volume2, VolumeX } from 'lucide-react';
import { cliente, linkDaSala } from '../cliente';
import { useCliente, useNumeroLembrado } from '../useCliente';
import { Avatar } from './Avatar';
import { Transmissao } from './Transmissao';

export type Modo = 'grade' | 'destaque';

type Props = {
  modo: Modo;
  aoMudarModo: (modo: Modo) => void;
  foco: string | null;
  aoDestacar: (id: string) => void;
};

/** Todos na sala veem quando alguém grava as estatísticas (Ctrl+Shift+G); quem grava vê também o tempo. */
function SeloDeGravacao() {
  const { gravacaoDaSala, meuId } = useCliente();
  const minha = gravacaoDaSala !== null && gravacaoDaSala.id === meuId;
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    if (!minha) return;
    const inicio = Date.now();
    setSegundos(0);
    const relogio = setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => clearInterval(relogio);
  }, [minha]);
  if (!gravacaoDaSala) return null;
  const tempo = `${String(Math.floor(segundos / 60)).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}`;
  return (
    <span
      className="gravando selo-gravando"
      role="status"
      title={
        minha
          ? 'As medidas de todos chegam aqui e são salvas sozinhas a cada 30 s em Documentos\\Ozamigos\\Estatísticas. Ctrl+Shift+G para parar.'
          : 'O Ozamigos manda para essa pessoa como as transmissões chegam aqui. Você não precisa fazer nada.'
      }
    >
      <span className="ponto" />
      {minha ? `Gravando estatísticas · ${tempo}` : `${gravacaoDaSala.nome} está gravando as estatísticas`}
    </span>
  );
}

export function Palco({ modo, aoMudarModo, foco, aoDestacar }: Props) {
  const { transmitindo, assistindo, meuId, pessoas, sala } = useCliente();
  const [volumeGeral, setVolumeGeral] = useNumeroLembrado('ozamigos-volume-geral', 100);
  const [geralMudo, setGeralMudo] = useState(false);

  // No palco, só o que eu escolhi assistir e que está no ar agora (na ordem em que escolhi).
  const noPalco = assistindo.filter((id) => transmitindo.includes(id));
  // Quem está no ar, mas eu ainda não assisto: viram cartões com "Assistir".
  const disponiveis = transmitindo.filter((id) => id !== meuId && !assistindo.includes(id));
  const emFoco = noPalco.includes(foco ?? '') ? foco! : noPalco[0];
  const destaque = modo === 'destaque' && noPalco.length > 1;
  const volume = geralMudo ? 0 : volumeGeral;

  return (
    <section className="palco" aria-label="Transmissões">
      <header className="palco-topo">
        <h1>
          Transmissões
          {noPalco.length > 0 && <span className="contador">{noPalco.length}</span>}
          <SeloDeGravacao />
        </h1>
        <div className="palco-ferramentas">
          <div className="segmentado" role="group" aria-label="Layout">
            <button type="button" aria-pressed={modo === 'grade'} onClick={() => aoMudarModo('grade')} title="Grade">
              <LayoutGrid size={16} /> Grade
            </button>
            <button type="button" aria-pressed={modo === 'destaque'} onClick={() => aoMudarModo('destaque')} title="Uma em destaque">
              <RectangleHorizontal size={16} /> Destaque
            </button>
          </div>
          <div className="volume-geral">
            <button
              type="button"
              className="botao-icone"
              aria-label={geralMudo ? 'Ativar o som de todas' : 'Silenciar todas'}
              onClick={() => setGeralMudo(!geralMudo)}
            >
              {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => {
                setGeralMudo(false);
                setVolumeGeral(Number(e.target.value));
              }}
              aria-label="Volume geral"
              style={{ '--preenchido': `${volume}%` } as React.CSSProperties}
            />
          </div>
        </div>
      </header>

      {noPalco.length > 0 && destaque ? (
        <div className="videos videos-destaque">
          <Transmissao key={emFoco} id={emFoco} volumeGeral={volume} principal />
          <div className="coluna-lateral">
            {noPalco
              .filter((id) => id !== emFoco)
              .map((id) => (
                <Transmissao key={id} id={id} volumeGeral={volume} principal={false} aoDestacar={() => aoDestacar(id)} />
              ))}
          </div>
        </div>
      ) : noPalco.length > 0 ? (
        <div className={`videos videos-${Math.min(noPalco.length, 7)}`}>
          {noPalco.map((id) => (
            <Transmissao
              key={id}
              id={id}
              volumeGeral={volume}
              principal={false}
              aoDestacar={noPalco.length > 1 ? () => aoDestacar(id) : undefined}
            />
          ))}
        </div>
      ) : (
        <Vazio sala={sala} sozinho={pessoas.length === 0} temAlguemNoAr={disponiveis.length > 0} />
      )}

      {disponiveis.length > 0 && (
        <div className="disponiveis">
          <span className="rotulo">No ar agora</span>
          {disponiveis.map((id) => (
            <button key={id} type="button" className="cartao-disponivel" onClick={() => cliente.assistir(id)}>
              <Avatar nome={cliente.nomeDe(id)} aoVivo tamanho={32} />
              <span className="cartao-disponivel-nome">{cliente.nomeDe(id)}</span>
              <span className="botao botao-primario botao-pequeno">
                <Eye size={14} /> Assistir
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Vazio({ sala, sozinho, temAlguemNoAr }: { sala: string; sozinho: boolean; temAlguemNoAr: boolean }) {
  if (temAlguemNoAr) {
    return (
      <div className="vazio">
        <Eye size={40} strokeWidth={1.5} />
        <h2>Escolha quem assistir</h2>
        <p>Clique em Assistir em quem está no ar. Dá para assistir várias transmissões ao mesmo tempo.</p>
      </div>
    );
  }
  return (
    <div className="vazio">
      <MonitorUp size={40} strokeWidth={1.5} />
      <h2>Ninguém está transmitindo</h2>
      <p>Clique em Transmitir, embaixo, para mostrar o seu jogo. Os amigos escolhem se querem assistir.</p>
      {sozinho && (
        <p className="vazio-link">
          <Link size={14} aria-hidden="true" /> Convide os amigos: <code>{linkDaSala(sala)}</code>
        </p>
      )}
    </div>
  );
}
