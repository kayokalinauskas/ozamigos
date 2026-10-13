import { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { lembrado, lembrar } from '../armazenamento';
import { cliente } from '../cliente';
import { pintarBarraDaJanela } from '../ponte';
import { useCliente } from '../useCliente';
import { BarraLateral } from './BarraLateral';
import { Controles } from './Controles';
import { PainelEstatisticas } from './PainelEstatisticas';
import { Palco, type Modo } from './Palco';

export function Sala() {
  const { conexaoPerdida } = useCliente();
  const [modo, setModo] = useState<Modo>(() => (lembrado('ozamigos-modo') === 'destaque' ? 'destaque' : 'grade'));
  const [foco, setFoco] = useState<string | null>(null);
  const [estatisticasAbertas, setEstatisticasAbertas] = useState(false);

  // No app, os botões da janela ficam no canto de cima à direita: sobre o painel de estatísticas, quando aberto.
  useEffect(() => {
    pintarBarraDaJanela(estatisticasAbertas ? '--painel' : '--fundo');
    return () => pintarBarraDaJanela('--fundo');
  }, [estatisticasAbertas]);

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
    </div>
  );
}
