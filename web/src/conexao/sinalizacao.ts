// A conexão com o servidor de sinalização (WebSocket em /sinal): abrir, mandar, receber em ordem e tentar de
// novo quando cai. O que fazer com cada mensagem, e quando vale a pena reconectar, fica com o cliente.

import { lerMensagem, type MensagemDoServidor, type MensagemParaOServidor } from './protocolo';

// Reconexão: espera 1 s, depois 2, 5 e então 10 s entre as tentativas, até conseguir.
export const ESPERAS_PARA_RECONECTAR = [1_000, 2_000, 5_000, 10_000];

export type EventosDaSinalizacao = {
  /** Abriu: hora de mandar o "entrar". */
  aoAbrir(): void;
  /** Uma mensagem do servidor. As mensagens são tratadas uma de cada vez, na ordem em que chegaram. */
  aoReceber(msg: MensagemDoServidor): void | Promise<void>;
  /** Fechou sem ninguém daqui pedir (o servidor recusou, a rede caiu, o servidor reiniciou). */
  aoFechar(): void;
};

export class Sinalizacao {
  private ws: WebSocket | null = null;
  private tentativas = 0;
  private reconexao: ReturnType<typeof setTimeout> | null = null;
  private ultimaMensagem = 0;

  constructor(
    private readonly eventos: EventosDaSinalizacao,
    private readonly endereco = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sinal`,
  ) {}

  get aberta(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Há quanto tempo (ms) não chega nada do servidor: o pong chega a cada 30 s, então silêncio longo é conexão morta. */
  silencio(): number {
    return Date.now() - this.ultimaMensagem;
  }

  /** Abre uma conexão nova agora. A anterior, se houver, é abandonada: os eventos dela não chegam mais a ninguém. */
  conectar() {
    this.cancelarEspera();
    this.abandonar();
    const ws = new WebSocket(this.endereco());
    this.ws = ws;
    let fila = Promise.resolve();
    ws.onopen = () => {
      this.ultimaMensagem = Date.now();
      this.eventos.aoAbrir();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.eventos.aoFechar();
    };
    ws.onmessage = (evento) => {
      if (this.ws !== ws) return; // uma conexão antiga, já abandonada
      this.ultimaMensagem = Date.now();
      const msg = lerMensagem(String(evento.data));
      if (!msg) {
        console.error('Mensagem inválida do servidor', evento.data);
        return;
      }
      fila = fila.then(() => this.eventos.aoReceber(msg)).catch((erro) => console.error('Erro ao tratar', msg, erro));
    };
  }

  enviar(msg: MensagemParaOServidor) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** A conexão caiu (ou está muda): fecha o que sobrou dela e tenta de novo depois, esperando mais a cada vez. */
  tentarDeNovo() {
    this.abandonar();
    if (this.reconexao) return;
    const espera = ESPERAS_PARA_RECONECTAR[Math.min(this.tentativas, ESPERAS_PARA_RECONECTAR.length - 1)];
    this.tentativas++;
    this.reconexao = setTimeout(() => {
      this.reconexao = null;
      this.conectar();
    }, espera);
  }

  /** Tenta agora, sem esperar a próxima tentativa (botão "Tentar agora", internet de volta). */
  reconectarAgora() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return; // já está tentando
    this.conectar();
  }

  /** Conseguiu voltar (ou caiu pela primeira vez): a próxima espera recomeça de 1 s. */
  zerarEsperas() {
    this.tentativas = 0;
  }

  /** Fecha de vez, sem avisar ninguém nem tentar de novo (saí da sala). */
  encerrar() {
    this.cancelarEspera();
    this.abandonar();
  }

  private cancelarEspera() {
    if (this.reconexao) clearTimeout(this.reconexao);
    this.reconexao = null;
  }

  private abandonar() {
    const antiga = this.ws;
    this.ws = null;
    if (!antiga) return;
    antiga.onopen = null;
    antiga.onclose = null;
    antiga.onmessage = null;
    antiga.close();
  }
}
