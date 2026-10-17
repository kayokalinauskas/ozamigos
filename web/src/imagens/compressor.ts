// O lado da página do compressor: um worker só, aberto na primeira imagem, e uma promessa por pedido.
import type { RespostaDaCompressao, ResultadoDaCompressao } from './compressor.worker';

export type { ImagemComprimida } from './compressor.worker';

let trabalhador: Worker | null = null;
let proximoPedido = 1;
const esperando = new Map<number, (resultado: ResultadoDaCompressao) => void>();

export function comprimir(arquivo: Blob): Promise<ResultadoDaCompressao> {
  if (!trabalhador) {
    trabalhador = new Worker(new URL('./compressor.worker.ts', import.meta.url), { type: 'module' });
    trabalhador.onmessage = ({ data }: MessageEvent<RespostaDaCompressao>) => {
      esperando.get(data.pedido)?.(data);
      esperando.delete(data.pedido);
    };
    trabalhador.onerror = () => {
      // O worker não subiu (ou caiu): cada imagem esperando falha, e a próxima abre outro.
      esperando.forEach((responder) => responder({ ok: false, motivo: 'sem-codificador' }));
      esperando.clear();
      trabalhador?.terminate();
      trabalhador = null;
    };
  }
  const pedido = proximoPedido++;
  return new Promise((responder) => {
    esperando.set(pedido, responder);
    trabalhador!.postMessage({ pedido, arquivo });
  });
}
