import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import './estilo.css';
import { App } from './componentes/App';
import { acompanharGravacaoDaSala } from './desempenho/coletor';
import { manterTelaAcordada } from './telaAcordada';

// Quando alguém grava as estatísticas da sala (Ctrl+Shift+G), este PC manda as próprias medidas para essa pessoa.
acompanharGravacaoDaSala();
// Com mais alguém na sala, a tela não apaga (como numa chamada do Discord).
manterTelaAcordada();

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
