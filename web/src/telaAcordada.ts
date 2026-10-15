// Não deixar o PC ou o celular apagar a tela no meio da sala (como o Discord numa chamada). Sem isso, quem assiste uma
// transmissão sem som, ou só conversa por voz, via a tela apagar e o Windows (ou o celular) dormir no meio da sessão.
// Vale com mais alguém na sala: sozinho, não há conversa nem transmissão, e a tela dorme normalmente.
// O navegador solta a trava sozinho quando a página fica escondida; ela é pedida de novo quando a página volta.

import { cliente } from './cliente';

type Trava = { released: boolean; release(): Promise<void>; addEventListener(tipo: 'release', ouvinte: () => void): void };
type ComTrava = Navigator & { wakeLock?: { request(tipo: 'screen'): Promise<Trava> } };

let trava: Trava | null = null;
let pedindo = false;

function precisa(): boolean {
  const { fase, pessoas } = cliente.ler();
  return fase === 'sala' && pessoas.length > 0 && document.visibilityState === 'visible';
}

async function ajustar() {
  const wakeLock = (navigator as ComTrava).wakeLock;
  if (!wakeLock) return; // navegador sem a API: segue sem
  if (precisa()) {
    if ((trava && !trava.released) || pedindo) return;
    pedindo = true;
    try {
      trava = await wakeLock.request('screen');
      trava.addEventListener('release', () => {
        trava = null;
      });
      // Pode ter saído da sala enquanto o pedido estava a caminho.
      if (!precisa()) await soltar();
    } catch {
      trava = null; // recusado (bateria fraca, permissão): a tela segue as regras do sistema
    } finally {
      pedindo = false;
    }
  } else {
    await soltar();
  }
}

async function soltar() {
  const atual = trava;
  trava = null;
  await atual?.release().catch(() => undefined);
}

/** Liga o acompanhamento: a trava segue a sala (entrar, sair, alguém chegar ou ir embora) e a página voltar a aparecer. */
export function manterTelaAcordada() {
  cliente.inscrever(() => void ajustar());
  document.addEventListener('visibilitychange', () => void ajustar());
}
