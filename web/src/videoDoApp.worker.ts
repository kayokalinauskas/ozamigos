// O worker da captura do app (1.2.19 em diante): recebe os quadros NV12 direto do processo principal do app, por um
// MessagePort, e monta cada VideoFrame fora da thread da página. Em 1080p a 60 fps são ~160 MB/s: recebidos na thread
// da página (pelo ipcRenderer, no app 1.2.18), eles disputavam com a interface e o WebRTC, a página ficava para trás e
// o atraso crescia sem parar (de 13 ms para 2,7 s em 30 s, medido). Cada quadro é confirmado ao app assim que vira
// VideoFrame: o app só manda o próximo com poucos no caminho (controle de fluxo em ligarCapturaDeVideo, no main.js).

type Mensagem = { quadro: VideoFrame; capturado: number; chegou: number };

// O escopo do worker, com só o que se usa daqui (sem a lib "webworker", que trocaria os tipos do projeto inteiro).
const escopo = globalThis as unknown as {
  onmessage: ((evento: MessageEvent) => void) | null;
  postMessage(resposta: Mensagem, transferir: Transferable[]): void;
};

let porta: MessagePort | null = null;

escopo.onmessage = (mensagem: MessageEvent) => {
  const [nova] = mensagem.ports;
  if (!nova) return;
  porta?.close();
  porta = nova;
  porta.onmessage = (evento: MessageEvent<ArrayBuffer>) => {
    const bytes = new Uint8Array(evento.data);
    const cabecalho = new DataView(bytes.buffer, 0, 24);
    const capturado = cabecalho.getFloat64(16, true);
    const quadro = new VideoFrame(bytes.subarray(24), {
      format: 'NV12',
      codedWidth: cabecalho.getUint16(4, true),
      codedHeight: cabecalho.getUint16(6, true),
      timestamp: Math.round(capturado * 1000), // em µs, do momento da captura
      // O app converte para BT.709 de faixa limitada (Conversor.cs).
      colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
    });
    const resposta: Mensagem = { quadro, capturado, chegou: Date.now() };
    escopo.postMessage(resposta, [quadro]);
    porta?.postMessage(0); // confirmado: o app pode mandar o próximo
  };
  porta.start();
};

export type { Mensagem };
