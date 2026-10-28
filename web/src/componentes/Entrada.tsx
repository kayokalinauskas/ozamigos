import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { conviteDoCaminho } from '../conexao/codigoDaSala';
import { useConta } from '../conta';
import { useCliente } from '../useCliente';
import { ContaNaEntrada } from './Conta';
import { Logo } from './Logo';
import { RodapeDaEntrada } from './RodapeDaEntrada';
import { AceitarConvite, EntrarNoServidor, MeusServidores } from './Servidores';

/**
 * A entrada, como no Discord (decisão do dono, 28/10/2026): sem conta, o login; com conta, os servidores dela e criar
 * um. Um servidor (/s/<codigo>) e um convite (/c/<codigo>) têm a página deles. O app abre aqui, sem entrar sozinho em
 * sala nenhuma.
 */
export function Entrada() {
  const { servidor } = useCliente();
  // Aceito, o convite vira o servidor (cliente.entrarNoServidor), e o endereço muda.
  const [convite] = useState(() => conviteDoCaminho(location.pathname));

  return (
    <main className="entrada">
      {servidor ? <EntrarNoServidor codigo={servidor} key={servidor} /> : convite ? <AceitarConvite convite={convite} /> : <Inicio />}
    </main>
  );
}

function Inicio() {
  const { carregada, conta } = useConta();
  return (
    <div className="cartao-entrada">
      <Logo grande />
      <p className="subtitulo">Transmita seu jogo e converse com os amigos.</p>
      {carregada ? (
        <ContaNaEntrada />
      ) : (
        <p className="ajuda">
          <LoaderCircle size={14} className="girando" /> Carregando…
        </p>
      )}
      {conta && <MeusServidores />}
      <RodapeDaEntrada />
    </div>
  );
}
