import { lembrado, lembrar } from './armazenamento';

// Sons curtos de aviso, gerados na hora (sem arquivos de áudio).
const NOTAS = {
  entrou: [660, 880],
  saiu: [660, 440],
  aoVivo: [523, 659, 784],
} as const;

export type Som = keyof typeof NOTAS;

let contexto: AudioContext | null = null;

export function sonsLigados(): boolean {
  return lembrado('ozamigos-sons') !== 'nao';
}

export function ligarSons(ligar: boolean): void {
  lembrar('ozamigos-sons', ligar ? '' : 'nao');
}

export function tocar(som: Som): void {
  if (!sonsLigados()) return;
  try {
    contexto ??= new AudioContext();
    const agora = contexto.currentTime;
    NOTAS[som].forEach((frequencia, i) => {
      const oscilador = contexto!.createOscillator();
      const ganho = contexto!.createGain();
      oscilador.type = 'sine';
      oscilador.frequency.value = frequencia;
      const inicio = agora + i * 0.09;
      ganho.gain.setValueAtTime(0, inicio);
      ganho.gain.linearRampToValueAtTime(0.08, inicio + 0.01);
      ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.16);
      oscilador.connect(ganho).connect(contexto!.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + 0.18);
    });
  } catch {
    // sem áudio disponível: segue em silêncio
  }
}
