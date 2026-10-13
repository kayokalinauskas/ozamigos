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
  /** Cor dos botões da janela, para combinar com o que está embaixo deles (app 1.2.9 em diante). */
  corDaBarra?(cor: string): void;
  /** Teste de desempenho (app 1.2.10 em diante): o que o navegador não mede. */
  desempenho?: {
    pc(): Promise<InfoDoPc | null>;
    /** Liga ou desliga os contadores do Windows (processador do PC e motores da placa de vídeo). */
    ligar(ligado: boolean): Promise<boolean>;
    amostra(): Promise<AmostraDoPc | null>;
  };
};

export type InfoDoPc = {
  sistema: string;
  processador: string;
  nucleos: number;
  memoriaGB: number;
  placa: { nome: string | null; driver: string | null; fabricante: number | null } | null;
  telas: { tamanho: string; escala: number; hz: number; principal: boolean }[];
  electron: string;
  chrome: string;
  contadoresDoWindows: boolean;
};

/** Uso em %. Motores da placa pelo nome do Windows: "3D", "VideoEncode", "Video Codec Engine" (AMD), "Copy"… */
export type AmostraDoPc = {
  processos: Record<string, { cpu: number; memoriaMB: number }>; // por tipo de processo do app (Browser, GPU, Tab…)
  cpuDoPc: number | null;
  placa: {
    total: Record<string, number>;
    doApp: Record<string, number>;
    outros: Record<string, number>;
    memoriaMB: number | null;
  } | null;
};

/** Pinta os botões da janela do app com a cor de uma variável do CSS (ex.: '--painel'). */
export function pintarBarraDaJanela(variavel: string) {
  const cor = getComputedStyle(document.documentElement).getPropertyValue(variavel).trim();
  if (cor) ponte?.corDaBarra?.(cor);
}

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
