// O que cada opção de qualidade pede ao codificador de quem transmite.
// Todas mudam ao vivo, sem refazer as conexões (setParameters).
// "detalhe" é o que sai de verdade: o codificador da placa passa uns 25% do bitrate pedido (medido numa AMD,
// 6–6,5 Mbps pedindo 5).
// São só duas, a 30 fps (até a 1.2.12 havia também 1080p e 720p a 60): em jogo pesado, a captura do Chromium já fica
// entre 21 e 29 fps, e os 60 dobravam o custo de codificar e de enviar para um ganho que quase nunca aparecia.
// A padrão é 720p, como a do Discord sem Nitro, que sempre bastou para o grupo.
// "preferencia" diz o que sacrificar quando faltar internet ou placa de vídeo:
// - a 720p usa "balanced": num PC fraco, o próprio WebRTC baixa a imagem (~540p) em vez de travar;
// - a 1080p nunca baixa a resolução: com "balanced", uma queda curta da banda (Wi-Fi) a jogava para 720p por quase
//   dois minutos, mesmo com a banda já de volta. Quando o aperto dura, quem desce é a QualidadeAutomatica, abaixo.
export const QUALIDADES = {
  leve: { rotulo: '720p · 30 fps', detalhe: '~4 Mbps por amigo', altura: 720, fps: 30, bitrate: 3_000_000, preferencia: 'balanced' },
  nitida: { rotulo: '1080p · 30 fps', detalhe: '~6 Mbps por amigo, mais pesado', altura: 1080, fps: 30, bitrate: 5_000_000, preferencia: 'maintain-resolution' },
} as const satisfies Record<string, {
  rotulo: string;
  detalhe: string;
  altura: number;
  fps: number;
  bitrate: number;
  preferencia: RTCDegradationPreference;
}>;

export type Qualidade = keyof typeof QUALIDADES;

export const QUALIDADE_PADRAO: Qualidade = 'leve';

export function ehQualidade(valor: string): valor is Qualidade {
  return Object.hasOwn(QUALIDADES, valor);
}

// As opções a 60 fps (até a 1.2.12) viram a de 30 fps do mesmo tamanho.
const ANTIGAS: Record<string, Qualidade> = { maxima: 'nitida', equilibrada: 'leve' };

/** A qualidade guardada no navegador, com as opções que saíram trocadas pela equivalente; a padrão se não houver. */
export function qualidadeGuardada(valor: string): Qualidade {
  if (ehQualidade(valor)) return valor;
  return ANTIGAS[valor] ?? QUALIDADE_PADRAO;
}

/**
 * Os fps que a captura está entregando, quando ficam abaixo do que a qualidade pede (com folga de 15%),
 * ou null se está tudo certo ou ainda não há medição (a captura só é medida com alguém assistindo).
 * Nada a ver com a internet: é o PC de quem transmite copiando a imagem do jogo mais devagar.
 * Medido com o Path of Exile: ~21 fps de captura numa qualidade de 30, com a placa de vídeo folgada ou não.
 */
export function capturaAbaixo(capturas: (number | null)[], qualidade: Qualidade): number | null {
  const medidas = capturas.filter((fps): fps is number => fps != null);
  if (medidas.length === 0) return null;
  const fps = Math.round(Math.max(...medidas));
  return fps < QUALIDADES[qualidade].fps * 0.85 ? fps : null;
}
