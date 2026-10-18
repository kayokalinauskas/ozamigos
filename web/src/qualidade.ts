// A qualidade da transmissão: 720p a 30 fps, a não ser que a pessoa escolha outra na engrenagem do app (aba Geral).
// Muda ao vivo só o que o próprio WebRTC ajusta.
// "detalhe" é o que sai de verdade: o codificador da placa passa uns 25% do bitrate pedido (medido numa AMD).
// Até 14/10/2026 havia escolha (1080p e 720p, a 30 e a 60 fps). Saiu por decisão do dono: em jogo pesado a captura do
// Chromium não passava de ~21–29 fps, o 1080p nunca rendeu de verdade e dobrava o custo de codificar e de enviar, e
// 720p · 30 é o que o grupo sempre usou no Discord sem Nitro. Voltou em 17/10/2026, também por pedido do dono, só no
// app e longe da tela principal, com o custo dito antes: a captura do app (1.2.18) custa o mesmo em 1080p e em 720p
// (medido na fase 1), e era a captura do Chromium que tirava o sentido do 1080p. O padrão continua o 720p · 30.
// Ainda não medido com amigos: confira o "Limite" e a "Banda estimada" das estatísticas. A 60 fps, em jogo pesado, a
// captura da tela parava em ~30–35 quadros novos por segundo (fase 1, com a duplicação da tela); a da janela pelo
// Windows Graphics Capture ainda não foi medida acima de 30. O aviso "Captura a N fps" mostra quando não chega.
// Os bitrates: 1080p tem 2,25 vezes os pixels do 720p e vai com o dobro (o H.265 rende mais por bit); 60 fps vai com
// 1,5 vez o de 30 (de um quadro para o outro, muda menos).
// "maintain-resolution" (o mesmo do LiveKit, base do Stoat, para tela): quando falta internet ou processador, o WebRTC
// baixa o fps e a nitidez, mas a imagem continua no tamanho escolhido. Como cada pessoa assistindo tem a sua conexão e o
// seu codificador, isso acontece por pessoa, sem código nosso. Até 14/10/2026 era "balanced", que cortava a resolução:
// em jogo pesado ela não voltava (o WebRTC só sobe quando a imagem fica fácil de codificar), e dois relatórios reais
// ficaram minutos em 360p e 540p com 6 Mbps de banda sobrando.
export const QUALIDADES = {
  leve: { rotulo: '720p · 30 fps', detalhe: '~4 Mbps por amigo', altura: 720, fps: 30, bitrate: 3_000_000, preferencia: 'maintain-resolution' },
  leve60: { rotulo: '720p · 60 fps', detalhe: '~6 Mbps por amigo', altura: 720, fps: 60, bitrate: 4_500_000, preferencia: 'maintain-resolution' },
  nitida: { rotulo: '1080p · 30 fps', detalhe: '~7 Mbps por amigo', altura: 1080, fps: 30, bitrate: 6_000_000, preferencia: 'maintain-resolution' },
  nitida60: { rotulo: '1080p · 60 fps', detalhe: '~11 Mbps por amigo', altura: 1080, fps: 60, bitrate: 9_000_000, preferencia: 'maintain-resolution' },
} as const satisfies Record<string, {
  rotulo: string;
  detalhe: string;
  altura: number;
  fps: number;
  bitrate: number;
  preferencia: RTCDegradationPreference;
}>;

/** O nome interno do 720p · 30 ficou "leve", o mesmo de antes: os relatórios antigos e novos continuam comparáveis. */
export type Qualidade = keyof typeof QUALIDADES;

export const QUALIDADE: Qualidade = 'leve';

/**
 * A qualidade pode ir em H.265? Só até 720p. Em 1080p a 60 fps, reconfigurar o codificador H.265 da AMD no meio da
 * transmissão (a subida do bitrate aos 6 s, BITRATE_INICIAL; a janela mudando de tamanho; os ajustes da rede) faz ele
 * devolver um quadro que o WebRTC não sabe de onde veio ("Frame with no encode started time recordings"), e logo depois
 * a página cai (uma verificação fatal do Chromium na thread "Media", 0xC000001D). Medido em 17/10/2026, 30 Alt+Tabs com
 * a tela inteira e o jogo aberto: 1080p · 60 em H.265 caiu três vezes em três (uma antes do primeiro Alt+Tab, logo
 * depois da subida do bitrate); sem a subida, não caiu; 720p · 30 e 720p · 60 em H.265, e 1080p · 60 em H.264, nunca.
 * No 1.2.18 e 1.2.19, transmitindo em 1080p para um celular ou outro app, a sala caía (relato do dono).
 */
export function aceitaHevc(qualidade: Qualidade): boolean {
  return QUALIDADES[qualidade].altura <= 720;
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
