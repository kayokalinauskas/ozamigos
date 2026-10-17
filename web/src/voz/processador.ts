// O processador de áudio do microfone, numa thread de áudio (AudioWorklet), em quadros de 10 ms:
// volume de entrada → RNNoise (tira o ruído e diz a chance de ser voz) → porta (abre só com fala).
// Manda para a página, 20 vezes por segundo, o volume e se a porta está aberta (medidor e anel de quem fala).
import { ANTECIPAR, Porta, QUADRO, nivelEmDb, picoNoQuadro, type AjustesDaPorta } from './porta';

declare function registerProcessor(nome: string, classe: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(opcoes?: unknown);
}

// semPorta: apertar para falar. Quem decide quando a voz vai é a tecla, não a porta (o começo da fala não é cortado).
export type AjustesDoProcessador = AjustesDaPorta & { ganho: number; tirarRuido: boolean; semPorta: boolean };
export type MedidaDoProcessador = { nivelDb: number; aberta: boolean; rnnoise: boolean };

type Rnnoise = { processar(quadro: Float32Array): number };

/**
 * O RNNoise compilado para WebAssembly (o binário de @sapphi-red/web-noise-suppressor), sem o código de cola do
 * Emscripten: ele só pede três funções. O quadro entra e sai na escala de 16 bits, que é a que o RNNoise espera.
 */
function carregarRnnoise(binario: ArrayBuffer): Rnnoise {
  let memoria: WebAssembly.Memory;
  const env = {
    emscripten_memcpy_big: (destino: number, origem: number, n: number) => void new Uint8Array(memoria.buffer).copyWithin(destino, origem, origem + n),
    emscripten_resize_heap: (tamanho: number) => {
      try {
        memoria.grow(Math.ceil((tamanho - memoria.buffer.byteLength) / 65536));
        return 1;
      } catch {
        return 0;
      }
    },
    __assert_fail: () => {
      throw new Error('RNNoise: assert');
    },
  };
  const x = new WebAssembly.Instance(new WebAssembly.Module(binario), { env }).exports as Record<string, any>;
  memoria = x.memory;
  x.emscripten_stack_init();
  x.__wasm_call_ctors();
  const estado = x.rnnoise_create(0);
  const entrada = x.malloc(QUADRO * 4) / 4;
  const saida = x.malloc(QUADRO * 4) / 4;
  return {
    processar(quadro) {
      let heap = new Float32Array(memoria.buffer);
      for (let i = 0; i < QUADRO; i++) heap[entrada + i] = quadro[i] * 32768;
      const chanceDeVoz = x.rnnoise_process_frame(estado, saida * 4, entrada * 4);
      heap = new Float32Array(memoria.buffer); // a memória pode ter crescido
      for (let i = 0; i < QUADRO; i++) quadro[i] = heap[saida + i] / 32768;
      return chanceDeVoz;
    },
  };
}

// Abre em ~3 ms (não come o começo da fala) e fecha em ~30 ms (sem estalo).
const ABRIR = 1 - Math.exp(-1 / (0.003 * 48_000));
const FECHAR = 1 - Math.exp(-1 / (0.03 * 48_000));
const TAMANHO_DA_FILA = 4096;

class ProcessadorDeVoz extends AudioWorkletProcessor {
  private rnnoise: Rnnoise | null = null;
  private readonly porta = new Porta();
  private ajustes: AjustesDoProcessador = { ganho: 1, tirarRuido: true, automatica: true, limiarDb: -50, semPorta: false };
  private readonly quadro = new Float32Array(QUADRO);
  private noQuadro = 0;
  // Fila de saída: começa com um quadro de silêncio, para nunca faltar amostra (10 ms de atraso, fixo).
  private readonly fila = new Float32Array(TAMANHO_DA_FILA);
  // Os últimos quadros e o que a porta decidiu em cada um: sai o mais antigo, aberto se a porta abriu nele ou depois
  // (+30 ms de atraso, para o começo sem voz das palavras passar; ver ANTECIPAR em porta.ts).
  private readonly guardados = Array.from({ length: ANTECIPAR + 1 }, () => new Float32Array(QUADRO));
  private readonly decisoes: boolean[] = new Array(ANTECIPAR + 1).fill(false);
  private vez = 0;
  private ler = 0;
  private escrever = QUADRO;
  private abertura = 0;
  private quadrosDesdeAMedida = 0;
  private maiorNivel = -100;

  constructor(opcoes: { processorOptions?: { rnnoise?: ArrayBuffer | null } }) {
    super();
    const binario = opcoes.processorOptions?.rnnoise;
    if (binario) {
      try {
        this.rnnoise = carregarRnnoise(binario);
      } catch (erro) {
        console.error('O RNNoise não carregou; a voz segue sem ele', erro);
      }
    }
    this.port.onmessage = (e: MessageEvent<AjustesDoProcessador>) => (this.ajustes = e.data);
  }

  process(entradas: Float32Array[][], saidas: Float32Array[][]): boolean {
    const entrada = entradas[0]?.[0];
    const saida = saidas[0][0];
    for (let i = 0; i < saida.length; i++) {
      this.quadro[this.noQuadro++] = entrada ? entrada[i] * this.ajustes.ganho : 0;
      if (this.noQuadro === QUADRO) {
        this.processarQuadro();
        this.noQuadro = 0;
      }
    }
    for (let i = 0; i < saida.length; i++) {
      saida[i] = this.fila[this.ler];
      this.ler = (this.ler + 1) % TAMANHO_DA_FILA;
    }
    return true;
  }

  private processarQuadro() {
    const q = this.quadro;
    let chanceDeVoz: number | null = null;
    if (this.rnnoise) {
      if (this.ajustes.tirarRuido) {
        chanceDeVoz = this.rnnoise.processar(q);
      } else {
        // Sem tirar o ruído, o RNNoise ainda diz se é voz (para a sensibilidade automática), numa cópia.
        const copia = q.slice();
        chanceDeVoz = this.rnnoise.processar(copia);
      }
    }
    const nivelDb = nivelEmDb(q);
    const decidida = this.porta.decidir(nivelDb, chanceDeVoz, this.ajustes, picoNoQuadro(q)); // a porta segue aprendendo o ambiente
    const aberta = this.ajustes.semPorta || decidida;
    this.guardados[this.vez].set(q);
    this.decisoes[this.vez] = aberta;
    this.vez = (this.vez + 1) % (ANTECIPAR + 1);
    const saindo = this.guardados[this.vez];
    const abrir = this.decisoes.includes(true);
    const alvo = abrir ? 1 : 0;
    const passo = abrir ? ABRIR : FECHAR;
    for (let i = 0; i < QUADRO; i++) {
      this.abertura += (alvo - this.abertura) * passo;
      this.fila[this.escrever] = saindo[i] * this.abertura;
      this.escrever = (this.escrever + 1) % TAMANHO_DA_FILA;
    }
    this.maiorNivel = Math.max(this.maiorNivel, nivelDb);
    if (++this.quadrosDesdeAMedida === 5) {
      const medida: MedidaDoProcessador = { nivelDb: this.maiorNivel, aberta, rnnoise: this.rnnoise !== null };
      this.port.postMessage(medida);
      this.quadrosDesdeAMedida = 0;
      this.maiorNivel = -100;
    }
  }
}

registerProcessor('ozamigos-voz', ProcessadorDeVoz);
