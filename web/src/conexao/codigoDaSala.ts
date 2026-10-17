// O código da sala: o que vai no link que um amigo manda para o outro.

/** O mesmo limite do servidor (Salas.LIMITE_POR_SALA). */
export const LIMITE_POR_SALA = 8;

export function codigoValido(codigo: string): boolean {
  return /^[A-Za-z0-9]{6,20}$/.test(codigo);
}

/** 10 caracteres aleatórios, sem os que se confundem (0 e O, 1, l e I). */
export function novoCodigo(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const aleatorios = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(aleatorios, (n) => letras[n % letras.length]).join('');
}

/** Aceita o código puro, um link com ?sala=... (o que o amigo mandou no chat) ou um convite ozamigos://sala/... */
export function codigoDe(texto: string): string {
  const limpo = texto.trim();
  try {
    const link = new URL(limpo);
    if (link.protocol === 'ozamigos:') return link.hostname === 'sala' ? link.pathname.replace(/^\/+|\/+$/g, '') : '';
    const daUrl = link.searchParams.get('sala');
    if (daUrl) return daUrl;
  } catch {
    // não é um link: é o próprio código
  }
  return limpo;
}

/** O convite que abre o app para Windows direto na sala (registrado pelo app instalado, 1.2.16 em diante). */
export function linkDoApp(codigo: string): string {
  return `ozamigos://sala/${codigo}`;
}

export function linkDaSala(codigo: string): string {
  return `${location.origin}${location.pathname}?sala=${codigo}`;
}
