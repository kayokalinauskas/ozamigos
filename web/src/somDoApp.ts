// O som do PC no app para Windows: o auxiliar do app (OzamigosSom.exe) captura todos os programas,
// menos o Discord e o próprio Ozamigos, e manda os pedaços para cá. Aqui eles viram uma faixa de
// áudio (MediaStreamTrack) que vai junto com o vídeo da transmissão.

import { ponte } from './ponte';

// O AudioWorklet roda na thread de áudio do navegador: toca o que chegou, na hora certa.
// Guarda uma reserva de 40 ms contra picotes e descarta o excesso acima de 150 ms (atraso não cresce).
const PROCESSADOR = `
class SomDoApp extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dados = new Float32Array(48000 * 2);
    this.inicio = 0;
    this.quantidade = 0;
    this.pronto = false;
    this.port.onmessage = (evento) => this.escrever(evento.data);
  }
  escrever(amostras) {
    const capacidade = this.dados.length;
    for (let i = 0; i < amostras.length; i++) {
      if (this.quantidade === capacidade) { this.inicio = (this.inicio + 2) % capacidade; this.quantidade -= 2; }
      this.dados[(this.inicio + this.quantidade) % capacidade] = amostras[i];
      this.quantidade++;
    }
    const maximo = 7200 * 2, alvo = 2400 * 2;
    if (this.quantidade > maximo) {
      const pular = this.quantidade - alvo;
      this.inicio = (this.inicio + pular) % capacidade;
      this.quantidade -= pular;
    }
  }
  process(_entradas, saidas) {
    const [esquerda, direita] = saidas[0];
    const quadros = esquerda.length;
    if (!this.pronto && this.quantidade >= 1920 * 2) this.pronto = true;
    if (!this.pronto || this.quantidade < quadros * 2) {
      this.pronto = false;
      esquerda.fill(0);
      direita.fill(0);
      return true;
    }
    const capacidade = this.dados.length;
    for (let i = 0; i < quadros; i++) {
      esquerda[i] = this.dados[this.inicio];
      direita[i] = this.dados[(this.inicio + 1) % capacidade];
      this.inicio = (this.inicio + 2) % capacidade;
    }
    this.quantidade -= quadros * 2;
    return true;
  }
}
registerProcessor('som-do-app', SomDoApp);
`;

type Sessao = { contexto: AudioContext; no: AudioWorkletNode; trilha: MediaStreamTrack };

let sessao: Promise<Sessao> | null = null;

async function abrir(): Promise<Sessao> {
  const contexto = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const modulo = URL.createObjectURL(new Blob([PROCESSADOR], { type: 'text/javascript' }));
  await contexto.audioWorklet.addModule(modulo);
  URL.revokeObjectURL(modulo);
  const no = new AudioWorkletNode(contexto, 'som-do-app', { numberOfInputs: 0, outputChannelCount: [2] });
  const destino = contexto.createMediaStreamDestination();
  destino.channelCount = 2;
  no.connect(destino);
  ponte?.aoReceberSom((dados) => {
    // Copia para um ArrayBuffer próprio: Float32Array exige início alinhado em 4 bytes.
    const amostras = new Float32Array(dados.slice().buffer);
    no.port.postMessage(amostras, [amostras.buffer]);
  });
  await contexto.resume();
  return { contexto, no, trilha: destino.stream.getAudioTracks()[0] };
}

/** A faixa com o som do PC. Trocar a fonte de vídeo reaproveita a mesma faixa. */
export async function trilhaDoSomDoApp(): Promise<MediaStreamTrack> {
  sessao ??= abrir();
  try {
    return (await sessao).trilha;
  } catch (erro) {
    sessao = null; // a próxima tentativa começa do zero
    throw erro;
  }
}

export function pararSomDoApp() {
  ponte?.pararSom();
  const atual = sessao;
  sessao = null;
  atual?.then(
    ({ contexto, trilha }) => {
      trilha.stop();
      void contexto.close();
    },
    () => undefined, // não chegou a abrir: nada para fechar
  );
}
