// A "ponte" que o app para Windows (Electron) põe na página. No navegador ela não existe,
// e a interface usa o seletor de tela do próprio navegador.

export type FonteDeCaptura = {
  id: string;
  nome: string;
  tipo: 'janela' | 'tela';
  miniatura: string; // data URL da prévia
  icone: string | null; // data URL do ícone do aplicativo (só janelas)
};

export type EscolhaDeFonte = { id: string; audio: boolean };

export type PonteOzamigos = {
  versao: string;
  /** Chamado quando a página pede getDisplayMedia: a interface mostra o seletor e responde. */
  aoPedirFonte(ouvinte: (fontes: FonteDeCaptura[]) => void): void;
  responderFonte(escolha: EscolhaDeFonte | null): void;
  /** Volta para a tela de escolher o servidor. */
  trocarServidor(): void;
};

declare global {
  interface Window {
    ozamigos?: PonteOzamigos;
  }
}

export const ponte: PonteOzamigos | undefined = window.ozamigos;
export const noApp = ponte !== undefined;
