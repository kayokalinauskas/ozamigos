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

/**
 * O endereço /ozamigos é o grupo fixo (a senha do servidor) com uma sala só, sempre a mesma: a de código "ozamigos".
 * Quem entra por /?sala=ozamigos (o app antigo, por exemplo) cai na mesma sala.
 */
export const SALA_FIXA = 'ozamigos';

export function ehASalaFixa(caminho: string): boolean {
  return caminho.replace(/^\/+|\/+$/g, '') === SALA_FIXA;
}

// ===== Grupos criados na hora (Grupos.java): o endereço é /nome, e o grupo tem uma sala só =====

/** Os mesmos de Grupos.RESERVADOS no servidor: o grupo fixo e os caminhos do site. */
const GRUPOS_RESERVADOS = new Set(['ozamigos', 'sinal', 'actuator', 'assets', 'api', 'index', 'error', 'privacidade', 'privacy', 'sala', 'salas', 'grupo', 'grupos', 'admin', 'login', 'app', 'site', 'www', 'en']);

/** O grupo fixo e os caminhos do site: têm o formato certo, mas não podem ser grupos. */
export function grupoReservado(nome: string): boolean {
  return GRUPOS_RESERVADOS.has(nome);
}

/** Letras minúsculas, números e hífen, de 3 a 32, sem hífen nas pontas (Grupos.NOME_VALIDO). */
export function grupoValido(nome: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(nome) && !GRUPOS_RESERVADOS.has(nome);
}

/** O nome que a pessoa digitou, do jeito que vai no endereço: minúsculas, sem acentos, espaços viram hífen. */
export function nomeDeGrupo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 32);
}

/** O grupo de um caminho (/nome), ou null: a raiz e o resto são o grupo fixo. */
export function grupoDoCaminho(caminho: string): string | null {
  const nome = caminho.replace(/^\/+|\/+$/g, '');
  return grupoValido(nome) ? nome : null;
}

/** O grupo de um link colado (https://.../nome), ou null. */
export function grupoDe(texto: string): string | null {
  try {
    const link = new URL(texto.trim());
    return link.protocol.startsWith('http') ? grupoDoCaminho(link.pathname) : null;
  } catch {
    return null;
  }
}

export function linkDoGrupo(nome: string): string {
  return `${location.origin}/${nome}`;
}

// ===== Servidores salvos (Servidores.java): /s/<codigo> é o servidor, /c/<codigo> um convite para ele =====

/** O código de um servidor ou de um convite: 10 letras e números (Servidores.CODIGO). */
const CODIGO_SALVO = /^[A-Za-z0-9]{10}$/;

/** O servidor salvo de um caminho (/s/<codigo>, ou "s/<codigo>" como fica guardado), ou null. */
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
