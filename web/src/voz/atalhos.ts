// Os atalhos de voz: ligar e desligar o microfone, ligar e desligar o som, e apertar para falar.
// No app (1.2.17 em diante), valem com o jogo na frente: o auxiliar do app lê as teclas do Windows (Atalhos.cs) e
// avisa a página. No navegador (e no app antigo), só com a página em foco.
import { lembrado, lembrar } from '../armazenamento';
import { ponte } from '../ponte';

export type NomeDoAtalho = 'mudo' | 'surdo' | 'falar';

/**
 * As teclas, como o navegador as chama: os modificadores ('Control', 'Shift', 'Alt', sem lado), o `code` das outras
 * ('KeyM', 'F5', 'Numpad0'), e os botões do mouse ('Mouse3' o do meio, 'Mouse4' e 'Mouse5' os laterais).
 * O nome é o que aparece na tela ("Ctrl + Shift + M"), anotado na hora de gravar, com o teclado da pessoa.
 */
export type Atalho = { teclas: string[]; nome: string };

export type AjustesDosAtalhos = Record<NomeDoAtalho, Atalho>;

export const ATALHOS_PADRAO: AjustesDosAtalhos = {
  mudo: { teclas: ['Control', 'Shift', 'KeyM'], nome: 'Ctrl + Shift + M' },
  surdo: { teclas: ['Control', 'Shift', 'KeyD'], nome: 'Ctrl + Shift + D' },
  falar: { teclas: [], nome: '' },
};

export const MAXIMO_DE_TECLAS = 4;
const CHAVE = 'ozamigos-atalhos';
const MODIFICADORES: Record<string, string> = {
  ControlLeft: 'Control',
  ControlRight: 'Control',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  AltLeft: 'Alt',
  AltRight: 'Alt',
};
export const NOME_DO_MODIFICADOR: Record<string, string> = { Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt' };
export const ehModificador = (tecla: string) => tecla in NOME_DO_MODIFICADOR;
/** Os botões do mouse que podem virar atalho (o esquerdo e o direito não: são para clicar). */
export const BOTOES_DO_MOUSE: Record<number, { tecla: string; nome: string }> = {
  1: { tecla: 'Mouse3', nome: 'Botão do meio' },
  3: { tecla: 'Mouse4', nome: 'Mouse 4' },
  4: { tecla: 'Mouse5', nome: 'Mouse 5' },
};

// As teclas virtuais do Windows (VK_*), que o auxiliar do app pergunta ao Windows. As de símbolo (OEM) são as de um
// teclado ABNT2/US; num leiaute muito diferente, uma delas pode não bater, e a pessoa escolhe outra.
const FIXAS: Record<string, number> = {
  Control: 0x11,
  Shift: 0x10,
  Alt: 0x12,
  Mouse3: 0x04,
  Mouse4: 0x05,
  Mouse5: 0x06,
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  Pause: 0x13,
  CapsLock: 0x14,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e,
  NumpadDivide: 0x6f,
  NumpadEnter: 0x0d,
  ScrollLock: 0x91,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  IntlRo: 0xc1,
  NumpadComma: 0xc2,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
  IntlBackslash: 0xe2,
};

/** A tecla virtual do Windows, ou null se o app não souber ler essa tecla. */
export function teclaVirtual(tecla: string): number | null {
  if (tecla in FIXAS) return FIXAS[tecla];
  let m = /^Key([A-Z])$/.exec(tecla);
  if (m) return m[1].charCodeAt(0);
  m = /^Digit([0-9])$/.exec(tecla);
  if (m) return 0x30 + Number(m[1]);
  m = /^Numpad([0-9])$/.exec(tecla);
  if (m) return 0x60 + Number(m[1]);
  m = /^F([0-9]{1,2})$/.exec(tecla);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return 0x6f + Number(m[1]);
  return null;
}

/** A tecla como o navegador a chama, sem o lado dos modificadores. */
export const teclaDoEvento = (codigo: string) => MODIFICADORES[codigo] ?? codigo;

function valido(atalho: unknown): atalho is Atalho {
  if (!atalho || typeof atalho !== 'object') return false;
  const { teclas, nome } = atalho as Atalho;
  return (
    Array.isArray(teclas) &&
    teclas.length <= MAXIMO_DE_TECLAS &&
    teclas.every((t) => typeof t === 'string' && teclaVirtual(t) !== null) &&
    typeof nome === 'string' &&
    nome.length <= 60
  );
}

/** O que foi guardado; o que faltar ou vier estranho volta para o padrão. */
export function lerAtalhos(): AjustesDosAtalhos {
  let salvo: Record<string, unknown> = {};
  try {
    salvo = JSON.parse(lembrado(CHAVE) || '{}');
  } catch {
    // guardado de um jeito que não dá para ler: fica o padrão
  }
  const lidos = { ...ATALHOS_PADRAO };
  for (const nome of Object.keys(ATALHOS_PADRAO) as NomeDoAtalho[]) {
    if (valido(salvo[nome])) lidos[nome] = salvo[nome];
  }
  return lidos;
}

type Ouvinte = (qual: NomeDoAtalho, apertado: boolean) => void;

/**
 * Quem está apertado, e quando cada atalho fica completo (todas as suas teclas apertadas). Mudo e som desligado trocam
 * ao completar; apertar para falar conta também quando solta. O mesmo jeito do auxiliar do app.
 */
export class LeitorDeAtalhos {
  private readonly apertadas = new Set<string>();
  private readonly completos = new Set<NomeDoAtalho>();

  constructor(
    private atalhos: AjustesDosAtalhos,
    private readonly ouvinte: Ouvinte,
  ) {}

  definir(atalhos: AjustesDosAtalhos) {
    this.atalhos = atalhos;
    this.conferir();
  }

  apertou(tecla: string) {
    this.apertadas.add(tecla);
    this.conferir();
  }

  soltou(tecla: string) {
    this.apertadas.delete(tecla);
    this.conferir();
  }

  /** A página perdeu o foco: o navegador não conta o que for solto lá fora. */
  soltarTudo() {
    this.apertadas.clear();
    this.conferir();
  }

  private conferir() {
    for (const nome of Object.keys(this.atalhos) as NomeDoAtalho[]) {
      const { teclas } = this.atalhos[nome];
      const completo = teclas.length > 0 && teclas.every((t) => this.apertadas.has(t));
      if (completo === this.completos.has(nome)) continue;
      if (completo) this.completos.add(nome);
      else this.completos.delete(nome);
      if (completo || nome === 'falar') this.ouvinte(nome, completo);
    }
  }
}

/** Um campo de texto em foco: uma tecla sozinha (sem Ctrl nem Alt) é do texto, não do atalho. */
function digitando(atalho: Atalho): boolean {
  const alvo = document.activeElement;
  const campo = alvo instanceof HTMLTextAreaElement || (alvo instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button'].includes(alvo.type));
  return campo && document.hasFocus() && !atalho.teclas.some((t) => t === 'Control' || t === 'Alt' || t.startsWith('Mouse'));
}

class Atalhos {
  private ajustes = lerAtalhos();
  private ouvinte: Ouvinte = () => undefined;
  private pausados = false; // gravando um atalho novo na engrenagem
  private leitor: LeitorDeAtalhos | null = null;
  private readonly ouvintesDoEstado = new Set<() => void>();
  /** true: valem com o jogo na frente (o app tem o auxiliar). null: ainda não sei. */
  globais: boolean | null = ponte?.atalhos ? null : false;

  ler = () => this.ajustes;

  inscrever = (ouvinte: () => void) => {
    this.ouvintesDoEstado.add(ouvinte);
    return () => this.ouvintesDoEstado.delete(ouvinte);
  };

  private avisarEstado() {
    this.ouvintesDoEstado.forEach((o) => o());
  }

  /** Começa a ouvir: pelo app (com o jogo na frente) ou pela página. */
  ligar(ouvinte: Ouvinte) {
    this.ouvinte = ouvinte;
    const avisar: Ouvinte = (qual, apertado) => {
      if (this.pausados) return;
      if (apertado && digitando(this.ajustes[qual])) return;
      this.ouvinte(qual, apertado);
    };
    if (ponte?.atalhos) {
      ponte.atalhos.aoApertar((evento) => {
        if (evento === 'mudo' || evento === 'surdo') avisar(evento, true);
        else if (evento === 'falar 1' || evento === 'falar 0') avisar('falar', evento === 'falar 1');
      });
      this.mandarParaOApp();
      return;
    }
    const leitor = new LeitorDeAtalhos(this.ajustes, avisar);
    this.leitor = leitor;
    const usado = (tecla: string) => Object.values(this.ajustes).some((a) => a.teclas.includes(tecla));
    addEventListener('keydown', (e) => !e.repeat && leitor.apertou(teclaDoEvento(e.code)), true);
    addEventListener('keyup', (e) => leitor.soltou(teclaDoEvento(e.code)), true);
    addEventListener('mousedown', (e) => {
      const botao = BOTOES_DO_MOUSE[e.button];
      if (!botao) return;
      if (usado(botao.tecla) && !this.pausados) e.preventDefault(); // o do meio rolaria a página
      leitor.apertou(botao.tecla);
    }, true);
    addEventListener('mouseup', (e) => {
      const botao = BOTOES_DO_MOUSE[e.button];
      if (!botao) return;
      if (usado(botao.tecla) && !this.pausados) e.preventDefault(); // os laterais voltariam a página
      leitor.soltou(botao.tecla);
    }, true);
    addEventListener('blur', () => leitor.soltarTudo());
  }

  definir(nome: NomeDoAtalho, atalho: Atalho) {
    this.ajustes = { ...this.ajustes, [nome]: atalho };
    lembrar(CHAVE, JSON.stringify(this.ajustes));
    this.leitor?.definir(this.ajustes);
    this.mandarParaOApp();
    this.avisarEstado();
  }

  /** Enquanto a pessoa grava um atalho novo, os atalhos não disparam (ela pode apertar o atual). */
  pausar(pausados: boolean) {
    this.pausados = pausados;
    if (!pausados) this.mandarParaOApp();
  }

  private mandarParaOApp() {
    if (!ponte?.atalhos) return;
    const teclas = Object.fromEntries(
      Object.entries(this.ajustes).map(([nome, atalho]) => [nome, atalho.teclas.map(teclaVirtual).filter((t): t is number => t !== null)]),
    ) as Record<NomeDoAtalho, number[]>;
    void ponte.atalhos.definir(teclas).then(
      (globais) => {
        if (globais !== this.globais) {
          this.globais = globais;
          this.avisarEstado();
        }
      },
      () => undefined,
    );
  }
}

export const atalhos = new Atalhos();
