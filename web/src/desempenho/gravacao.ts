// O teste de desempenho de quem transmite. Dois modos:
// - simulado: um roteiro automático com espectadores criados no próprio PC (conexões WebRTC locais, sem
//   servidor nem internet), passando pelas qualidades e por 1, 3 e 7 espectadores;
// - amigos: grava a transmissão de verdade, com quem estiver assistindo. Cada amigo manda pelo canal de
//   medidas como a imagem chega no PC dele (veja amigos.ts).
// Nos dois, quem assiste de verdade entra na gravação, e o resultado é uma Gravacao (tipos.ts).

import { AJUSTES_DA_TRANSMISSAO, cliente } from '../cliente';
import { noApp, ponte } from '../ponte';
import { QUALIDADES, type Qualidade } from '../qualidade';
import { AmostradorEnvio, AmostradorRecepcao, medidorDaPagina, videoDoStream } from './amostradores';
import { resumirTrecho, type ResumoDoTrecho } from './analise';
import {
  FORMATO,
  type Acontecimento,
  type AmostraCaptura,
  type AmostraEnvio,
  type AmostraPagina,
  type AmostraPc,
  type AmostraRecepcao,
  type AmbienteDoEspectador,
  type Gravacao,
  type Modo,
  type Roteiro,
  type Trecho,
} from './tipos';

/** Os primeiros segundos de cada trecho ficam fora das médias: o WebRTC começa com pouca banda e vai subindo. */
export const SEGUNDOS_DESCARTADOS = 8;

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
  const qualidades = Object.keys(QUALIDADES) as Qualidade[];
  return [
    { nome: 'Aquecimento', segundos: 10, qualidade: sua, espectadores: 1, aquecimento: true },
    ...qualidades.map((q) => ({ nome: rotulo(q), segundos: 35, qualidade: q, espectadores: 1 })),
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
  private readonly reais = new Map<string, { amostrador: AmostradorEnvio; canal: RTCDataChannel | null; avisado: boolean }>();
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

  async iniciar(modo: Modo, roteiro: Roteiro) {
    const e = cliente.ler();
    if (this.estado.fase === 'gravando' || this.estado.fase === 'encerrando') return;
    if (!e.minhaTela) {
      this.mudar({ erro: 'Comece a transmitir o jogo antes de iniciar o teste.' });
      return;
    }
    const etapas = modo === 'simulado' ? etapasDoRoteiro(roteiro, e.qualidade) : [];
    const [video] = e.minhaTela.getVideoTracks();
    this.gravacao = {
      formato: FORMATO,
      modo,
      roteiro: modo === 'simulado' ? roteiro : null,
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
    await ponte?.desempenho?.ligar(true).catch(() => false);
    medidorDaPagina.ligar();
    this.inicio = performance.now();
    this.trechoAtual = null;
    this.anteriores.clear();
    this.mudar({ ...vazio(), fase: 'gravando', modo, roteiro, etapas, notas: etapas.map(() => null) });
    cliente.registrar(`teste de desempenho: começou (${modo}${modo === 'simulado' ? `, ${roteiro}` : ''})`);
    this.anotar('inicio', modo === 'simulado' ? `Teste automático (${roteiro}) começou` : 'Gravação com os amigos começou');
    if (modo === 'simulado') await this.entrarNaEtapa(0);
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
    if (cliente.ler().qualidade !== etapa.qualidade) await cliente.qualidadeTemporaria(etapa.qualidade);
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
        try {
          (evento.receiver as RTCRtpReceiver & { jitterBufferTarget: number | null }).jitterBufferTarget = AJUSTES_DA_TRANSMISSAO.folgaDeRedeMs;
        } catch {
          // o mesmo aviso já aparece nas conexões de verdade
        }
        if (evento.track.kind === 'video') resolver(evento.streams[0]);
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
      if (this.estado.modo === 'amigos') this.trechoDosAmigos();
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

      const amostraDoPc = await this.amostrarPc(t);
      if (amostraDoPc) g.pcAmostras.push(amostraDoPc);

      this.detectar(envios, recepcoes);
      const recentesDosAmigos = g.recepcao.filter((r) => !r.simulado && r.t >= t - 2);
      const ultimoDeCada = new Map<string, AmostraRecepcao>();
      for (const r of recentesDosAmigos) ultimoDeCada.set(r.espectador, r);
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
        agora: { envio: envios, recepcao: [...recepcoes, ...ultimoDeCada.values()], captura, pc: amostraDoPc, pagina: amostraPagina },
        series: {
          mbps: ultimos(s.mbps, media(envios.map((e) => e.mbps))),
          codificacao: ultimos(s.codificacao, media(envios.map((e) => e.msCodificacao))),
          qp: ultimos(s.qp, media(envios.map((e) => e.qp))),
          cpu: ultimos(s.cpu, amostraDoPc?.cpuApp ?? 0),
          placa: ultimos(s.placa, amostraDoPc?.placa3dTotal ?? 0),
        },
      });

      if (this.estado.modo === 'simulado' && t >= this.fimDaEtapa) {
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

  private async amostrarPc(t: number): Promise<AmostraPc | null> {
    const bruta = await ponte?.desempenho?.amostra().catch(() => null);
    if (!bruta) return null;
    const soma = (registro: Record<string, number>) => Object.values(registro).reduce((a, b) => a + b, 0);
    const deVideo = (motores: Record<string, number> | undefined) => {
      if (!motores) return null;
      const valores = Object.entries(motores)
        .filter(([nome]) => /video/i.test(nome) && !/jpeg/i.test(nome))
        .map(([, uso]) => uso);
      return valores.length ? Math.max(...valores) : 0;
    };
    const placa = bruta.placa;
    return {
      t,
      cpuApp: Math.round(soma(Object.fromEntries(Object.entries(bruta.processos).map(([k, v]) => [k, v.cpu]))) * 10) / 10,
      cpuPorProcesso: Object.fromEntries(Object.entries(bruta.processos).map(([k, v]) => [k, v.cpu])),
      memoriaAppMB: soma(Object.fromEntries(Object.entries(bruta.processos).map(([k, v]) => [k, v.memoriaMB]))),
      cpuPc: bruta.cpuDoPc,
      placa3dTotal: placa?.total['3D'] ?? null,
      placaVideoTotal: deVideo(placa?.total),
      placa3dApp: placa ? (placa.doApp['3D'] ?? 0) : null,
      placaVideoApp: placa ? deVideo(placa.doApp) : null,
      placa3dOutros: placa ? (placa.outros['3D'] ?? 0) : null,
      motores: placa?.total ?? null,
      memoriaPlacaMB: placa?.memoriaMB ?? null,
    };
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

  /** Quem começou a assistir entra na gravação; quem saiu, sai. Cada um recebe o pedido de mandar as medidas. */
  private acompanharAmigos() {
    const atuais = cliente.envios();
    for (const envio of atuais) {
      let real = this.reais.get(envio.id);
      if (!real || real.amostrador.pc !== envio.pc) {
        real = { amostrador: new AmostradorEnvio(envio.pc, envio.nome, false), canal: envio.medidas, avisado: false };
        this.reais.set(envio.id, real);
        this.anotar('espectador', `${envio.nome} está assistindo`);
        if (!this.gravacao!.espectadoresReais.some((r) => r.nome === envio.nome)) this.gravacao!.espectadoresReais.push({ nome: envio.nome, ambiente: null });
        this.ouvirAmigo(envio.id, envio.nome, envio.medidas);
      }
      if (!real.avisado && real.canal?.readyState === 'open') {
        real.canal.send(JSON.stringify({ tipo: 'gravar', ligado: true }));
        real.avisado = true;
      }
    }
    for (const [id, real] of this.reais) {
      if (atuais.some((envio) => envio.id === id && envio.pc === real.amostrador.pc)) continue;
      this.reais.delete(id);
      this.anotar('espectador', `${real.amostrador.espectador} parou de assistir`);
    }
  }

  private ouvirAmigo(id: string, nome: string, canal: RTCDataChannel | null) {
    if (!canal) return;
    canal.addEventListener('message', (evento) => {
      if (!this.gravacao || this.estado.fase !== 'gravando' || this.reais.get(id)?.canal !== canal) return;
      let msg: any;
      try {
        msg = JSON.parse(String(evento.data));
      } catch {
        return;
      }
      if (msg?.tipo === 'ambiente') {
        const real = this.gravacao.espectadoresReais.find((r) => r.nome === nome);
        if (real) real.ambiente = msg.ambiente as AmbienteDoEspectador;
      } else if (msg?.tipo === 'recepcao' && msg.amostra) {
        const amostra = { ...(msg.amostra as AmostraRecepcao), t: this.agora(), espectador: nome, simulado: false };
        this.gravacao.recepcao.push(amostra);
        if (amostra.congelamentos > 0) this.anotar('congelamento', `${nome}: imagem congelou ${amostra.msCongelado} ms`);
      }
    });
  }

  /** No modo com os amigos, um trecho novo a cada mudança de qualidade ou de quantas pessoas assistem. */
  private trechoDosAmigos() {
    const { qualidade } = cliente.ler();
    const quantos = this.reais.size;
    const atual = this.trechoAtual;
    if (atual && atual.qualidade === qualidade && atual.espectadores === quantos) {
      atual.fim = this.agora();
      return;
    }
    const nome = `${rotulo(qualidade)} · ${quantos} ${quantos === 1 ? 'amigo' : 'amigos'}`;
    this.abrirTrecho(nome, qualidade);
  }

  /** Encerra a etapa atual agora (o roteiro segue para a próxima no segundo seguinte). */
  pularEtapa() {
    if (this.estado.fase === 'gravando' && this.estado.modo === 'simulado') {
      this.anotar('etapa', 'Etapa pulada pela pessoa');
      this.fimDaEtapa = this.agora();
    }
  }

  /**
   * Para o gráfico ao vivo. No simulado: o intervalo de cada quadro do primeiro espectador (últimos ~10 s).
   * Com os amigos: o pior intervalo de cada segundo, entre todos os amigos (últimos 60 s).
   */
  ritmoAoVivo(): { porQuadro: boolean; valores: number[] } {
    const primeiro = this.simulados[0];
    if (primeiro) return { porQuadro: true, valores: [...primeiro.amostradorRecepcao.ritmo.historico] };
    const g = this.gravacao;
    if (!g) return { porQuadro: false, valores: [] };
    const t = this.agora();
    const pior = new Map<number, number>();
    for (const r of g.recepcao) if (r.t > t - 60 && r.ritmo) pior.set(r.t, Math.max(pior.get(r.t) ?? 0, r.ritmo.maxMs));
    return { porQuadro: false, valores: [...pior.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v) };
  }

  // ===== Fim =====

  async parar() {
    if (this.estado.fase !== 'gravando') return;
    this.anotar('fim', 'Parado pela pessoa');
    await this.encerrar(this.estado.modo === 'simulado');
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
    for (const real of this.reais.values()) {
      if (real.canal?.readyState === 'open') real.canal.send(JSON.stringify({ tipo: 'gravar', ligado: false }));
    }
    this.reais.clear();
    for (const simulado of this.simulados) this.fecharSimulado(simulado);
    this.simulados = [];
    medidorDaPagina.desligar();
    await ponte?.desempenho?.ligar(false).catch(() => false);
    if (cliente.ler().minhaTela && cliente.ler().qualidade !== g.qualidadeDaPessoa) await cliente.qualidadeTemporaria(g.qualidadeDaPessoa);
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
