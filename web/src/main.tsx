import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import './estilo.css';
import { App } from './componentes/App';
import { acompanharGravacaoDaSala } from './desempenho/coletor';
import { manterTelaAcordada } from './telaAcordada';
import { avisarNaBarraDeTarefas } from './avisoNaBarra';
import { cliente } from './cliente';
import { ponte } from './ponte';

// Quando alguém grava as estatísticas da sala (Ctrl+Shift+G), este PC manda as próprias medidas para essa pessoa.
acompanharGravacaoDaSala();
// Com mais alguém na sala, a tela não apaga (como numa chamada do Discord).
manterTelaAcordada();
// No app: mensagens do chat não vistas viram um ponto (e uma piscada) no ícone da barra de tarefas.
avisarNaBarraDeTarefas();
// No app: um convite (link ozamigos://) aberto com o app já aberto.
ponte?.aoAbrirSala?.((sala) => cliente.abrirConvite(sala));
// Um arquivo solto fora da sala (na entrada, por exemplo) não abre no lugar da página. Na sala, ele vai para o chat.
for (const evento of ['dragover', 'drop'] as const) {
  document.addEventListener(evento, (e) => {
    if (e.defaultPrevented || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
  });
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
