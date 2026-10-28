// A "ponte" que o app para Windows (Electron) põe na página. No navegador ela não existe,
// e a interface usa o seletor de tela do próprio navegador.

export type FonteDeCaptura = {
  id: string;
  nome: string;
  tipo: 'janela' | 'tela';
  miniatura: string; // data URL da prévia
  icone: string | null; // data URL do ícone do aplicativo (só janelas)
};

/** captura: o tamanho e o fps pedidos à captura de vídeo do app (1.2.18 em diante); sem ela, vai a do Chromium. */
export type EscolhaDeFonte = { id: string; audio: boolean; captura?: TamanhoDaCaptura | null };

/** canal: a página recebe os quadros pelo canal direto (um MessagePort num worker), app 1.2.19 em diante. */
export type TamanhoDaCaptura = { largura: number; altura: number; fps: number; canal?: boolean };

/** Um segundo do auxiliar de captura: quadros novos e repetidos (imagem parada) e o tempo dele por quadro novo. */
export type MedidasDoAuxiliarDeCaptura = { novos: number; repetidos: number; msConversao: number; largura: number; altura: number; msSaida?: number; deixados?: number };

/**
 * somDoApp: o som do PC vem do auxiliar do app (sem o Discord e sem o Ozamigos), não do navegador. videoDoApp: o vídeo
 * vem da captura do app (1.2.18 em diante) e o getDisplayMedia foi recusado de propósito; tipo e fonte dizem de onde.
 */
export type ResultadoDaEscolha = { somDoApp: boolean; videoDoApp?: boolean; tipo?: FonteDeCaptura['tipo']; fonte?: string };

export type PonteOzamigos = {
  versao: string;
  /** Chamado quando a página pede getDisplayMedia: a interface mostra o seletor e responde. */
  aoPedirFonte(ouvinte: (fontes: FonteDeCaptura[]) => void): void;
  responderFonte(escolha: EscolhaDeFonte | null): Promise<ResultadoDaEscolha>;
  /** Pedaços do som do PC: float32 estéreo intercalado, 48 kHz. */
  aoReceberSom(ouvinte: (dados: Uint8Array) => void): void;
  pararSom(): void;
  /** Pede o canal direto do som do PC até o AudioWorklet (app 1.2.20 em diante); a porta chega por postMessage. */
  canalDoSom?(): void;
  /**
   * A captura de vídeo do app (1.2.18 em diante). Cada quadro: um cabeçalho de 24 bytes ("OZQ1", largura e altura em
   * u16, o número em u32, 4 de reserva e o momento da captura em ms desde 1970, f64) e a imagem em NV12.
   */
  video?: {
    /** O app manda os quadros por um canal direto, com controle de fluxo (1.2.19 em diante): a porta chega por postMessage. */
    canalDireto?: boolean;
    aoReceberQuadro(ouvinte: (dados: Uint8Array) => void): void;
    /** Parou sozinha: a janela fechou, ou a captura falhou (a página troca para a do Chromium, pela fonte). */
    aoParar(ouvinte: (aviso: { motivo: 'fechou' | 'falhou'; fonte: string }) => void): void;
    parar(): void;
    /** O último segundo do auxiliar (para a gravação das estatísticas). */
    medidas?(): Promise<MedidasDoAuxiliarDeCaptura | null>;
  };
  /** Volta para a tela de escolher o servidor. */
  trocarServidor(): void;
  /**
   * O login pelo navegador do sistema (app 1.3.0 em diante; conta.ts): o app abre o navegador e espera a volta numa
   * porta só do PC. Com `ligacao` (o código que a página pediu), liga mais um provedor à conta em vez de entrar.
   */
  conta?: {
    loginPeloNavegador(provedor: 'google' | 'discord', ligacao?: string): Promise<{ codigo?: string; ligou?: string; erro?: string }>;
  };
  /** Um convite (link ozamigos://sala/CODIGO) chegou com o app aberto (app 1.2.16 em diante). */
  aoAbrirSala?(ouvinte: (sala: string) => void): void;
  /** Cor dos botões da janela, para combinar com o que está embaixo deles (app 1.2.9 em diante). */
  corDaBarra?(cor: string): void;
  /** Teste de desempenho (app 1.2.10 em diante): o que o navegador não mede. */
  desempenho?: {
    pc(): Promise<InfoDoPc | null>;
    /** Liga ou desliga os contadores do Windows (processador do PC e motores da placa de vídeo). */
    ligar(ligado: boolean): Promise<boolean>;
    amostra(): Promise<AmostraDoPc | null>;
  };
  /** Mensagens do chat ainda não vistas: o ponto na barra de tarefas e a dica da bandeja (app 1.2.13 em diante). */
  naoLidas?(quantas: number): void;
  /** Alguém chamou a sua atenção: o ícone pisca na barra de tarefas (app 1.2.21 em diante). */
  chamarAtencao?(): void;
  /** Fechar a janela deixa o app na bandeja, perto do relógio (app 1.2.13 em diante). */
  bandeja?: {
    ler(): Promise<boolean | null>;
    definir(ligada: boolean): void;
  };
  /**
   * Atalhos de voz com o jogo na frente (app 1.2.17 em diante): as teclas virtuais do Windows de cada atalho.
   * Resolve true se valem fora da janela. O ouvinte recebe "mudo", "surdo", "falar 1" ou "falar 0".
   */
  atalhos?: {
    definir(atalhos: Record<'mudo' | 'surdo' | 'falar', number[]>): Promise<boolean>;
    aoApertar(ouvinte: (evento: string) => void): void;
  };
  /** Gravação das estatísticas da sala (app 1.2.11 em diante): salva em Documentos\Ozamigos\Estatísticas\<pasta>. */
  estatisticas?: {
    /** Devolve o caminho da pasta, ou null se recusou. */
    salvar(pasta: string, arquivos: Record<string, string>): Promise<string | null>;
    abrirPasta(pasta: string): Promise<boolean>;
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
let ultimaEscolha: Promise<ResultadoDaEscolha> = Promise.resolve({ somDoApp: false });

export function responderFonte(escolha: EscolhaDeFonte | null) {
  ultimaEscolha = ponte?.responderFonte(escolha) ?? Promise.resolve({ somDoApp: false });
}

export function resultadoDaUltimaEscolha() {
  return ultimaEscolha;
}

/** Antes de abrir o seletor: um pedido que o app recusar sem mostrar as fontes não pode valer pela escolha de antes. */
export function esquecerEscolha() {
  ultimaEscolha = Promise.resolve({ somDoApp: false });
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
