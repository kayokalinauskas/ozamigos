// O som do PC no app para Windows: o auxiliar do app (OzamigosSom.exe) captura todos os programas,
// menos o Discord e o próprio Ozamigos, e manda os pedaços para cá. Aqui eles viram uma faixa de
// áudio (MediaStreamTrack) que vai junto com o vídeo da transmissão.
//
// No app 1.2.20 em diante, os pedaços vão por um canal direto (um MessagePort) até o AudioWorklet, sem passar pela
// thread da página; no app de antes, pelo ipcRenderer e pela página. Medido em 17/10/2026 (um bipe e um clarão ao mesmo
// tempo na tela transmitida, na sala com voz, chat e imagens): o som chegava 114–147 ms depois da imagem. A página
// ocupada atrasava os pedaços, e a reserva do AudioWorklet (de 40 até 150 ms, só cortada acima disso) ia enchendo.

import { ponte } from './ponte';

// O AudioWorklet roda na thread de áudio do navegador: toca o que chegou, na hora certa. A reserva mira 30 ms contra
// picotes. Acima de 60 ms, toca 2% mais rápido (com interpolação, sem salto audível) até voltar aos 30; acima de 200 ms
// (uma trava longa), corta de uma vez para os 30. Faltou som: silêncio até juntar os 30 de novo.
const PROCESSADOR = `
const ALVO = 1440, ALTO = 2880, CORTE = 9600; // em quadros estéreo, a 48 kHz: 30, 60 e 200 ms
class SomDoApp extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dados = new Float32Array(48000 * 2);
    this.inicio = 0; // posição de leitura, em amostras (sempre par: o começo de um quadro estéreo)
    this.fracao = 0; // quanto do quadro de agora já foi tocado (0 a 1), ao acelerar
    this.quantidade = 0; // amostras guardadas a partir de inicio
    this.pronto = false;
    this.ritmo = 1;
    this.port.onmessage = (evento) => {
      const [canal] = evento.ports;
      if (canal) canal.onmessage = (e) => this.escrever(new Float32Array(e.data)); // o canal direto do app
      else this.escrever(evento.data); // pedaços vindos da página
    };
  }
  escrever(amostras) {
    const capacidade = this.dados.length;
    let fim = (this.inicio + this.quantidade) % capacidade;
    for (let i = 0; i < amostras.length; i++) {
      if (this.quantidade === capacidade) break; // cheio (1 s): não acontece com o corte abaixo
      this.dados[fim] = amostras[i];
      fim = (fim + 1) % capacidade;
      this.quantidade++;
    }
    if (this.quantidade > CORTE * 2) this.pular(this.quantidade - ALVO * 2);
  }
  pular(amostras) {
    amostras -= amostras % 2;
    this.inicio = (this.inicio + amostras) % this.dados.length;
    this.quantidade -= amostras;
  }
  process(_entradas, saidas) {
    const [esquerda, direita] = saidas[0];
    const quadros = esquerda.length;
    const guardados = this.quantidade / 2;
    if (!this.pronto && guardados >= ALVO) this.pronto = true;
    if (guardados > ALTO) this.ritmo = 1.02;
    else if (guardados <= ALVO) this.ritmo = 1;
    if (!this.pronto || guardados < quadros * this.ritmo + 2) {
      this.pronto = false;
      esquerda.fill(0);
      direita.fill(0);
      return true;
    }
    const capacidade = this.dados.length;
    let pos = this.fracao;
    for (let i = 0; i < quadros; i++) {
      const q = Math.floor(pos), f = pos - q;
      const a = (this.inicio + q * 2) % capacidade, b = (a + 2) % capacidade;
      esquerda[i] = this.dados[a] + (this.dados[b] - this.dados[a]) * f;
      direita[i] = this.dados[a + 1] + (this.dados[b + 1] - this.dados[a + 1]) * f;
      pos += this.ritmo;
    }
    const consumidos = Math.floor(pos);
    this.fracao = pos - consumidos;
    this.inicio = (this.inicio + consumidos * 2) % capacidade;
    this.quantidade -= consumidos * 2;
    return true;
  }
}
registerProcessor('som-do-app', SomDoApp);
`;

type Sessao = { contexto: AudioContext; no: AudioWorkletNode; trilha: MediaStreamTrack };

let sessao: Promise<Sessao> | null = null;
let noAtual: AudioWorkletNode | null = null;

// A porta do canal direto chega do preload por um postMessage da própria janela (é assim que um MessagePort passa do
// preload para a página no Electron), e vai direto para o AudioWorklet.
if (ponte?.canalDoSom) {
  addEventListener('message', (evento) => {
    if (evento.source !== window || evento.origin !== location.origin || evento.data !== 'ozamigos-porta-do-som') return;
    const [porta] = evento.ports;
    if (porta && noAtual) noAtual.port.postMessage(null, [porta]);
    else porta?.close();
  });
}

async function abrir(): Promise<Sessao> {
  const contexto = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const modulo = URL.createObjectURL(new Blob([PROCESSADOR], { type: 'text/javascript' }));
  await contexto.audioWorklet.addModule(modulo);
  URL.revokeObjectURL(modulo);
  const no = new AudioWorkletNode(contexto, 'som-do-app', { numberOfInputs: 0, outputChannelCount: [2] });
  const destino = contexto.createMediaStreamDestination();
  destino.channelCount = 2;
  no.connect(destino);
  noAtual = no;
  if (ponte?.canalDoSom) {
    ponte.canalDoSom(); // o app abre o canal direto e manda a porta (acima)
  } else {
    ponte?.aoReceberSom((dados) => {
      // Copia para um ArrayBuffer próprio: Float32Array exige início alinhado em 4 bytes.
      const amostras = new Float32Array(dados.slice().buffer);
      no.port.postMessage(amostras, [amostras.buffer]);
    });
  }
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
  noAtual = null;
  atual?.then(
    ({ contexto, trilha }) => {
      trilha.stop();
      void contexto.close();
    },
    () => undefined, // não chegou a abrir: nada para fechar
  );
}
