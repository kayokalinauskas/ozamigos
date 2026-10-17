// A troca de imagens do chat: direto entre os PCs, por um segundo canal de dados na conexão de voz (voz.ts).
// O servidor não vê nem guarda nenhuma imagem. Quem não tem a conexão de voz com alguém (rede sem TURN) não troca
// imagens com essa pessoa, e quem manda fica sabendo ("não chegou para Fulano").
import { lerControle, pedacos, Recepcao, type Chegada, type Controle } from './protocolo';

/** O que a troca precisa do cliente, sem importá-lo (o cliente importa a voz, que importa a troca). */
export type LigacaoDasImagens = {
  chegou(de: string, evento: Chegada): void;
  /** Quantos bytes por segundo as imagens podem usar agora (Infinity: sem freio). */
  ritmo(): number;
};

export type ImagemParaEnviar = { id: string; bytes: Uint8Array; largura: number; altura: number; miniatura: string };

/** Quem recebe responde "recebi" quando confere a imagem inteira. Sem resposta nesse prazo, não chegou. */
const ESPERA_DA_CONFIRMACAO = 20_000;
// O canal guarda até FILA_CHEIA bytes esperando a rede; abaixo de FILA_BAIXA, volta a encher. Sem isso, o navegador
// guardaria a imagem inteira de uma vez para cada pessoa, sem avisar.
const FILA_CHEIA = 1024 * 1024;
const FILA_BAIXA = 256 * 1024;
/**
 * Quem não diz "olá" nesse prazo depois de o canal abrir está com a página de antes das imagens aberta: o canal
 * dela não existe, e o que se mandasse ficaria sem resposta até o prazo da confirmação (medido: a conexão de voz
 * continua de pé, os dados só se perdem).
 */
const ESPERA_DO_OLA = 5_000;
/**
 * A conexão de voz ainda não existe ou está abrindo (a pessoa acabou de entrar, ou todos voltando depois de um deploy):
 * a imagem espera até esse prazo, em vez de dar "não chegou" na hora.
 */
const ESPERA_DO_CANAL = 15_000;
/** O maior pedaço: 64 KB passa em qualquer navegador de hoje; se a conexão disser menos, vale o dela. */
const PEDACO_MAXIMO = 64 * 1024;

type Pessoa = {
  canal: RTCDataChannel;
  maximoDaConexao: () => number | undefined;
  recepcao: Recepcao;
  ola: Promise<boolean>; // a página do outro lado troca imagens
  ouviuOla: (sim: boolean) => void;
  fila: Promise<unknown>; // uma imagem de cada vez para cada pessoa (os pedaços nunca se misturam)
  confirmacoes: Map<string, (motivo: string | null) => void>;
};

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

class TrocaDeImagens {
  private readonly pessoas = new Map<string, Pessoa>();
  private readonly esperas = new Map<string, Set<() => void>>(); // imagens esperando a conexão de voz com a pessoa existir
  private ligacao: LigacaoDasImagens | null = null;
  // O freio de quando estou transmitindo: um balde de fichas dividido entre todas as pessoas.
  private fichas = 0;
  private ultimaFicha = 0;

  constructor() {
    // Uma imagem parada no meio (a conexão travou sem cair) vence sozinha.
    setInterval(() => {
      for (const [id, p] of this.pessoas) {
        const vencida = p.recepcao.vencer(Date.now());
        if (vencida) this.tratar(id, p, vencida);
      }
    }, 5_000);
  }

  ligar(ligacao: LigacaoDasImagens) {
    this.ligacao = ligacao;
  }

  /** Uma conexão de voz nova com a pessoa (voz.ts): o canal de imagens dela. */
  conectar(id: string, canal: RTCDataChannel, maximoDaConexao: () => number | undefined) {
    this.desconectar(id);
    canal.binaryType = 'arraybuffer';
    canal.bufferedAmountLowThreshold = FILA_BAIXA;
    let ouviuOla!: (sim: boolean) => void;
    const ola = new Promise<boolean>((r) => (ouviuOla = r));
    const p: Pessoa = { canal, maximoDaConexao, recepcao: new Recepcao(), ola, ouviuOla, fila: Promise.resolve(), confirmacoes: new Map() };
    this.pessoas.set(id, p);
    this.esperas.get(id)?.forEach((responder) => responder());
    const anunciar = () => {
      try {
        this.mandar(canal, { t: 'ola', id: '' });
      } catch {
        // fechou no meio: desconectar cuida
      }
      setTimeout(() => ouviuOla(false), ESPERA_DO_OLA);
    };
    if (canal.readyState === 'open') anunciar();
    else canal.addEventListener('open', anunciar, { once: true });
    canal.onmessage = (e: MessageEvent<string | ArrayBuffer>) => this.receber(id, p, e.data);
    canal.onclose = () => {
      if (this.pessoas.get(id) === p) this.desconectar(id);
    };
  }

  /** A conexão de voz com a pessoa fechou: o que ia e o que vinha não chega mais. */
  desconectar(id: string) {
    const p = this.pessoas.get(id);
    if (!p) return;
    this.pessoas.delete(id);
    p.ouviuOla(false);
    p.confirmacoes.forEach((responder) => responder('a conexão caiu'));
    const interrompida = p.recepcao.encerrar();
    if (interrompida) this.ligacao?.chegou(id, interrompida);
  }

  /** Manda a imagem para a pessoa, na fila dela. Resolve com null quando ela confirma, ou com o motivo de não ter chegado. */
  async enviar(id: string, imagem: ImagemParaEnviar): Promise<string | null> {
    const p = this.pessoas.get(id) ?? (await this.esperarConexao(id));
    if (!p || p.canal.readyState === 'closing' || p.canal.readyState === 'closed') return 'sem conexão de voz';
    const resultado = p.fila.then(() => this.enviarAgora(p, imagem));
    p.fila = resultado.catch(() => undefined);
    return resultado;
  }

  /** A pessoa acabou de entrar e a conexão de voz com ela ainda não existe (quem chega liga): espera ela aparecer. */
  private esperarConexao(id: string): Promise<Pessoa | undefined> {
    return new Promise((resolver) => {
      const esperas = this.esperas.get(id) ?? new Set();
      const responder = () => {
        clearTimeout(prazo);
        esperas.delete(responder);
        if (esperas.size === 0 && this.esperas.get(id) === esperas) this.esperas.delete(id);
        resolver(this.pessoas.get(id));
      };
      const prazo = setTimeout(responder, ESPERA_DO_CANAL);
      esperas.add(responder);
      this.esperas.set(id, esperas);
    });
  }

  private async enviarAgora(p: Pessoa, imagem: ImagemParaEnviar): Promise<string | null> {
    if (!(await this.aberto(p.canal))) return 'sem conexão de voz';
    if (!(await p.ola)) return 'a página precisa ser recarregada (é de antes das imagens)';
    const { canal } = p;
    let responder!: (motivo: string | null) => void;
    const confirmacao = new Promise<string | null>((r) => (responder = r)); // vale a primeira resposta
    p.confirmacoes.set(imagem.id, responder); // "recebi", "recusei", ou a conexão caindo (desconectar)
    let prazo: ReturnType<typeof setTimeout> | undefined;
    try {
      const { id, largura, altura, bytes, miniatura } = imagem;
      this.mandar(canal, { t: 'inicio', id, largura, altura, bytes: bytes.length, miniatura });
      const tamanho = Math.min(PEDACO_MAXIMO, p.maximoDaConexao() || PEDACO_MAXIMO);
      for (const parte of pedacos(bytes, tamanho)) {
        await this.esperarFila(canal);
        await this.esperarRitmo(parte.length);
        canal.send(parte as Uint8Array<ArrayBuffer>); // com o canal fechado, lança
      }
      this.mandar(canal, { t: 'fim', id });
      prazo = setTimeout(() => responder('não confirmou o recebimento'), ESPERA_DA_CONFIRMACAO);
    } catch {
      responder('a conexão caiu');
    }
    const motivo = await confirmacao;
    clearTimeout(prazo);
    p.confirmacoes.delete(imagem.id);
    return motivo;
  }

  /** Resolve com true quando o canal está aberto; false se ele fechar ou não abrir no prazo. */
  private aberto(canal: RTCDataChannel): Promise<boolean> {
    if (canal.readyState !== 'connecting') return Promise.resolve(canal.readyState === 'open');
    return new Promise((resolver) => {
      const responder = () => {
        clearTimeout(prazo);
        canal.removeEventListener('open', responder);
        canal.removeEventListener('close', responder);
        resolver(canal.readyState === 'open');
      };
      const prazo = setTimeout(responder, ESPERA_DO_CANAL);
      canal.addEventListener('open', responder);
      canal.addEventListener('close', responder);
    });
  }

  private mandar(canal: RTCDataChannel, msg: Controle) {
    canal.send(JSON.stringify(msg));
  }

  private async esperarFila(canal: RTCDataChannel) {
    while (canal.readyState === 'open' && canal.bufferedAmount > FILA_CHEIA) {
      await new Promise<void>((pronto) => {
        const seguir = () => {
          canal.removeEventListener('bufferedamountlow', seguir);
          canal.removeEventListener('close', seguir);
          pronto();
        };
        canal.addEventListener('bufferedamountlow', seguir);
        canal.addEventListener('close', seguir);
      });
    }
  }

  /** Com o freio ligado (transmitindo), espera ter fichas para mais `bytes`; rajadas de até 1/4 de segundo. */
  private async esperarRitmo(bytes: number) {
    for (;;) {
      const ritmo = this.ligacao?.ritmo() ?? Infinity;
      if (!Number.isFinite(ritmo)) return;
      const agora = performance.now();
      const capacidade = Math.max(bytes, ritmo / 4);
      this.fichas = Math.min(capacidade, this.fichas + ((agora - this.ultimaFicha) / 1000) * ritmo);
      this.ultimaFicha = agora;
      if (this.fichas >= bytes) {
        this.fichas -= bytes;
        return;
      }
      await esperar(Math.ceil(((bytes - this.fichas) / ritmo) * 1000));
    }
  }

  private receber(id: string, p: Pessoa, dados: string | ArrayBuffer) {
    if (typeof dados !== 'string') {
      const evento = p.recepcao.pedaco(dados);
      if (evento) this.tratar(id, p, evento);
      return;
    }
    const msg = lerControle(dados);
    if (!msg) return;
    if (msg.t === 'ola') p.ouviuOla(true);
    else if (msg.t === 'recebi') p.confirmacoes.get(msg.id)?.(null);
    else if (msg.t === 'recusei') p.confirmacoes.get(msg.id)?.(String(msg.motivo ?? 'recusada'));
    else for (const evento of p.recepcao.controle(msg, Date.now())) this.tratar(id, p, evento);
  }

  private tratar(id: string, p: Pessoa, evento: Chegada) {
    try {
      if (evento.tipo === 'chegou') this.mandar(p.canal, { t: 'recebi', id: evento.id });
      else if (evento.tipo === 'falhou' && evento.responder) this.mandar(p.canal, { t: 'recusei', id: evento.id, motivo: evento.motivo });
    } catch {
      // o canal fechou: quem mandou fica sabendo pelo prazo da confirmação
    }
    this.ligacao?.chegou(id, evento);
  }
}

export const trocaDeImagens = new TrocaDeImagens();
