import { lembrado, lembrar } from './armazenamento';

// Sons curtos de aviso, gerados na hora (sem arquivos de áudio).
const NOTAS = {
  entrou: [660, 880],
  saiu: [660, 440],
  aoVivo: [523, 659, 784],
  mensagem: [880, 1175], // uma mensagem nova no chat, com o painel fechado ou a janela atrás do jogo
  // Microfone e fone, como no Discord: descendo ao desligar, subindo ao ligar.
  mudo: [587, 440],
  desmudo: [440, 587],
  surdo: [494, 330],
  dessurdo: [330, 494],
  // Alguém chamou a sua atenção: duas batidas e uma nota mais alta, para ser ouvido (veja FORTE).
  chamado: [784, 988, 784, 988, 1175],
} as const;

export type Som = keyof typeof NOTAS;

/**
 * Como cada som toca. Os de aviso são discretos (seno a 0,08, notas encavaladas). O chamado precisa ser ouvido por quem
 * está com o som do Ozamigos desligado, talvez com o jogo alto (pedido do dono, 18/10/2026: "bem mais alto"): onda
 * triangular (os harmônicos a fazem soar mais alta no mesmo volume), quase 9 vezes o volume dos outros, e notas que
 * não se encostam (assim o volume de cada uma não soma com o da anterior e não estoura).
 */
const SUAVE = { onda: 'sine' as OscillatorType, volume: 0.08, passo: 0.09, duracao: 0.16 };
const FORTE = { onda: 'triangle' as OscillatorType, volume: 0.7, passo: 0.18, duracao: 0.16 };

let contexto: AudioContext | null = null;

export function sonsLigados(): boolean {
  return lembrado('ozamigos-sons') !== 'nao';
}

export function ligarSons(ligar: boolean): void {
  lembrar('ozamigos-sons', ligar ? '' : 'nao');
}

/**
 * `sempre`: toca mesmo com os sons de aviso desligados. Só o chamado usa: é o jeito de um amigo chamar quem está com o
 * som do Ozamigos desligado (que não passa por aqui: ele é o volume da voz e das transmissões).
 */
export function tocar(som: Som, sempre = false): void {
  if (!sempre && !sonsLigados()) return;
  try {
    contexto ??= new AudioContext();
    const agora = contexto.currentTime;
    const { onda, volume, passo, duracao } = som === 'chamado' ? FORTE : SUAVE;
    NOTAS[som].forEach((frequencia, i) => {
      const oscilador = contexto!.createOscillator();
      const ganho = contexto!.createGain();
      oscilador.type = onda;
      oscilador.frequency.value = frequencia;
      const inicio = agora + i * passo;
      ganho.gain.setValueAtTime(0, inicio);
      ganho.gain.linearRampToValueAtTime(volume, inicio + 0.01);
      if (som === 'chamado') ganho.gain.setValueAtTime(volume, inicio + duracao * 0.6); // segura a nota antes de soltar
      ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
      oscilador.connect(ganho).connect(contexto!.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + duracao + 0.02);
    });
  } catch {
    // sem áudio disponível: segue em silêncio
  }
}
