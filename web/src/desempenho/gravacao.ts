// O teste de desempenho de quem transmite (Ctrl+Shift+X): um roteiro automático com espectadores criados no
// próprio PC (conexões WebRTC locais, sem servidor nem internet), passando pelas qualidades e por 1, 3 e 7
// espectadores. Quem já assiste de verdade entra nas medidas de envio. O resultado é uma Gravacao (tipos.ts).
// Com os amigos de verdade, a medida é a gravação da sala (Ctrl+Shift+G, gravadorDaSala.ts).

import { AJUSTES_DA_TRANSMISSAO, cliente } from '../cliente';
import { noApp, ponte } from '../ponte';
import { QUALIDADES, type Qualidade } from '../qualidade';
import { AmostradorEnvio, AmostradorRecepcao, contadoresDoPc, medidorDaPagina, videoDoStream } from './amostradores';
import { resumirTrecho, type ResumoDoTrecho } from './analise';
import {
  FORMATO,
  SEGUNDOS_DESCARTADOS,
  type Acontecimento,
  type AmostraCaptura,
  type AmostraEnvio,
  type AmostraPagina,
  type AmostraPc,
  type AmostraRecepcao,
  type Gravacao,
  type Modo,
  type Roteiro,
  type Trecho,
} from './tipos';

export type Etapa = { nome: string; segundos: number; qualidade: Qualidade; espectadores: number; aquecimento?: boolean };

const rotulo = (q: Qualidade) => QUALIDADES[q].rotulo;

export function etapasDoRoteiro(roteiro: Roteiro, sua: Qualidade): Etapa[] {
  if (roteiro === 'rapido') {
    return [
      { nome: 'Aquecimento', segundos: 8, qualidade: sua, espectadores: 1, aquecimento: true },
      { nome: rotulo(sua), segundos: 25, qualidade: sua, espectadores: 1 },
      { nome: rotulo(sua), segundos: 25, qualidade: sua, espectadores: 7 },
    ];
  }
  // Uma qualidade só (qualidade.ts): o roteiro completo passa por 1, 3 e 7 espectadores, mais tempo em cada.
  return [
    { nome: 'Aquecimento', segundos: 10, qualidade: sua, espectadores: 1, aquecimento: true },
    { nome: rotulo(sua), segundos: 35, qualidade: sua, espectadores: 1 },
    { nome: rotulo(sua), segundos: 35, qualidade: sua, espectadores: 3 },
    { nome: rotulo(sua), segundos: 35, qualidade: sua, espectadores: 7 },
  ];
}

export type EstadoDoTeste = {
  fase: 'parado' | 'gravando' | 'encerrando' | 'pronto';
  modo: Modo;
  roteiro: Roteiro;
  segundos: number;
  etapas: Etapa[];
  etapaAtual: number;
  /** Fluidez (% de quadros no tempo) de cada etapa já terminada. */
  notas: (number | null)[];
  agora: {
    envio: AmostraEnvio[];
    recepcao: AmostraRecepcao[];
    captura: AmostraCaptura | null;
    pc: AmostraPc | null;
    pagina: AmostraPagina | null;
  };
  /** Últimos 60 s de algumas séries, para os minigráficos. */
  series: Record<'mbps' | 'codificacao' | 'qp' | 'cpu' | 'placa', number[]>;
  acontecimentos: Acontecimento[];
  /** Os últimos 10 s do trecho atual, para os números ao vivo. */
  resumo: ResumoDoTrecho | null;
  /** Começo de trecho: a conexão ainda está subindo a banda, e esses segundos ficam fora do relatório. */
  estabilizando: boolean;
  /** O vídeo de cada espectador simulado (o primeiro aparece grande). */
  simulados: MediaStream[];
  gravacao: Gravacao | null;
  erro: string;
};

type Simulado = { envio: RTCPeerConnection; recebe: RTCPeerConnection; stream: MediaStream; amostradorEnvio: AmostradorEnvio; amostradorRecepcao: AmostradorRecepcao };

const vazio = (): EstadoDoTeste => ({
  fase: 'parado',
  modo: 'simulado',
  roteiro: 'completo',
  segundos: 0,
  etapas: [],
  etapaAtual: 0,
  notas: [],
  agora: { envio: [], recepcao: [], captura: null, pc: null, pagina: null },
  series: { mbps: [], codificacao: [], qp: [], cpu: [], placa: [] },
  acontecimentos: [],
  resumo: null,
  estabilizando: false,
  simulados: [],
  gravacao: null,
  erro: '',
});

class Teste {
  private estado = vazio();
  private readonly ouvintes = new Set<() => void>();
  private gravacao: Gravacao | null = null;
  private relogio: ReturnType<typeof setInterval> | null = null;
  private inicio = 0;
  private medindo = false;
  private simulados: Simulado[] = [];
  private readonly reais = new Map<string, { amostrador: AmostradorEnvio }>();
  private trechoAtual: Trecho | null = null;
  private fimDaEtapa = 0;
  private anteriores = new Map<string, { altura: number | null; limite: string | null }>();

  inscrever = (ouvinte: () => void) => {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  };

  ler = () => this.estado;

  private mudar(parcial: Partial<EstadoDoTeste>) {
    this.estado = { ...this.estado, ...parcial };
    this.ouvintes.forEach((ouvinte) => ouvinte());
  }

  /** Volta para a tela inicial do teste (depois de ver o relatório). */
  limpar() {
    if (this.estado.fase === 'gravando' || this.estado.fase === 'encerrando') return;
    this.mudar(vazio());
  }

  async iniciar(roteiro: Roteiro) {
    const e = cliente.ler();
    const modo: Modo = 'simulado';
    if (this.estado.fase === 'gravando' || this.estado.fase === 'encerrando') return;
    if (!e.minhaTela) {
      this.mudar({ erro: 'Comece a transmitir o jogo antes de iniciar o teste.' });
      return;
    }
    // O teste troca a qualidade da transmissão: estragaria as medidas da gravação da sala.
    if (e.gravacaoDaSala) {
      this.mudar({ erro: `${e.gravacaoDaSala.id === e.meuId ? 'Você está' : `${e.gravacaoDaSala.nome} está`} gravando as estatísticas da sala. Espere terminar (Ctrl+Shift+G).` });
      return;
    }
    const etapas = etapasDoRoteiro(roteiro, e.qualidade);
    const [video] = e.minhaTela.getVideoTracks();
    this.gravacao = {
      formato: FORMATO,
      modo,
      roteiro,
      inicio: new Date().toISOString(),
      duracao: 0,
      interrompido: false,
      app: noApp ? `app ${ponte?.versao ?? '?'}` : 'navegador',
      navegador: navigator.userAgent,
      pc: (await ponte?.desempenho?.pc().catch(() => null)) ?? null,
      tela: `${screen.width}x${screen.height} @${devicePixelRatio}`,
      qualidadeDaPessoa: e.qualidade,
      fonte: `${cliente.descreverFonte()} · "${video?.label ?? '?'}" · captura ${JSON.stringify(video?.getSettings() ?? {})}`,
      ajustes: { ...AJUSTES_DA_TRANSMISSAO },
      qualidades: { ...QUALIDADES },
      trechos: [],
      espectadoresReais: [],
      envio: [],
      captura: [],
      recepcao: [],
      pcAmostras: [],
      pagina: [],
      acontecimentos: [],
    };
    contadoresDoPc.ligar();
    medidorDaPagina.ligar();
    this.inicio = performance.now();
    this.trechoAtual = null;
    this.anteriores.clear();
    this.mudar({ ...vazio(), fase: 'gravando', modo, roteiro, etapas, notas: etapas.map(() => null) });
    cliente.registrar(`teste de desempenho: começou (${roteiro})`);
    this.anotar('inicio', `Teste automático (${roteiro}) começou`);
    await this.entrarNaEtapa(0);
    this.relogio = setInterval(() => void this.medir(), 1000);
  }

  private agora() {
    return Math.round((performance.now() - this.inicio) / 1000);
  }

  private anotar(tipo: string, texto: string) {
    if (!this.gravacao) return;
    const acontecimento = { t: this.agora(), tipo, texto };
    this.gravacao.acontecimentos.push(acontecimento);
    this.mudar({ acontecimentos: [acontecimento, ...this.estado.acontecimentos].slice(0, 30) });
  }

  // ===== Roteiro do modo simulado =====

  private async entrarNaEtapa(indice: number) {
    const etapa = this.estado.etapas[indice];
    // O trecho anterior acaba aqui: os segundos em que os espectadores novos se conectam não são de ninguém.
    this.fecharTrecho(this.agora());
    this.trechoAtual = null;
    this.mudar({ etapaAtual: indice });
    while (this.simulados.length < etapa.espectadores) await this.criarSimulado();
    while (this.simulados.length > etapa.espectadores) this.fecharSimulado(this.simulados.pop()!);
    this.mudar({ simulados: this.simulados.map((s) => s.stream) });
    this.fimDaEtapa = this.agora() + etapa.segundos;
    this.anotar('etapa', `Etapa ${indice + 1}: ${etapa.nome} com ${etapa.espectadores} ${etapa.espectadores === 1 ? 'espectador' : 'espectadores'}`);
    this.abrirTrecho(etapa.nome, etapa.qualidade, etapa.aquecimento ?? false);
  }

  /** Um espectador no próprio PC: duas conexões WebRTC ligadas direto, sem servidor e sem internet. */
  private async criarSimulado() {
    const numero = this.simulados.length + 1;
    const envio = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
    const recebe = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
    const chegou = new Promise<MediaStream>((resolver) => {
      recebe.ontrack = (evento) => {
        if (evento.track.kind !== 'video') return; // a folga vale só para o vídeo, como nas conexões de verdade
        try {
          (evento.receiver as RTCRtpReceiver & { jitterBufferTarget: number | null }).jitterBufferTarget = AJUSTES_DA_TRANSMISSAO.folgaDeRedeMs;
        } catch {
          // o mesmo aviso já aparece nas conexões de verdade
        }
        resolver(evento.streams[0]);
      };
    });
    cliente.montarEnvio(envio);
    cliente.registrarEnvioExtra(envio);
    // Sem trocar candidatos um a um: cada lado espera juntar os seus (só os do próprio PC, é instantâneo).
    await envio.setLocalDescription(await envio.createOffer());
    await candidatosProntos(envio);
    await recebe.setRemoteDescription(envio.localDescription!);
    await recebe.setLocalDescription(await recebe.createAnswer());
    await candidatosProntos(recebe);
    await envio.setRemoteDescription(recebe.localDescription!);
    await cliente.aplicarPreferencia(envio);
    const stream = await chegou;
    const nome = `simulado ${numero}`;
    this.simulados.push({
      envio,
      recebe,
      stream,
      amostradorEnvio: new AmostradorEnvio(envio, nome, true),
      amostradorRecepcao: new AmostradorRecepcao(recebe, nome, true, () => videoDoStream(stream)),
    });
  }

  private fecharSimulado(simulado: Simulado) {
    simulado.amostradorRecepcao.parar();
    cliente.removerEnvioExtra(simulado.envio);
    simulado.envio.close();
    simulado.recebe.close();
  }

  // ===== Trechos =====

  private abrirTrecho(nome: string, qualidade: Qualidade, aquecimento = false) {
    const t = this.agora();
    this.fecharTrecho(t);
    const reais = this.reais.size;
    const simulados = this.simulados.length;
    this.trechoAtual = {
      indice: this.gravacao!.trechos.length,
      nome,
      inicio: t,
      fim: t,
      qualidade,
      espectadores: reais + simulados,
      simulados,
      aquecimento,
      descartarAte: t + SEGUNDOS_DESCARTADOS,
    };
    this.gravacao!.trechos.push(this.trechoAtual);
  }

  private fecharTrecho(t: number) {
    if (this.trechoAtual) this.trechoAtual.fim = t;
  }

  // ===== Medição de cada segundo =====

  private async medir() {
    if (this.medindo || !this.gravacao || this.estado.fase !== 'gravando') return;
    this.medindo = true;
    try {
      if (!cliente.ler().minhaTela) {
        this.anotar('fim', 'A transmissão parou: teste encerrado antes do fim');
        await this.encerrar(true);
        return;
      }
      const t = this.agora();
      this.acompanharAmigos();
      const g = this.gravacao;
      const pagina = medidorDaPagina.colher();
      const amostraPagina: AmostraPagina = { t, ...pagina, janelaVisivel: document.visibilityState === 'visible' };
      g.pagina.push(amostraPagina);
      if (pagina.msTarefaMaior >= 100) this.anotar('tarefa-longa', `A interface travou ${pagina.msTarefaMaior} ms`);

      const envios: AmostraEnvio[] = [];
      let captura: AmostraCaptura | null = null;
      const amostradoresDeEnvio = [...this.simulados.map((s) => s.amostradorEnvio), ...[...this.reais.values()].map((r) => r.amostrador)];
      for (const resultado of await Promise.all(amostradoresDeEnvio.map((a) => a.amostrar(t)))) {
        if (!resultado) continue;
        envios.push(resultado.envio);
        captura ??= resultado.captura;
      }
      g.envio.push(...envios);
      if (captura) g.captura.push(captura);

      const recepcoes = (await Promise.all(this.simulados.map((s) => s.amostradorRecepcao.amostrar(t, pagina)))).filter(
        (r): r is AmostraRecepcao => r !== null,
      );
      g.recepcao.push(...recepcoes);

      const amostraDoPc = await contadoresDoPc.amostrar(t);
      if (amostraDoPc) g.pcAmostras.push(amostraDoPc);

      this.detectar(envios, recepcoes);
      const s = this.estado.series;
      const media = (lista: (number | null)[]) => {
        const v = lista.filter((x): x is number => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
      };
      const ultimos = (lista: number[], valor: number) => [...lista, valor].slice(-60);
      const trecho = this.trechoAtual;
      const resumo = trecho ? resumirTrecho(g, { ...trecho, fim: t, descartarAte: Math.max(trecho.inicio, t - 10) }) : null;
      this.mudar({
        segundos: t,
        resumo,
        estabilizando: trecho ? t <= trecho.descartarAte : true,
        agora: { envio: envios, recepcao: recepcoes, captura, pc: amostraDoPc, pagina: amostraPagina },
        series: {
          mbps: ultimos(s.mbps, media(envios.map((e) => e.mbps))),
          codificacao: ultimos(s.codificacao, media(envios.map((e) => e.msCodificacao))),
          qp: ultimos(s.qp, media(envios.map((e) => e.qp))),
          cpu: ultimos(s.cpu, amostraDoPc?.cpuApp ?? 0),
          placa: ultimos(s.placa, amostraDoPc?.placa3dTotal ?? 0),
        },
      });

      if (t >= this.fimDaEtapa) {
        this.darNota(this.estado.etapaAtual);
        const proxima = this.estado.etapaAtual + 1;
        if (proxima >= this.estado.etapas.length) {
          this.anotar('fim', 'Roteiro completo');
          await this.encerrar(false);
        } else {
          await this.entrarNaEtapa(proxima);
        }
      }
    } catch (erro) {
      console.error('Teste de desempenho: falha ao medir', erro);
    } finally {
      this.medindo = false;
    }
  }

  /** Acontecimentos que valem uma linha: resolução que caiu, limite do codificador, congelamento. */
  private detectar(envios: AmostraEnvio[], recepcoes: AmostraRecepcao[]) {
    for (const e of envios) {
      const antes = this.anteriores.get(e.espectador);
      if (antes?.altura && e.altura && e.altura !== antes.altura) {
        this.anotar('resolucao', `${e.espectador}: resolução ${antes.altura}p → ${e.altura}p (limite: ${e.limite ?? '?'})`);
      }
      if (antes && e.limite !== antes.limite && e.limite && e.limite !== 'none') {
        this.anotar('limite', `${e.espectador}: o codificador passou a ser limitado por ${e.limite}`);
      }
      this.anteriores.set(e.espectador, { altura: e.altura, limite: e.limite });
    }
    for (const r of recepcoes) {
      if (r.congelamentos > 0) this.anotar('congelamento', `${r.espectador}: imagem congelou ${r.msCongelado} ms`);
    }
  }

  /** A fluidez da etapa que acabou, para o quadro do alto da tela (o aquecimento só ganha um "ok"). */
  private darNota(indice: number) {
    const trecho = this.trechoAtual;
    if (!trecho || !this.gravacao) return;
    const notas = [...this.estado.notas];
    notas[indice] = trecho.aquecimento ? -1 : resumirTrecho(this.gravacao, { ...trecho, fim: this.agora() }).recepcao.fluidez;
    this.mudar({ notas });
  }

  // ===== Amigos de verdade =====

  /** Quem assiste de verdade durante o teste entra nas medidas de envio (pesa no mesmo codificador). */
  private acompanharAmigos() {
    const atuais = cliente.envios();
    for (const envio of atuais) {
      const real = this.reais.get(envio.id);
      if (real && real.amostrador.pc === envio.pc) continue;
      this.reais.set(envio.id, { amostrador: new AmostradorEnvio(envio.pc, envio.nome, false) });
      this.anotar('espectador', `${envio.nome} está assistindo`);
      if (!this.gravacao!.espectadoresReais.some((r) => r.nome === envio.nome)) this.gravacao!.espectadoresReais.push({ nome: envio.nome, ambiente: null });
    }
    for (const [id, real] of this.reais) {
      if (atuais.some((envio) => envio.id === id && envio.pc === real.amostrador.pc)) continue;
      this.reais.delete(id);
      this.anotar('espectador', `${real.amostrador.espectador} parou de assistir`);
    }
  }

  /** Encerra a etapa atual agora (o roteiro segue para a próxima no segundo seguinte). */
  pularEtapa() {
    if (this.estado.fase === 'gravando') {
      this.anotar('etapa', 'Etapa pulada pela pessoa');
      this.fimDaEtapa = this.agora();
    }
  }

  /** Para o gráfico ao vivo: o intervalo de cada quadro do primeiro espectador simulado (últimos ~10 s). */
  ritmoAoVivo(): { porQuadro: boolean; valores: number[] } {
    const primeiro = this.simulados[0];
    return { porQuadro: true, valores: primeiro ? [...primeiro.amostradorRecepcao.ritmo.historico] : [] };
  }

  // ===== Fim =====

  async parar() {
    if (this.estado.fase !== 'gravando') return;
    this.anotar('fim', 'Parado pela pessoa');
    await this.encerrar(true);
  }

  private async encerrar(interrompido: boolean) {
    if (!this.gravacao || this.estado.fase !== 'gravando') return;
    this.mudar({ fase: 'encerrando' });
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = null;
    const g = this.gravacao;
    const t = this.agora();
    this.fecharTrecho(t);
    g.trechos = g.trechos.filter((trecho) => trecho.fim > trecho.inicio);
    g.duracao = t;
    g.interrompido = interrompido;
    this.reais.clear();
    for (const simulado of this.simulados) this.fecharSimulado(simulado);
    this.simulados = [];
    medidorDaPagina.desligar();
    contadoresDoPc.desligar();
    cliente.registrar('teste de desempenho: terminou');
    this.gravacao = null;
    this.mudar({ fase: 'pronto', simulados: [], gravacao: g });
  }
}

function candidatosProntos(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolver) => {
    const pronto = () => {
      if (pc.iceGatheringState !== 'complete') return;
      pc.removeEventListener('icegatheringstatechange', pronto);
      resolver();
    };
    pc.addEventListener('icegatheringstatechange', pronto);
    setTimeout(resolver, 3000); // sem rede nenhuma, segue com o que tiver
  });
}

export const teste = new Teste();
