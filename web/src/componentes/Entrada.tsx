import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { lembrado } from '../armazenamento';
import { conviteDoCaminho } from '../conexao/codigoDaSala';
import { useConta, voltouDoLogin } from '../conta';
import { ponte } from '../ponte';
import { useCliente } from '../useCliente';
import { ContaNaEntrada } from './Conta';
import { AbrirNoApp, FICA_NO_NAVEGADOR } from './AbrirNoApp';
import { Logo } from './Logo';
import { RodapeDaEntrada } from './RodapeDaEntrada';
import { AceitarConvite, EntrarNoServidor, MeusServidores } from './Servidores';

/** No navegador do Windows, quem tem o app pode abrir o convite nele. */
const NO_WINDOWS = /Windows/.test(navigator.userAgent);

/**
 * A entrada, como no Discord (decisão do dono, 28/10/2026): sem conta, o login; com conta, os servidores dela e criar
 * um. Um servidor (/s/<codigo>) e um convite (/c/<codigo>) têm a página deles. O app abre aqui, sem entrar sozinho em
 * sala nenhuma.
 */
export function Entrada() {
  const { servidor } = useCliente();
  // Aceito, o convite vira o servidor (cliente.entrarNoServidor), e o endereço muda.
  const [convite] = useState(() => conviteDoCaminho(location.pathname));
  // No navegador do Windows, o convite pergunta antes se a pessoa quer abrir no app (AbrirNoApp), como no Discord. Não
  // na volta do login (a pessoa já escolheu o navegador) nem para quem já escolheu ficar nele.
  const [perguntarDoApp, setPerguntarDoApp] = useState(
    () => convite !== null && !ponte && NO_WINDOWS && !lembrado(FICA_NO_NAVEGADOR) && !voltouDoLogin(),
  );

  if (convite && perguntarDoApp && !servidor) {
    return (
      <main className="entrada">
        <div className="cartao-entrada">
          <Logo grande />
          <AbrirNoApp convite={convite} aoContinuar={() => setPerguntarDoApp(false)} />
          <RodapeDaEntrada />
        </div>
      </main>
    );
  }

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
