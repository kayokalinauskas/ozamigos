import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import './estilo.css';
import { App } from './componentes/App';
import { acompanharGravacaoDaSala } from './desempenho/coletor';
import { manterTelaAcordada } from './telaAcordada';
import { avisarNaBarraDeTarefas } from './avisoNaBarra';

// Quando alguém grava as estatísticas da sala (Ctrl+Shift+G), este PC manda as próprias medidas para essa pessoa.
acompanharGravacaoDaSala();
// Com mais alguém na sala, a tela não apaga (como numa chamada do Discord).
manterTelaAcordada();
// No app: mensagens do chat não vistas viram um ponto (e uma piscada) no ícone da barra de tarefas.
avisarNaBarraDeTarefas();

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
