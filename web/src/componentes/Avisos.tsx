import { CircleAlert, Info, X } from 'lucide-react';
import { cliente } from '../cliente';
import { useCliente } from '../useCliente';

/** Os avisos rápidos do canto da tela ("Ana entrou", "Bia começou a transmitir"). */
export function Avisos() {
  const { avisos } = useCliente();
  return (
    <div className="avisos" role="status" aria-live="polite">
      {avisos.map((aviso) => {
        const Icone = aviso.tipo === 'erro' ? CircleAlert : Info;
        return (
          <div key={aviso.id} className={`aviso aviso-${aviso.tipo}`}>
            <Icone size={18} className="aviso-icone" aria-hidden="true" />
            <span className="aviso-texto">{aviso.texto}</span>
            {aviso.acao && (
              <button
                type="button"
                className="botao botao-primario botao-pequeno"
                onClick={() => {
                  aviso.acao!.executar();
                  cliente.dispensar(aviso.id);
                }}
              >
                {aviso.acao.rotulo}
              </button>
            )}
            <button type="button" className="botao-icone aviso-fechar" aria-label="Fechar aviso" onClick={() => cliente.dispensar(aviso.id)}>
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
