// A qualidade da transmissão, sempre a mesma: 720p a 30 fps. Muda ao vivo só o que o próprio WebRTC ajusta.
// "detalhe" é o que sai de verdade: o codificador da placa passa uns 25% do bitrate pedido (medido numa AMD).
// Até 14/10/2026 havia escolha (1080p e 720p, a 30 e a 60 fps). Saiu por decisão do dono: em jogo pesado a captura do
// Chromium não passa de ~21–29 fps, o 1080p nunca rendeu de verdade e dobrava o custo de codificar e de enviar, e
// 720p · 30 é o que o grupo sempre usou no Discord sem Nitro.
// "balanced": quando falta processador ou internet, o WebRTC baixa a resolução ou o fps em vez de travar. Como cada
// pessoa assistindo tem a sua conexão e o seu codificador, isso acontece por pessoa: quem está num Wi-Fi ruim recebe
// menor, e quem está no cabo continua em 720p. Não precisa de código nosso para isso.
export const QUALIDADES = {
  leve: { rotulo: '720p · 30 fps', detalhe: '~4 Mbps por amigo', altura: 720, fps: 30, bitrate: 3_000_000, preferencia: 'balanced' },
} as const satisfies Record<string, {
  rotulo: string;
  detalhe: string;
  altura: number;
  fps: number;
  bitrate: number;
  preferencia: RTCDegradationPreference;
}>;

/** O nome interno ficou "leve", o mesmo de antes: os relatórios antigos e novos continuam comparáveis. */
export type Qualidade = keyof typeof QUALIDADES;

export const QUALIDADE: Qualidade = 'leve';

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
