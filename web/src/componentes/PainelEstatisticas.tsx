import { Download, X } from 'lucide-react';
import { cliente } from '../cliente';
import type { Metrica } from '../conexao/medidor';
import { QUALIDADES, capturaAbaixo, type Qualidade } from '../qualidade';
import { useCliente } from '../useCliente';

const LIMITES: Record<string, { texto: string; dica?: string }> = {
  none: { texto: 'nenhum' },
  cpu: { texto: 'processador / placa de vídeo', dica: 'Limite o fps do jogo (60 é o ideal). Enquanto isso, a imagem perde um pouco de fps em vez de travar.' },
  bandwidth: { texto: 'internet', dica: 'Normal nos primeiros 20 segundos. Se continuar, use cabo ou tenha menos gente assistindo; enquanto isso, a imagem perde um pouco de nitidez em vez de travar.' },
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

function Cartao({ m, qualidade }: { m: Metrica; qualidade: Qualidade }) {
  const enviando = m.canal === 'envio';
  const limite = m.limite ? LIMITES[m.limite] : null;
  const capturaBaixa = enviando ? capturaAbaixo([m.captura], qualidade) : null;
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
      {capturaBaixa !== null && (
        <p className="dica">
          Seu PC está copiando só {capturaBaixa} fps da imagem (a qualidade pede {QUALIDADES[qualidade].fps}), e é isso que os amigos veem. Não é a
          internet: alguns jogos são mais lentos de capturar, mesmo com a placa de vídeo folgada.
        </p>
      )}
      {limite?.dica && <p className="dica">{limite.dica}</p>}
    </article>
  );
}

/** Baixa o relatório da sessão (medidas de cada segundo e acontecimentos) num arquivo JSON. */
function salvarRelatorio() {
  const relatorio = cliente.relatorio();
  const quando = relatorio.geradoEm.slice(0, 16).replace(/[T:]/g, '-');
  const arquivo = new Blob([JSON.stringify(relatorio, null, 1)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(arquivo);
  link.download = `ozamigos-relatorio-${relatorio.eu}-${quando}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

export function PainelEstatisticas({ aoFechar }: { aoFechar: () => void }) {
  const { metricas, minhaTela, qualidade } = useCliente();
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
        <Cartao key={`${m.canal}:${m.id}`} m={m} qualidade={qualidade} />
      ))}
      {lista.length === 0 && (
        <p className="ajuda">
          {minhaTela
            ? 'Ninguém está assistindo você agora. Os números aparecem quando alguém clicar em Assistir.'
            : 'Os números aparecem quando você assiste ou transmite.'}
        </p>
      )}
      <button type="button" className="botao botao-secundario botao-pequeno salvar-relatorio" onClick={salvarRelatorio}>
        <Download size={14} /> Salvar relatório
      </button>
      <p className="ajuda">
        O relatório traz as medidas de cada segundo e o que aconteceu na sessão (quem entrou, quedas, trocas de qualidade). Serve para
        entender depois um travamento.
      </p>
      <p className="ajuda">
        Nos primeiros 15 a 25 segundos, a imagem ganha nitidez aos poucos: é o WebRTC medindo a internet. Se a captura estiver abaixo do fps da
        qualidade, o limite está em copiar a imagem do jogo no PC de quem transmite, não na rede.
      </p>
    </aside>
  );
}
