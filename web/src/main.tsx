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
import { carregarConta, lerErroDoEndereco } from './conta';
import { ponte } from './ponte';
import { atalhos } from './voz/atalhos';
import { voz } from './voz/voz';

// A conta (login pelo Google ou pelo Discord): o erro que voltou do login, e quem é a pessoa.
lerErroDoEndereco();
void carregarConta();
// Quando alguém grava as estatísticas da sala (Ctrl+Shift+G), este PC manda as próprias medidas para essa pessoa.
acompanharGravacaoDaSala();
// Com mais alguém na sala, a tela não apaga (como numa chamada do Discord).
manterTelaAcordada();
// No app: mensagens do chat não vistas viram um ponto (e uma piscada) no ícone da barra de tarefas.
avisarNaBarraDeTarefas();
// No app: um link de sala (ozamigos://sala/...) aberto com o app aberto. As salas por código saíram (28/10/2026):
// em vez de não acontecer nada, a pessoa fica sabendo o que pedir.
ponte?.aoAbrirSala?.(() =>
  cliente.avisar('Os links de sala não valem mais: peça a quem te chamou um convite para o servidor do grupo.', 'erro'),
);
// Os atalhos de voz (mudo, som desligado e apertar para falar); no app, valem com o jogo na frente. Só numa sala:
// na entrada, um Ctrl+Shift+M não muda nada sem a pessoa ver.
atalhos.ligar((qual, apertado) => {
  if (qual === 'falar') voz.falar(apertado);
  else if (cliente.ler().fase === 'sala') {
    if (qual === 'mudo') voz.alternarMudo();
    else voz.alternarSurdo();
  }
});
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
