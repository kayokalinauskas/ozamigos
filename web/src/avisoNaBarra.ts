// No app para Windows, as mensagens do chat que a pessoa ainda não viu aparecem fora da janela: um ponto no ícone da
// barra de tarefas (que pisca quando chega uma com a janela atrás do jogo) e o número na dica da bandeja.
// Só a partir do app 1.2.13 (ponte.naoLidas); no navegador e nos apps antigos, não faz nada.

import { cliente } from './cliente';
import { ponte } from './ponte';

export function avisarNaBarraDeTarefas() {
  if (!ponte?.naoLidas) return;
  let anterior = 0;
  cliente.inscrever(() => {
    const { chatNaoLidas } = cliente.ler();
    if (chatNaoLidas === anterior) return;
    anterior = chatNaoLidas;
    ponte!.naoLidas!(chatNaoLidas);
  });
}
