// Os endereços das salas: as dos servidores salvos (Servidores.java), as únicas desde 28/10/2026 (decisão do dono:
// as salas com senha, o grupo fixo e os grupos criados na hora saíram).

/** O mesmo limite do servidor (Salas.LIMITE_POR_SALA). */
export const LIMITE_POR_SALA = 8;

/** O código de um servidor ou de um convite: 10 letras e números (Servidores.CODIGO). */
const CODIGO_SALVO = /^[A-Za-z0-9]{10}$/;

/** O servidor salvo de um caminho (/s/<codigo>), ou null. */
export function servidorDoCaminho(caminho: string): string | null {
  const partes = caminho.replace(/^\/+|\/+$/g, '').split('/');
  return partes.length === 2 && partes[0] === 's' && CODIGO_SALVO.test(partes[1]) ? partes[1] : null;
}

/** O convite de um caminho (/c/<codigo>), ou null. */
export function conviteDoCaminho(caminho: string): string | null {
  const partes = caminho.replace(/^\/+|\/+$/g, '').split('/');
  return partes.length === 2 && partes[0] === 'c' && CODIGO_SALVO.test(partes[1]) ? partes[1] : null;
}

export function linkDoConvite(codigo: string): string {
  return `${location.origin}/c/${codigo}`;
}

/** O mesmo convite, para abrir no app para Windows (registrado pelo app instalado, 1.3.1 em diante). */
export function linkDoAppParaConvite(codigo: string): string {
  return `ozamigos://convite/${codigo}`;
}
