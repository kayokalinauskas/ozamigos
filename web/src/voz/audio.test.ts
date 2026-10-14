// Regressão do áudio: o processador real do microfone (RNNoise + porta + antecipação) e o limitador da saída,
// com sons sintéticos (sem gravação de voz no repositório).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { curvaDoLimitador } from './limitador';

const TAXA = 48_000;
const BLOCO = 128; // o tamanho do bloco do AudioWorklet

// O processador roda numa thread de áudio; aqui ele recebe o mínimo dessa thread para rodar no Node.
type Processador = { process(entradas: Float32Array[][], saidas: Float32Array[][]): boolean };
let Classe: new (opcoes: unknown) => Processador;
let rnnoise: ArrayBuffer;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.AudioWorkletProcessor = class {
    port = { postMessage() {}, onmessage: null };
  };
  g.registerProcessor = (_nome: string, c: typeof Classe) => (Classe = c);
  await import('./processador');
  const binario = readFileSync(createRequire(import.meta.url).resolve('@sapphi-red/web-noise-suppressor/rnnoise.wasm'));
  rnnoise = new ArrayBuffer(binario.byteLength);
  new Uint8Array(rnnoise).set(binario);
});

/** Passa o sinal pelo processador, em blocos de 128 como no navegador. */
function processar(sinal: Float32Array): Float32Array {
  const p = new Classe({ processorOptions: { rnnoise } });
  const saida = new Float32Array(sinal.length);
  for (let i = 0; i + BLOCO <= sinal.length; i += BLOCO) {
    const s = new Float32Array(BLOCO);
    p.process([[sinal.subarray(i, i + BLOCO)]], [[s]]);
    saida.set(s, i);
  }
  return saida;
}

let semente = 1;
const aleatorio = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

/** Ruído leve de sala (cerca de -60 dB). */
function sala(segundos: number): Float32Array {
  const s = new Float32Array(Math.round(segundos * TAXA));
  for (let i = 0; i < s.length; i++) s[i] = aleatorio() * 0.002;
  return s;
}

/** Filtro passa-faixa (biquad) em torno de `freq`. */
function passaFaixa(freq: number, q: number) {
  const w = (2 * Math.PI * freq) / TAXA;
  const alfa = Math.sin(w) / (2 * q);
  const a0 = 1 + alfa;
  const [b0, b2, a1, a2] = [alfa / a0, -alfa / a0, (-2 * Math.cos(w)) / a0, (1 - alfa) / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, x, y1, y];
    return y;
  };
}

/** Um "s": ruído com a energia entre 4 e 8 kHz (como o chiado de verdade, que o RNNoise deixa passar), subindo em 20 ms. */
function chiado(inicio: number, ms: number, sinal: Float32Array) {
  const n = (ms / 1000) * TAXA;
  const [f1, f2] = [passaFaixa(5500, 1.2), passaFaixa(5500, 1.2)];
  for (let i = 0; i < n; i++) sinal[inicio + i] += f2(f1(aleatorio())) * 0.08 * Math.min(1, i / (0.02 * TAXA));
}

/** Uma vogal "a": pulsos da voz a 120 Hz passando por três formantes (700, 1220, 2600 Hz). */
function vogal(inicio: number, ms: number, sinal: Float32Array) {
  const n = (ms / 1000) * TAXA;
  const formantes = [700, 1220, 2600].map((f) => {
    const r = Math.exp((-Math.PI * 100) / TAXA);
    return { a1: 2 * r * Math.cos((2 * Math.PI * f) / TAXA), a2: -r * r, y1: 0, y2: 0 };
  });
  for (let i = 0; i < n; i++) {
    let x = i % Math.round(TAXA / 120) === 0 ? 1 : 0;
    let soma = 0;
    for (const f of formantes) {
      const y = x + f.a1 * f.y1 + f.a2 * f.y2;
      f.y2 = f.y1;
      f.y1 = y;
      soma += y;
    }
    x = soma;
    sinal[inicio + i] += x * 0.004 * Math.min(1, i / (0.01 * TAXA));
  }
}

const energia = (s: Float32Array, de: number, ate: number) => {
  let e = 0;
  for (let i = de; i < ate; i++) e += s[i] * s[i];
  return e;
};

/** A saída sai atrasada: 10 ms da fila mais 30 ms da antecipação. */
const ATRASO = 0.04 * TAXA;

describe('áudio do microfone', () => {
  it('não corta o começo das palavras que abrem com chiado ("sim", "só")', () => {
    const sinal = sala(3);
    const comeco = 1.5 * TAXA;
    chiado(comeco, 150, sinal);
    vogal(comeco + 0.15 * TAXA, 400, sinal);

    const saida = processar(sinal);

    const chiadoNaEntrada = energia(sinal, comeco + 0.02 * TAXA, comeco + 0.12 * TAXA);
    const chiadoNaSaida = energia(saida, comeco + ATRASO + 0.02 * TAXA, comeco + ATRASO + 0.12 * TAXA);
    expect(chiadoNaSaida / chiadoNaEntrada).toBeGreaterThan(0.5);
  });

  it('com só o ruído da sala, a porta fica fechada', () => {
    const saida = processar(sala(3));
    const depoisDeAcomodar = energia(saida, TAXA, 3 * TAXA - BLOCO);
    expect(depoisDeAcomodar).toBeLessThan(energia(sala(2), 0, 2 * TAXA) * 0.05);
  });

  it('cliques de teclado sem fala quase não passam', () => {
    const sinal = sala(4);
    for (let t = Math.round(0.5 * TAXA); t < 3.8 * TAXA; t += Math.round(0.12 * TAXA)) {
      for (let i = 0; i < 400; i++) sinal[t + i] += 0.3 * Math.exp(-i / 60) * aleatorio(); // 1–2 ms de estalo
    }
    const saida = processar(sinal);
    expect(energia(saida, 0, saida.length) / energia(sinal, 0, sinal.length)).toBeLessThan(0.3);
  });
});

describe('limitador da saída', () => {
  const curva = curvaDoLimitador();
  const aplicar = (x: number) => curva[Math.round(((x + 2) / 4) * (curva.length - 1))];

  it('não mexe no som normal e nunca passa do máximo', () => {
    expect(aplicar(0.5)).toBeCloseTo(0.5, 3);
    expect(aplicar(-0.8)).toBeCloseTo(-0.8, 3);
    expect(Math.max(...curva.map(Math.abs))).toBeLessThanOrEqual(1);
    for (let i = 1; i < curva.length; i++) expect(curva[i]).toBeGreaterThanOrEqual(curva[i - 1]); // sem dobras
  });
});
