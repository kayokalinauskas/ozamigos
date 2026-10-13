import { Suspense, lazy, useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { lembrado, lembrar } from '../armazenamento';
import { cliente } from '../cliente';
import { pintarBarraDaJanela } from '../ponte';
import { useCliente } from '../useCliente';
import { BarraLateral } from './BarraLateral';
import { Controles } from './Controles';
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
  const { conexaoPerdida } = useCliente();
  const [modo, setModo] = useState<Modo>(() => (lembrado('ozamigos-modo') === 'destaque' ? 'destaque' : 'grade'));
  const [foco, setFoco] = useState<string | null>(null);
  const [estatisticasAbertas, setEstatisticasAbertas] = useState(false);
  const [testeAberto, setTesteAberto] = useState(false);

  // Ferramentas de diagnóstico, sem botão na tela: Ctrl+Shift+D abre o teste de desempenho, e Ctrl+Shift+G
  // começa (ou para) a gravação das estatísticas da sala. O código das duas só é baixado no primeiro uso.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const letra = e.key.toLowerCase();
      if (letra === 'd') {
        e.preventDefault();
        setTesteAberto(true);
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

  // No app, os botões da janela ficam no canto de cima à direita: sobre o painel de estatísticas, quando aberto.
  useEffect(() => {
    pintarBarraDaJanela(estatisticasAbertas && !testeAberto ? '--painel' : '--fundo');
    return () => pintarBarraDaJanela('--fundo');
  }, [estatisticasAbertas, testeAberto]);

  function mudarModo(novo: Modo) {
    lembrar('ozamigos-modo', novo);
    setModo(novo);
  }

  /** Clicar em "Destacar" numa transmissão: ela vai para o centro, grande, e as outras para o lado. */
  function destacar(id: string) {
    setFoco(id);
    mudarModo('destaque');
  }

  return (
    <div className="sala">
      <BarraLateral />
      <main className="principal">
        {conexaoPerdida && (
          <div className="faixa-alerta" role="alert">
            <WifiOff size={18} />
            <span>A conexão com o servidor caiu. Reconectando sozinho… As transmissões abertas continuam enquanto isso.</span>
            <button type="button" className="botao botao-primario botao-pequeno" onClick={() => cliente.reconectar()}>
              <RefreshCw size={14} /> Tentar agora
            </button>
          </div>
        )}
        <div className="palco-e-painel">
          <Palco modo={modo} aoMudarModo={mudarModo} foco={foco} aoDestacar={destacar} />
          {estatisticasAbertas && <PainelEstatisticas aoFechar={() => setEstatisticasAbertas(false)} />}
        </div>
        <Controles
          estatisticasAbertas={estatisticasAbertas}
          aoAlternarEstatisticas={() => setEstatisticasAbertas(!estatisticasAbertas)}
        />
      </main>
      {testeAberto && (
        <Suspense fallback={null}>
          <TesteDesempenho aoFechar={() => setTesteAberto(false)} />
        </Suspense>
      )}
    </div>
  );
}
