import { useState } from 'react';
import { lembrado, lembrar } from '../armazenamento';
import { veioPorConvite } from '../cliente';
import { noApp } from '../ponte';
import { useCliente } from '../useCliente';
import { Apresentacao } from './Apresentacao';
import { Avisos } from './Avisos';
import { Entrada } from './Entrada';
import { Sala } from './Sala';
import { SeletorDeFonte } from './SeletorDeFonte';

const CHAVE_NAVEGADOR = 'ozamigos-no-navegador';

export function App() {
  const { fase } = useCliente();
  // No navegador, a primeira visita mostra a apresentação, que recomenda o app para Windows. O app,
  // quem chega por um link de sala e quem já escolheu usar no navegador vão direto para a entrada.
  const [apresentar, setApresentar] = useState(() => !noApp && !veioPorConvite && lembrado(CHAVE_NAVEGADOR) !== 'sim');

  if (apresentar) {
    return (
      <Apresentacao
        aoUsarNoNavegador={() => {
          lembrar(CHAVE_NAVEGADOR, 'sim');
          setApresentar(false);
          scrollTo(0, 0);
        }}
      />
    );
  }

  return (
    <>
      {fase === 'sala' ? (
        <Sala />
      ) : (
        <Entrada
          aoConhecerOApp={() => {
            lembrar(CHAVE_NAVEGADOR, '');
            setApresentar(true);
          }}
        />
      )}
      <Avisos />
      <SeletorDeFonte />
    </>
  );
}
