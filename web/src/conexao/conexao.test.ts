import { aceitaHevc } from '../qualidade';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ESPERAS_PARA_RECONECTAR, Sinalizacao } from './sinalizacao';
import { PRAZO_SEM_QUADROS, VigiaDoCodificador, opusDeVoz, opusEstereo, preferirCodecs } from './webrtc';

/** Um WebSocket de mentira: o teste decide quando abre, fecha e o que chega. */
class WebSocketFalso {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static criados: WebSocketFalso[] = [];
  readyState = WebSocketFalso.CONNECTING;
  enviadas: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    WebSocketFalso.criados.push(this);
  }
  send(texto: string) {
    this.enviadas.push(texto);
  }
  close() {
    this.readyState = 3;
  }
  abrir() {
    this.readyState = WebSocketFalso.OPEN;
    this.onopen?.();
  }
  cair() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('sinalização', () => {
  beforeEach(() => {
    WebSocketFalso.criados = [];
    vi.stubGlobal('WebSocket', WebSocketFalso);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('trata as mensagens uma de cada vez, na ordem em que chegaram, e ignora as que não são mensagem', async () => {
    const tratadas: string[] = [];
    const s = new Sinalizacao(
      {
        aoAbrir: () => s.enviar({ tipo: 'ping' }),
        aoReceber: async (msg) => {
          if (msg.tipo === 'entrou') await new Promise((r) => setTimeout(r, 50)); // a primeira demora mais
          tratadas.push(msg.tipo);
        },
        aoFechar: () => undefined,
      },
      () => 'ws://teste/sinal',
    );
    s.conectar();
    const ws = WebSocketFalso.criados[0];
    ws.abrir();
    ws.onmessage?.({ data: '{"tipo":"entrou","id":"a","nome":"Ana"}' });
    ws.onmessage?.({ data: 'lixo' });
    ws.onmessage?.({ data: '{"tipo":"saiu","id":"a"}' });
    await vi.runAllTimersAsync();

    expect(ws.enviadas).toEqual(['{"tipo":"ping"}']);
    expect(tratadas).toEqual(['entrou', 'saiu']);
  });

  it('reconecta esperando cada vez mais, e a conexão abandonada não avisa mais nada', () => {
    const fechou = vi.fn();
    const s = new Sinalizacao({ aoAbrir: () => undefined, aoReceber: () => undefined, aoFechar: fechou }, () => 'ws://teste/sinal');
    s.conectar();
    const primeira = WebSocketFalso.criados[0];

    s.tentarDeNovo();
    primeira.cair(); // abandonada: o cliente não fica sabendo
    expect(fechou).not.toHaveBeenCalled();

    for (const [i, espera] of ESPERAS_PARA_RECONECTAR.entries()) {
      vi.advanceTimersByTime(espera - 1);
      expect(WebSocketFalso.criados).toHaveLength(i + 1); // ainda não
      vi.advanceTimersByTime(1);
      expect(WebSocketFalso.criados).toHaveLength(i + 2);
      s.tentarDeNovo(); // não deu de novo
    }
    vi.advanceTimersByTime(ESPERAS_PARA_RECONECTAR.at(-1)!); // depois disso, a espera fica no máximo
    expect(WebSocketFalso.criados).toHaveLength(ESPERAS_PARA_RECONECTAR.length + 2);
  });
});

describe('Opus no SDP', () => {
  const sdp = 'v=0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n';

  it('pede estéreo para o som do jogo e voz econômica para a conversa, uma vez só', () => {
    expect(opusEstereo(sdp)).toContain('a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000\r\n');
    expect(opusEstereo(opusEstereo(sdp))).toBe(opusEstereo(sdp));
    expect(opusDeVoz(sdp)).toContain('usedtx=1;maxaveragebitrate=64000');
    expect(opusDeVoz('v=0\r\n')).toBe('v=0\r\n'); // sem Opus: não mexe
  });
});

describe('codec da transmissão', () => {
  it('H.265 primeiro, depois o H.264 e o VP8 do processador; um codec recusado sai da lista', () => {
    const codecs = ['video/VP8', 'video/H264', 'video/AV1', 'video/H265', 'video/rtx'].map((mimeType) => ({ mimeType, clockRate: 90000 }));
    vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs, headerExtensions: [] }) });
    const escolhidos: string[][] = [];
    const transceptor = { setCodecPreferences: (c: RTCRtpCodec[]) => escolhidos.push(c.map((x) => x.mimeType)) } as unknown as RTCRtpTransceiver;

    preferirCodecs(transceptor);
    preferirCodecs(transceptor, new Set(['video/H265']));
    preferirCodecs(transceptor, new Set(['video/H265', 'video/H264']));

    expect(escolhidos[0].slice(0, 3)).toEqual(['video/H265', 'video/H264', 'video/VP8']);
    expect(escolhidos[1][0]).toBe('video/H264');
    expect(escolhidos[1]).not.toContain('video/H265');
    expect(escolhidos[2][0]).toBe('video/VP8');
    expect(escolhidos[2]).not.toContain('video/H264');
    vi.unstubAllGlobals();
  });

  it('troca de codec só com a conexão conectada pelo prazo, a captura andando e nenhum quadro codificado', () => {
    const h264 = (conectada: boolean, codificados: number, capturados?: number) => ({ conectada, codec: 'video/H264', codificados, capturados });
    const vigia = new VigiaDoCodificador();
    expect(vigia.ler(h264(false, 0, 0), 0)).toBe('esperar'); // conectando: o prazo nem começou
    expect(vigia.ler(h264(true, 0, 30), 2_000)).toBe('esperar');
    expect(vigia.ler(h264(true, 0, 150), 2_000 + PRAZO_SEM_QUADROS - 1)).toBe('esperar');
    expect(vigia.ler(h264(true, 0, 180), 2_000 + PRAZO_SEM_QUADROS)).toBe('trocar');

    const parada = new VigiaDoCodificador(); // a captura sem quadros novos: o codificador não tem culpa
    parada.ler(h264(true, 0, 40), 0);
    expect(parada.ler(h264(true, 0, 45), PRAZO_SEM_QUADROS * 2)).toBe('esperar');

    const caiu = new VigiaDoCodificador(); // a conexão que cai recomeça o prazo
    caiu.ler(h264(true, 0, 0), 0);
    caiu.ler(h264(false, 0, 100), 4_000);
    caiu.ler(h264(true, 0, 120), 5_000);
    expect(caiu.ler(h264(true, 0, 300), 5_000 + PRAZO_SEM_QUADROS - 1)).toBe('esperar');

    const semContagem = new VigiaDoCodificador(); // o navegador não diz os quadros da captura: vale o prazo
    semContagem.ler(h264(true, 0), 0);
    expect(semContagem.ler(h264(true, 0), PRAZO_SEM_QUADROS)).toBe('trocar');

    expect(new VigiaDoCodificador().ler(h264(true, 1, 30), 0)).toBe('funciona');
    expect(new VigiaDoCodificador().ler({ conectada: true, codec: '', codificados: 0 }, 0)).toBe('esperar');
    expect(new VigiaDoCodificador().ler({ conectada: true, codec: 'video/VP8', codificados: 0 }, 0)).toBe('sem-saida');
  });

  it('em 1080p, nunca H.265 (o codificador da placa falhava e derrubava a página); até 720p, sim', () => {
    expect(aceitaHevc('leve')).toBe(true);
    expect(aceitaHevc('leve60')).toBe(true);
    expect(aceitaHevc('nitida')).toBe(false);
    expect(aceitaHevc('nitida60')).toBe(false);
  });
});

describe('protocolo', () => {
  it('toda mensagem e todo erro que o servidor manda estão em protocolo.ts', () => {
    // Os testes rodam a partir de web/ (no DOM simulado, import.meta.url não é um arquivo).
    const servidor = readFileSync('../src/main/java/dev/ozamigos/SinalizacaoHandler.java', 'utf8');
    const protocolo = readFileSync('src/conexao/protocolo.ts', 'utf8');
    const tipos = [...servidor.matchAll(/put\("tipo", "([a-z-]+)"\)/g)].map((m) => m[1]);
    const erros = [
      ...[...servidor.matchAll(/(?:erro|recusar)\(sessao, "([a-z-]+)"\)/g)].map((m) => m[1]),
      ...[...servidor.matchAll(/case [A-Z_, ]+ -> "([a-z-]+)";/g)].map((m) => m[1]), // as recusas dos grupos
    ];
    expect(tipos.length).toBeGreaterThan(5);
    expect(erros.length).toBeGreaterThan(5);
    for (const nome of [...tipos, ...erros]) expect(protocolo, nome).toContain(`'${nome}'`);
  });
});
