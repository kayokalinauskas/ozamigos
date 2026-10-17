// O formato dos dados do teste de desempenho. É o mesmo do JSON salvo e a base do relatório para IA:
// mudou algo aqui, suba FORMATO e confira relatorioIa.ts (o glossário explica cada campo).

import type { InfoDoPc } from '../ponte';
import type { Qualidade } from '../qualidade';

export const FORMATO = 'ozamigos-desempenho/2';

/** Os primeiros segundos de cada trecho ficam fora das médias: o WebRTC começa com pouca banda e vai subindo. */
export const SEGUNDOS_DESCARTADOS = 8;
export const FORMATO_DA_SALA = 'ozamigos-sala/1';

/**
 * simulado: espectadores criados no próprio PC, num roteiro automático (Ctrl+Shift+X).
 * sala: uma transmissão de verdade, tirada da gravação das estatísticas da sala (Ctrl+Shift+G).
 */
export type Modo = 'simulado' | 'sala';
export type Roteiro = 'completo' | 'rapido';

/**
 * Intervalos entre quadros, em ms, contados em faixas. FAIXAS[i] é o limite de cima da faixa i;
 * a última conta tudo acima do penúltimo limite.
 */
export const FAIXAS = [10, 14, 18, 22, 25, 30, 34, 40, 50, 67, 84, 100, 150, 250, Infinity];

/** Lado de quem transmite: uma por espectador por segundo (estatísticas outbound-rtp e candidate-pair). */
export type AmostraEnvio = {
  t: number; // segundos desde o início do teste
  espectador: string;
  simulado: boolean;
  largura: number | null;
  altura: number | null;
  fpsCodificados: number;
  fpsEnviados: number;
  mbps: number;
  alvoMbps: number | null; // targetBitrate: o que o controle de banda pediu ao codificador
  msCodificacao: number | null; // tempo médio do codificador por quadro
  qp: number | null; // quantização média: menor = mais nítido (H.264: ~20 ótimo, >35 borrado)
  quadrosChave: number;
  limite: string | null; // qualityLimitationReason: none, cpu, bandwidth, other
  msFilaDeEnvio: number | null; // espera média dos pacotes no pacer antes de sair
  nacks: number;
  plis: number; // pedidos de quadro-chave de quem assiste (perdeu imagem)
  retransmitidosKbps: number;
  rttMs: number | null;
  bandaMbps: number | null; // availableOutgoingBitrate: a banda que o WebRTC estima ter
  rede: string | null; // host, srflx, prflx, relay
  codec: string | null;
  codificador: string | null; // encoderImplementation
  codificadorDaPlaca: boolean | null; // powerEfficientEncoder
};

/** A imagem que o Windows entrega ao navegador (media-source), uma por segundo. */
export type AmostraCaptura = { t: number; fps: number | null; largura: number | null; altura: number | null };

/** Resumo de um segundo dos intervalos entre quadros mostrados na tela (requestVideoFrameCallback). */
export type Ritmo = {
  quadros: number;
  mediaMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  faixas: number[]; // contagem por faixa de FAIXAS
  msRecebidoAteTela: number | null; // média: último pacote do quadro chegou -> quadro na tela
  msCapturaAteTela: number | null; // média, quando o navegador informa o horário da captura (abs-capture-time)
};

/** Lado de quem assiste: uma por espectador por segundo (inbound-rtp e o ritmo na tela). */
export type AmostraRecepcao = {
  t: number;
  espectador: string;
  simulado: boolean;
  largura: number | null;
  altura: number | null;
  fpsRecebidos: number;
  fpsDecodificados: number;
  fpsExibidos: number | null; // null: o vídeo não estava na tela (janela escondida ou minimizada)
  mbps: number;
  msDecodificacao: number | null;
  msBuffer: number | null; // jitter buffer: quanto o quadro esperou antes de ir para a tela
  // Opcionais: versões antigas do Ozamigos não mandam.
  msBufferSom?: number | null; // o mesmo para o som da transmissão (null sem som); a imagem espera o som para os dois saírem juntos
  folgaMs?: number | null; // a folga pedida no receptor de vídeo (jitterBufferTarget, folga.ts)
  intervaloMedioMs: number | null; // entre quadros entregues pelo decodificador (vale mesmo com a janela escondida)
  intervaloDesvioMs: number | null;
  congelamentos: number;
  msCongelado: number;
  descartados: number; // framesDropped
  pacotesPerdidos: number;
  perdaPct: number;
  jitterMs: number | null;
  rttMs: number | null;
  rede: string | null;
  decodificador: string | null;
  decodificadorDaPlaca: boolean | null;
  ritmo: Ritmo | null;
  janelaVisivel: boolean;
  tarefasLongas: number; // da página de quem assiste
  msTarefaMaior: number;
};

/** O PC de quem transmite (só no app para Windows). Uso em %, do processador ou da placa inteira. */
export type AmostraPc = {
  t: number;
  cpuApp: number;
  cpuPorProcesso: Record<string, number>;
  memoriaAppMB: number;
  cpuPc: number | null;
  placa3dTotal: number | null;
  placaVideoTotal: number | null; // o motor de vídeo mais ocupado (codificação/decodificação)
  placa3dApp: number | null;
  placaVideoApp: number | null;
  placa3dOutros: number | null; // o jogo, principalmente
  motores: Record<string, number> | null;
  memoriaPlacaMB: number | null;
};

/** A página de quem transmite: travadas da interface (tarefas acima de 50 ms). */
export type AmostraPagina = { t: number; tarefasLongas: number; msTarefaMaior: number; janelaVisivel: boolean };

/** transmissao: na gravação da sala, de qual transmissão é (sem ela, vale para todas). */
export type Acontecimento = { t: number; tipo: string; texto: string; transmissao?: string };

/** Um pedaço do teste com a mesma qualidade e o mesmo número de espectadores. */
export type Trecho = {
  indice: number;
  nome: string;
  inicio: number;
  fim: number;
  qualidade: Qualidade;
  espectadores: number;
  simulados: number;
  /** Os primeiros segundos do teste: a conexão ainda está subindo, nada dele entra nas conclusões. */
  aquecimento: boolean;
  /** Os primeiros segundos de cada trecho ficam fora das médias: o WebRTC ainda está subindo a banda. */
  descartarAte: number;
  /** Na gravação da sala: quantas transmissões quem transmite estava assistindo ao mesmo tempo. */
  assistindo?: number;
};

export type EspectadorReal = { nome: string; ambiente: AmbienteDoEspectador | null };

export type AmbienteDoEspectador = {
  app: string;
  navegador: string;
  tela: string;
  hz: number | null;
  nucleos: number | null;
  /** O PC (só no app 1.2.10 em diante). */
  pc?: InfoDoPc | null;
};

// ===== Gravação das estatísticas da sala (Ctrl+Shift+G) =====

/**
 * Um segundo de uma pessoa da sala: o que ela transmite (uma linha de envio por quem assiste) e o que ela
 * assiste (uma linha de recepção por transmissão). Cada PC manda o seu pelo servidor para quem está gravando.
 * Os ids são os do servidor; quem grava troca pelos nomes.
 */
export type Pacote = {
  transmissao: { qualidade: Qualidade; fonte: string } | null;
  envio: AmostraEnvio[]; // espectador = id de quem assiste
  captura: AmostraCaptura | null;
  recepcao: (AmostraRecepcao & { transmissor: string })[]; // transmissor = id de quem transmite
  pc: AmostraPc | null;
  pagina: AmostraPagina;
  /** No primeiro pacote e a cada 30 s (quem grava pode ter começado depois). */
  ambiente?: AmbienteDoEspectador;
};

/** O que uma pessoa estava fazendo num segundo da gravação. */
export type Papel = { t: number; pessoa: string; transmite: boolean; qualidade: Qualidade | null; espectadores: string[]; assiste: string[] };

/**
 * A gravação da sala inteira: tudo com o nome das pessoas. Cada transmissão vira uma Gravacao (modo "sala")
 * para a análise; o PC e a página de quem só assiste ficam aqui.
 */
export type GravacaoDaSala = {
  formato: typeof FORMATO_DA_SALA;
  sala: string;
  gravadoPor: string;
  inicio: string; // ISO
  duracao: number; // s
  terminou: boolean; // false: salvamento automático no meio da gravação
  pessoas: { nome: string; ambiente: AmbienteDoEspectador | null; fontes: string[] }[];
  papeis: Papel[]; // a cada mudança de papel de cada pessoa (e no primeiro segundo dela)
  /** Os trechos de cada transmissão (pelo nome de quem transmite). */
  trechos: Record<string, Trecho[]>;
  envio: (AmostraEnvio & { transmissor: string })[];
  captura: (AmostraCaptura & { pessoa: string })[];
  recepcao: (AmostraRecepcao & { transmissor: string })[]; // espectador = quem assiste
  pcAmostras: (AmostraPc & { pessoa: string })[];
  pagina: (AmostraPagina & { pessoa: string })[];
  acontecimentos: Acontecimento[];
  ajustes: Record<string, unknown>;
  qualidades: Record<string, unknown>;
};

export type Gravacao = {
  formato: typeof FORMATO;
  modo: Modo;
  roteiro: Roteiro | null;
  inicio: string; // ISO
  duracao: number; // s
  interrompido: boolean;
  app: string;
  navegador: string;
  pc: InfoDoPc | null;
  tela: string;
  qualidadeDaPessoa: Qualidade;
  fonte: string; // o que estava sendo transmitido
  ajustes: Record<string, unknown>;
  qualidades: Record<string, unknown>;
  trechos: Trecho[];
  espectadoresReais: EspectadorReal[];
  envio: AmostraEnvio[];
  captura: AmostraCaptura[];
  recepcao: AmostraRecepcao[];
  pcAmostras: AmostraPc[];
  pagina: AmostraPagina[];
  acontecimentos: Acontecimento[];
};
