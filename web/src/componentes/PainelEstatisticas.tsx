import { X } from 'lucide-react';
import { cliente, type Metrica } from '../cliente';
import { useCliente } from '../useCliente';

const LIMITES: Record<string, { texto: string; dica?: string }> = {
  none: { texto: 'nenhum' },
  cpu: { texto: 'processador / placa de vídeo', dica: 'Limite o fps do jogo (60 é o ideal) ou baixe a qualidade.' },
  bandwidth: { texto: 'internet', dica: 'Normal nos primeiros 20 segundos. Se continuar, baixe a qualidade ou use cabo.' },
  other: { texto: 'outro' },
};

const REDES: Record<string, string> = { host: 'mesma rede', srflx: 'pela internet', prflx: 'pela internet', relay: 'por servidor TURN' };

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </>
  );
}

function Cartao({ m }: { m: Metrica }) {
  const enviando = m.canal === 'envio';
  const limite = m.limite ? LIMITES[m.limite] : null;
  return (
    <article className="cartao-metrica">
      <h3>
        {enviando ? 'Enviando para' : 'Recebendo de'} {cliente.nomeDe(m.id)}
      </h3>
      <dl>
        <Linha rotulo="Imagem" valor={m.largura ? `${m.largura}×${m.altura} · ${m.fps} fps` : 'aguardando…'} />
        <Linha rotulo="Taxa" valor={`${m.mbps.toFixed(1)} Mbps · ${m.codec}`} />
        {enviando && <Linha rotulo="Captura" valor={m.captura != null ? `${Math.round(m.captura)} fps` : '?'} />}
        {enviando && <Linha rotulo="Codificador" valor={m.codificador ?? '?'} />}
        {enviando && <Linha rotulo="Limite" valor={limite?.texto ?? '? (o Firefox não informa)'} />}
        {enviando && m.banda != null && <Linha rotulo="Banda estimada" valor={`${m.banda.toFixed(1)} Mbps`} />}
        {!enviando && <Linha rotulo="Congelamentos" valor={`${m.congelamentos} · quadros perdidos: ${m.perdidos}`} />}
        <Linha rotulo="Rede" valor={`${REDES[m.rede ?? ''] ?? '?'}${m.idaEVolta != null ? ` · ${m.idaEVolta} ms` : ''}`} />
      </dl>
      {limite?.dica && <p className="dica">{limite.dica}</p>}
    </article>
  );
}

export function PainelEstatisticas({ aoFechar }: { aoFechar: () => void }) {
  const { metricas, minhaTela } = useCliente();
  const lista = Object.values(metricas).sort((a, b) => a.canal.localeCompare(b.canal));
  return (
    <aside className="painel-estatisticas" aria-label="Estatísticas">
      <header>
        <h2>Estatísticas</h2>
        <button type="button" className="botao-icone" aria-label="Fechar estatísticas" onClick={aoFechar}>
          <X size={18} />
        </button>
      </header>
      {lista.map((m) => (
        <Cartao key={`${m.canal}:${m.id}`} m={m} />
      ))}
      {lista.length === 0 && (
        <p className="ajuda">
          {minhaTela
            ? 'Ninguém está assistindo você agora. Os números aparecem quando alguém clicar em Assistir.'
            : 'Os números aparecem quando você assiste ou transmite.'}
        </p>
      )}
      <p className="ajuda">
        Nos primeiros 15 a 25 segundos, a resolução sobe aos poucos: é o WebRTC medindo a internet. Se a captura estiver baixa, o problema
        é o jogo usando a placa de vídeo inteira, não a rede.
      </p>
    </aside>
  );
}
