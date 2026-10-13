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
  /** somDoApp: o som do PC vem do auxiliar do app (sem o Discord e sem o Ozamigos), não do navegador. */
  responderFonte(escolha: EscolhaDeFonte | null): Promise<{ somDoApp: boolean }>;
  /** Pedaços do som do PC: float32 estéreo intercalado, 48 kHz. */
  aoReceberSom(ouvinte: (dados: Uint8Array) => void): void;
  pararSom(): void;
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

// A resposta do último seletor: o cliente consulta depois que getDisplayMedia termina,
// para saber se precisa juntar a faixa de som do app ao vídeo.
let ultimaEscolha: Promise<{ somDoApp: boolean }> = Promise.resolve({ somDoApp: false });

export function responderFonte(escolha: EscolhaDeFonte | null) {
  ultimaEscolha = ponte?.responderFonte(escolha) ?? Promise.resolve({ somDoApp: false });
}

export function resultadoDaUltimaEscolha() {
  return ultimaEscolha;
}

// O app leva uns 0,4 s para listar janelas e telas. O seletor abre já no clique, com espaços
// reservados, e as miniaturas entram quando chegam: o botão nunca parece não ter respondido.
const ouvintesDoCarregamento = new Set<(carregando: boolean) => void>();

export function seletorCarregando(carregando: boolean) {
  ouvintesDoCarregamento.forEach((ouvinte) => ouvinte(carregando));
}

export function aoCarregarSeletor(ouvinte: (carregando: boolean) => void) {
  ouvintesDoCarregamento.add(ouvinte);
  return () => {
    ouvintesDoCarregamento.delete(ouvinte);
  };
}
