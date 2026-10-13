// O que cada opção de qualidade pede ao codificador de quem transmite.
// Todas mudam ao vivo, sem refazer as conexões (setParameters).
// "preferencia" diz o que sacrificar quando faltar internet ou placa de vídeo:
// nas opções a 60 fps, a fluidez vale mais (baixa a resolução); nas a 30 fps, a nitidez pesa mais.
export const QUALIDADES = {
  nitida: { rotulo: '1080p · 30 fps', detalhe: '~5 Mbps por amigo', altura: 1080, fps: 30, bitrate: 5_000_000, preferencia: 'balanced' },
  maxima: { rotulo: '1080p · 60 fps', detalhe: '~8 Mbps por amigo', altura: 1080, fps: 60, bitrate: 8_000_000, preferencia: 'maintain-framerate' },
  equilibrada: { rotulo: '720p · 60 fps', detalhe: '~5 Mbps por amigo', altura: 720, fps: 60, bitrate: 5_000_000, preferencia: 'maintain-framerate' },
  leve: { rotulo: '720p · 30 fps', detalhe: '~3 Mbps por amigo', altura: 720, fps: 30, bitrate: 3_000_000, preferencia: 'balanced' },
} as const satisfies Record<string, {
  rotulo: string;
  detalhe: string;
  altura: number;
  fps: number;
  bitrate: number;
  preferencia: RTCDegradationPreference;
}>;

export type Qualidade = keyof typeof QUALIDADES;

export const QUALIDADE_PADRAO: Qualidade = 'nitida';

export function ehQualidade(valor: string): valor is Qualidade {
  return Object.hasOwn(QUALIDADES, valor);
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
