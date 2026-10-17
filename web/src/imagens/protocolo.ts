// O que passa no canal "imagens" da conexão de voz, sem DOM nem WebRTC (os testes usam direto).
// Texto é controle (JSON); binário é um pedaço da imagem que está chegando. O canal é ordenado e confiável, e quem manda
// manda uma imagem de cada vez para cada pessoa: os pedaços sempre são da última imagem anunciada.
import { MAXIMO_DA_MINIATURA, MAXIMO_RECEBIDO, tamanhoAceito, tamanhoDoWebp } from './regras';

export type Controle =
  | { t: 'ola'; id: '' } // o canal abriu e esta página troca imagens (a página antiga, de antes delas, não manda)
  | { t: 'inicio'; id: string; largura: number; altura: number; bytes: number; miniatura: string }
  | { t: 'fim'; id: string }
  | { t: 'cancelar'; id: string }
  | { t: 'recebi'; id: string }
  | { t: 'recusei'; id: string; motivo: string };

/** Uma imagem chegando de alguém: some de quem recebe se não terminar nesse prazo (a conexão travou no meio). */
export const PRAZO_PARA_CHEGAR = 60_000;
/** Quem recebe aceita no máximo isso por minuto de cada pessoa (quem manda tem um freio menor, em cliente.ts). */
export const IMAGENS_RECEBIDAS_POR_MINUTO = 20;

export type Chegada =
  | { tipo: 'comecou'; id: string; largura: number; altura: number; miniatura: string }
  | { tipo: 'progresso'; id: string; fracao: number }
  | { tipo: 'chegou'; id: string; bytes: Uint8Array }
  | { tipo: 'falhou'; id: string; motivo: string; responder: boolean };

/** Lê uma mensagem de controle, ou null se não for uma que se conheça. */
export function lerControle(texto: string): Controle | null {
  try {
    const msg = JSON.parse(texto) as Controle;
    if (typeof msg?.id !== 'string' || msg.id.length > 40) return null;
    if (['ola', 'inicio', 'fim', 'cancelar', 'recebi', 'recusei'].includes(msg.t)) return msg;
  } catch {
    // não é JSON: ignora
  }
  return null;
}

type Atual = { id: string; largura: number; altura: number; bytes: number; partes: Uint8Array[]; recebidos: number; comeco: number };

/**
 * O que chega de uma pessoa. Confere tudo antes de deixar a imagem aparecer: o tamanho anunciado, a soma dos pedaços
 * e o cabeçalho do WebP (que precisa dizer o mesmo tamanho anunciado). Tudo o que não bate é recusado e jogado fora.
 */
export class Recepcao {
  private atual: Atual | null = null;
  private inicios: number[] = [];

  /** O que fazer com uma mensagem de controle de quem manda (as de quem recebe, recebi e recusei, ficam de fora). */
  controle(msg: Controle, agora: number): Chegada[] {
    const saida: Chegada[] = [];
    if (msg.t === 'inicio') {
      // Uma nova antes de a anterior terminar: a anterior não vem mais (quem manda desistiu ou reconectou).
      if (this.atual) saida.push(this.descartar('interrompida', false));
      this.inicios = this.inicios.filter((momento) => agora - momento < 60_000);
      const motivo = this.recusaDoInicio(msg);
      if (motivo) return [...saida, { tipo: 'falhou', id: msg.id, motivo, responder: true }];
      this.inicios.push(agora);
      this.atual = { id: msg.id, largura: msg.largura, altura: msg.altura, bytes: msg.bytes, partes: [], recebidos: 0, comeco: agora };
      saida.push({ tipo: 'comecou', id: msg.id, largura: msg.largura, altura: msg.altura, miniatura: msg.miniatura });
    } else if (msg.t === 'cancelar') {
      if (this.atual?.id === msg.id) saida.push(this.descartar('cancelada', false));
    } else if (msg.t === 'fim') {
      if (this.atual?.id === msg.id) saida.push(this.terminar());
    }
    return saida;
  }

  /** Um pedaço da imagem que está chegando. */
  pedaco(dados: ArrayBuffer): Chegada | null {
    const a = this.atual;
    if (!a) return null; // de uma imagem já recusada ou cancelada
    if (a.recebidos + dados.byteLength > a.bytes) return this.descartar('maior que o anunciado', true);
    a.partes.push(new Uint8Array(dados));
    a.recebidos += dados.byteLength;
    return { tipo: 'progresso', id: a.id, fracao: a.recebidos / a.bytes };
  }

  /** A imagem que está chegando há tempo demais: a conexão travou. */
  vencer(agora: number): Chegada | null {
    if (!this.atual || agora - this.atual.comeco < PRAZO_PARA_CHEGAR) return null;
    return this.descartar('demorou demais', true);
  }

  /** A conexão caiu: o que estava chegando não vem mais. */
  encerrar(): Chegada | null {
    return this.atual ? this.descartar('a conexão caiu', false) : null;
  }

  private recusaDoInicio(msg: Extract<Controle, { t: 'inicio' }>): string | null {
    if (this.inicios.length >= IMAGENS_RECEBIDAS_POR_MINUTO) return 'imagens demais';
    if (!tamanhoAceito(msg.largura, msg.altura)) return 'tamanho fora da regra';
    if (!Number.isInteger(msg.bytes) || msg.bytes < 30 || msg.bytes > MAXIMO_RECEBIDO) return 'arquivo grande demais';
    if (typeof msg.miniatura !== 'string' || msg.miniatura.length > MAXIMO_DA_MINIATURA || !/^[A-Za-z0-9+/]*={0,2}$/.test(msg.miniatura)) {
      return 'miniatura inválida';
    }
    return null;
  }

  private terminar(): Chegada {
    const a = this.atual!;
    if (a.recebidos !== a.bytes) return this.descartar('chegou incompleta', true);
    const bytes = new Uint8Array(a.bytes);
    let posicao = 0;
    for (const parte of a.partes) {
      bytes.set(parte, posicao);
      posicao += parte.length;
    }
    const tamanho = tamanhoDoWebp(bytes);
    if (!tamanho || tamanho.largura !== a.largura || tamanho.altura !== a.altura) return this.descartar('não é a imagem anunciada', true);
    this.atual = null;
    return { tipo: 'chegou', id: a.id, bytes };
  }

  private descartar(motivo: string, responder: boolean): Chegada {
    const id = this.atual!.id;
    this.atual = null;
    return { tipo: 'falhou', id, motivo, responder };
  }
}

/** Os pedaços de uma imagem, do tamanho que o canal aceita. */
export function* pedacos(bytes: Uint8Array, tamanho: number): Generator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += tamanho) yield bytes.subarray(i, Math.min(i + tamanho, bytes.length));
}

/** Um id curto para cada imagem (só precisa ser diferente entre as imagens de uma mesma sessão). */
export function novoIdDeImagem(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => n.toString(16).padStart(2, '0')).join('');
}
