import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Maximize, Maximize2, PictureInPicture2, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import { cliente, type Metrica } from '../cliente';
import { useCliente, useNumeroLembrado, useVoz } from '../useCliente';
import { Avatar } from './Avatar';

// Silenciar vale enquanto a página estiver aberta, mesmo se a transmissão mudar de lugar no palco.
const silenciados = new Set<string>();

type Props = {
  id: string;
  volumeGeral: number;
  principal: boolean;
  aoDestacar?: () => void;
};

/**
 * Verde, amarelo ou vermelho, a partir do que quem assiste está recebendo de verdade.
 * Tela parada chega a ~10 fps (o piso da captura): fica amarelo, não vermelho, porque não travou nada.
 */
function saude(metrica: Metrica | undefined): { nivel: 'bom' | 'medio' | 'ruim'; texto: string } | null {
  if (!metrica || !metrica.altura) return null;
  const texto = `${metrica.altura}p · ${metrica.fps} fps`;
  if (metrica.congelouAgora || metrica.fps < 8) return { nivel: 'ruim', texto };
  if (metrica.fps < 24 || (metrica.idaEVolta ?? 0) > 150) return { nivel: 'medio', texto };
  return { nivel: 'bom', texto };
}

export function Transmissao({ id, volumeGeral, principal, aoDestacar }: Props) {
  const { videos, metricas } = useCliente();
  const { surdo, ajustes } = useVoz();
  const nome = cliente.nomeDe(id);
  const stream = videos[id];
  const video = useRef<HTMLVideoElement>(null);
  const bloco = useRef<HTMLElement>(null);
  // O volume de cada amigo fica guardado pelo nome: na próxima vez, ele já vem do jeito que você deixou.
  const [volume, setVolume] = useNumeroLembrado(`ozamigos-volume:${nome}`, 100);
  const [mudo, setMudoLocal] = useState(() => silenciados.has(id));
  const setMudo = (valor: boolean) => {
    if (valor) silenciados.add(id);
    else silenciados.delete(id);
    setMudoLocal(valor);
  };
  const estado = saude(metricas[`recebimento:${id}`]);

  useEffect(() => {
    if (video.current && video.current.srcObject !== stream) video.current.srcObject = stream ?? null;
  }, [stream]);

  useEffect(() => {
    if (!video.current) return;
    // O volume de saída e o som desligado da voz valem também para o som das transmissões, como no Discord.
    video.current.volume = Math.min(1, (volume / 100) * (volumeGeral / 100) * (ajustes.volumeSaida / 100));
    video.current.muted = mudo || surdo;
  }, [volume, volumeGeral, mudo, surdo, ajustes.volumeSaida]);

  // A saída de áudio escolhida na engrenagem.
  useEffect(() => {
    const elemento = video.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    elemento?.setSinkId?.(ajustes.saida).catch(() => undefined);
  }, [ajustes.saida, stream]);

  // Janela flutuante (picture-in-picture): fica por cima do jogo e das outras janelas.
  const [emJanela, setEmJanela] = useState(false);
  useEffect(() => {
    const elemento = video.current;
    if (!elemento) return;
    const entrou = () => setEmJanela(true);
    const saiu = () => setEmJanela(false);
    elemento.addEventListener('enterpictureinpicture', entrou);
    elemento.addEventListener('leavepictureinpicture', saiu);
    return () => {
      elemento.removeEventListener('enterpictureinpicture', entrou);
      elemento.removeEventListener('leavepictureinpicture', saiu);
    };
  }, []);

  async function alternarJanela() {
    try {
      if (document.pictureInPictureElement === video.current) await document.exitPictureInPicture();
      else await video.current?.requestPictureInPicture();
    } catch {
      cliente.avisar('Não foi possível abrir a janela flutuante.', 'erro');
    }
  }

  const IconeDeVolume = mudo || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;
  const telaCheia = () => void bloco.current?.requestFullscreen();

  return (
    <figure ref={bloco} className={principal ? 'transmissao transmissao-principal' : 'transmissao'} aria-label={`Transmissão de ${nome}`}>
      <video ref={video} autoPlay playsInline onDoubleClick={telaCheia} />

      {!stream && (
        <div className="carregando">
          <LoaderCircle size={28} className="girando" />
          <span>Conectando com {nome}…</span>
        </div>
      )}

      <figcaption className="transmissao-topo">
        <span className="transmissao-nome">
          <Avatar nome={nome} tamanho={24} />
          <span className="transmissao-nome-texto">{nome}</span>
          <span className="selo-ao-vivo">Ao vivo</span>
        </span>
        {estado && (
          <span className={`saude saude-${estado.nivel}`} title="Resolução e fps que estão chegando até você">
            <span className="ponto" aria-hidden="true" />
            <span className="saude-texto">
              {estado.texto}
              {estado.nivel === 'ruim' && ' · instável'}
            </span>
          </span>
        )}
      </figcaption>

      <div className="transmissao-controles">
        <button type="button" className="botao-icone" aria-label={mudo ? `Ativar o som de ${nome}` : `Silenciar ${nome}`} onClick={() => setMudo(!mudo)}>
          <IconeDeVolume size={18} />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={mudo ? 0 : volume}
          onChange={(e) => {
            setMudo(false);
            setVolume(Number(e.target.value));
          }}
          aria-label={`Volume de ${nome}`}
          style={{ '--preenchido': `${mudo ? 0 : volume}%` } as React.CSSProperties}
        />
        <span className="volume-numero">{mudo ? 0 : volume}%</span>
        <span className="espaco" />
        {aoDestacar && !principal && (
          <button type="button" className="botao-icone" aria-label={`Destacar ${nome}`} title="Destacar" onClick={aoDestacar}>
            <Maximize2 size={18} />
          </button>
        )}
        {document.pictureInPictureEnabled && (
          <button
            type="button"
            className={emJanela ? 'botao-icone ativo' : 'botao-icone'}
            aria-label={emJanela ? `Voltar ${nome} para a sala` : `Janela flutuante: ${nome}`}
            aria-pressed={emJanela}
            title={emJanela ? 'Voltar para a sala' : 'Janela flutuante (fica por cima do jogo)'}
            disabled={!stream}
            onClick={() => void alternarJanela()}
          >
            <PictureInPicture2 size={18} />
          </button>
        )}
        <button type="button" className="botao-icone" aria-label={`Tela cheia: ${nome}`} title="Tela cheia (ou dois cliques no vídeo)" onClick={telaCheia}>
          <Maximize size={18} />
        </button>
        <button type="button" className="botao-icone" aria-label={`Parar de assistir ${nome}`} title="Parar de assistir" onClick={() => cliente.deixarDeAssistir(id)}>
          <X size={18} />
        </button>
      </div>
    </figure>
  );
}
