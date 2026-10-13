import { useCliente } from '../useCliente';
import { Avisos } from './Avisos';
import { Entrada } from './Entrada';
import { Sala } from './Sala';
import { SeletorDeFonte } from './SeletorDeFonte';

export function App() {
  const { fase } = useCliente();
  return (
    <>
      {fase === 'sala' ? <Sala /> : <Entrada />}
      <Avisos />
      <SeletorDeFonte />
    </>
  );
}
