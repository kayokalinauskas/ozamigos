import { Suspense, lazy, useEffect, useRef, useState, type DragEvent } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { lembrado, lembrar } from '../armazenamento';
import { cliente } from '../cliente';
import { alternarCaptura, capturaDoAppExiste } from '../videoDoApp';
import { pintarBarraDaJanela } from '../ponte';
import { useCliente } from '../useCliente';
import { BarraLateral } from './BarraLateral';
import { Controles } from './Controles';
import { PainelChat, adicionarImagens } from './PainelChat';
import { PainelEstatisticas } from './PainelEstatisticas';
import { Palco, type Modo } from './Palco';

// O teste de desempenho é grande e pouca gente abre: só é baixado na primeira vez que alguém abrir.
// Se saiu uma versão nova com a página aberta, o arquivo antigo não existe mais: avisa em vez de quebrar a sala.
const TesteDesempenho = lazy<(props: { aoFechar: () => void }) => React.ReactNode>(() =>
  import('./TesteDesempenho').then(
    (m) => ({ default: m.TesteDesempenho }),
    () => ({ default: SemOTeste }),
  ),
);

function SemOTeste({ aoFechar }: { aoFechar: () => void }) {
  useEffect(() => {
    cliente.avisar('Não foi possível abrir o teste: saiu uma versão nova do Ozamigos. Recarregue a página (Ctrl+R) e tente de novo.', 'erro');
    aoFechar();
  }, [aoFechar]);
  return null;
}

export function Sala() {
  const { conexaoPerdida, chatAberto } = useCliente();
  const [modo, setModo] = useState<Modo>(() => (lembrado('ozamigos-modo') === 'destaque' ? 'destaque' : 'grade'));
  const [foco, setFoco] = useState<string | null>(null);
  const [estatisticasAbertas, setEstatisticasAbertas] = useState(false);
  const [testeAberto, setTesteAberto] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const entradas = useRef(0); // dragenter e dragleave disparam em cada filho: conta para saber quando saiu da sala

  // Ferramentas de diagnóstico, sem botão na tela: Ctrl+Shift+X abre o teste de desempenho, e Ctrl+Shift+G
  // começa (ou para) a gravação das estatísticas da sala. O código das duas só é baixado no primeiro uso.
  // Ctrl+Shift+N (no app) troca entre a captura do app e a antiga, do navegador, para comparar as duas com os amigos.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const letra = e.key.toLowerCase();
      if (letra === 'x') { // era o D, que virou o atalho de desligar o som (como no Discord)
        e.preventDefault();
        setTesteAberto(true);
      } else if (letra === 'n' && !e.repeat && capturaDoAppExiste()) {
        e.preventDefault();
        const captura = alternarCaptura() === 'app' ? 'Captura do app ligada' : 'Captura antiga (do navegador) ligada';
        const quando = cliente.ler().minhaTela ? 'Vale quando você escolher de novo o que transmitir.' : 'Vale para a próxima transmissão.';
        cliente.avisar(`${captura}. ${quando}`);
      } else if (letra === 'g' && !e.repeat) {
        e.preventDefault();
        import('../desempenho/gravadorDaSala').then(
          (m) => m.gravadorDaSala.alternar(),
          () => cliente.avisar('Não foi possível gravar a sala: saiu uma versão nova do Ozamigos. Recarregue a página (Ctrl+R) e tente de novo.', 'erro'),
        );
      }
    };
    addEventListener('keydown', tecla);
    return () => removeEventListener('keydown', tecla);
  }, []);

  // Um painel à direita por vez: abrir o chat fecha as estatísticas, e o contrário.
  useEffect(() => {
    if (chatAberto) setEstatisticasAbertas(false);
  }, [chatAberto]);

  function alternarEstatisticas() {
    if (!estatisticasAbertas) cliente.abrirChat(false);
    setEstatisticasAbertas(!estatisticasAbertas);
  }

  // No app, os botões da janela ficam no canto de cima à direita: sobre o painel da direita, quando aberto.
  const painelAberto = estatisticasAbertas || chatAberto;
  useEffect(() => {
    pintarBarraDaJanela(painelAberto && !testeAberto ? '--painel' : '--fundo');
    return () => pintarBarraDaJanela('--fundo');
  }, [painelAberto, testeAberto]);

  function mudarModo(novo: Modo) {
    lembrar('ozamigos-modo', novo);
    setModo(novo);
  }

  /** Clicar em "Destacar" numa transmissão: ela vai para o centro, grande, e as outras para o lado. */
  function destacar(id: string) {
    setFoco(id);
    mudarModo('destaque');
  }

  // Arrastar uma imagem para qualquer lugar da sala: o chat abre com ela na bandeja.
  const temArquivos = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const arrastar = {
    onDragEnter(e: DragEvent) {
      if (!temArquivos(e)) return;
      entradas.current++;
      setArrastando(true);
    },
    onDragLeave(e: DragEvent) {
      if (temArquivos(e) && --entradas.current <= 0) setArrastando(false);
    },
    onDragOver(e: DragEvent) {
      if (!temArquivos(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDrop(e: DragEvent) {
      if (!temArquivos(e)) return;
      e.preventDefault();
      entradas.current = 0;
      setArrastando(false);
      cliente.abrirChat(true);
      adicionarImagens(e.dataTransfer.files);
    },
  };

  return (
    <div className="sala" {...arrastar}>
      <BarraLateral />
      <main className="principal">
        {conexaoPerdida && (
          <div className="faixa-alerta" role="alert">
            <WifiOff size={18} />
            <span>A conexão caiu. Reconectando…</span>
            <button type="button" className="botao botao-primario botao-pequeno" onClick={() => cliente.reconectar()}>
              <RefreshCw size={14} /> Tentar agora
            </button>
          </div>
        )}
        <div className="palco-e-painel">
          <Palco modo={modo} aoMudarModo={mudarModo} foco={foco} aoDestacar={destacar} />
          {estatisticasAbertas && <PainelEstatisticas aoFechar={() => setEstatisticasAbertas(false)} />}
          {chatAberto && <PainelChat />}
        </div>
        <Controles estatisticasAbertas={estatisticasAbertas} aoAlternarEstatisticas={alternarEstatisticas} />
      </main>
      {arrastando && (
        <div className="soltar-imagem" aria-hidden="true">
          <span>Solte para mandar no chat</span>
        </div>
      )}
      {testeAberto && (
        <Suspense fallback={null}>
          <TesteDesempenho aoFechar={() => setTesteAberto(false)} />
        </Suspense>
      )}
    </div>
  );
}
