// O lado de quem assiste no teste com os amigos. Quem transmite pede pelo canal de medidas ("gravar"),
// e este PC manda, a cada segundo, como a transmissão chega aqui: fps, ritmo na tela, perdas, congelamentos.
// Nada é gravado neste PC, e quem assiste vê um aviso enquanto as medidas estão indo.

import { cliente } from '../cliente';
import { noApp, ponte } from '../ponte';
import { AmostradorRecepcao, medidorDaPagina, videoDoStream } from './amostradores';
import type { AmbienteDoEspectador } from './tipos';

const ativos = new Map<RTCDataChannel, { amostrador: AmostradorRecepcao; relogio: ReturnType<typeof setInterval> }>();

function parar(canal: RTCDataChannel) {
  const ativo = ativos.get(canal);
  if (!ativo) return;
  clearInterval(ativo.relogio);
  ativo.amostrador.parar();
  medidorDaPagina.desligar();
  ativos.delete(canal);
}

function comecar(idTransmissor: string, canal: RTCDataChannel, pc: RTCPeerConnection) {
  if (ativos.has(canal)) return;
  const amostrador = new AmostradorRecepcao(pc, 'eu', false, () => videoDoStream(cliente.ler().videos[idTransmissor]));
  medidorDaPagina.ligar();
  const ambiente: AmbienteDoEspectador = {
    app: noApp ? `app ${ponte?.versao ?? '?'}` : 'navegador',
    navegador: navigator.userAgent,
    tela: `${screen.width}x${screen.height} @${devicePixelRatio}`,
    hz: null,
    nucleos: navigator.hardwareConcurrency ?? null,
  };
  canal.send(JSON.stringify({ tipo: 'ambiente', ambiente }));
  let segundo = 0;
  const relogio = setInterval(async () => {
    if (canal.readyState !== 'open') {
      parar(canal);
      return;
    }
    const amostra = await amostrador.amostrar(++segundo, medidorDaPagina.colher());
    if (amostra && canal.readyState === 'open') canal.send(JSON.stringify({ tipo: 'recepcao', amostra }));
  }, 1000);
  ativos.set(canal, { amostrador, relogio });
  cliente.avisar(`${cliente.nomeDe(idTransmissor)} está gravando um teste de desempenho: o Ozamigos manda para ele como a transmissão chega aqui.`);
}

/** Liga o lado de quem assiste. Chamado uma vez, na abertura da página. */
export function ouvirPedidosDeMedidas() {
  cliente.aoAbrirCanalDeMedidas = (idTransmissor, canal, pc) => {
    canal.addEventListener('message', (evento) => {
      let msg: { tipo?: string; ligado?: boolean };
      try {
        msg = JSON.parse(String(evento.data));
      } catch {
        return;
      }
      if (msg.tipo !== 'gravar') return;
      if (msg.ligado) comecar(idTransmissor, canal, pc);
      else {
        parar(canal);
        cliente.avisar(`${cliente.nomeDe(idTransmissor)} terminou o teste de desempenho.`);
      }
    });
    canal.addEventListener('close', () => parar(canal));
  };
}
