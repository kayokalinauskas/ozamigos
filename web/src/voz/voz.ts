// A conversa por voz da sala, como um canal de voz do Discord: quem entra na sala já está na conversa.
// Cada par de pessoas tem uma conexão WebRTC só de voz, separada do vídeo: a voz não espera a folga de rede
// que o vídeo segura, e cair ou refazer o vídeo não derruba a conversa.
//
//   microfone → processador (volume, RNNoise, porta) → conexões com cada amigo
//   cada amigo → volume dele → volume de saída → limitador → saída escolhida
//
// Quem chega na sala (ou volta depois de cair) liga para todos os que já estavam: nunca os dois ligam ao mesmo tempo.
// Mudo e surdo de cada um vão direto para os outros, por um canal de dados na própria conexão de voz.

import { criarLimitador } from './limitador';
import type { SinalDeVozParaEnviar, SinalDoServidor } from '../conexao/protocolo';
import { adicionarCandidato, caminhoDaConexao, novaPeerConnection, opusDeVoz } from '../conexao/webrtc';
import urlDoRnnoise from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import urlDoRnnoiseSimd from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import { noApp } from '../ponte';
import { tocar } from '../sons';
import {
  guardarAjustes,
  guardarMudo,
  guardarSilenciadoParaMim,
  guardarSurdo,
  guardarVolumeDaVozDe,
  lerAjustes,
  mudoGuardado,
  silenciadoParaMim,
  surdoGuardado,
  volumeDaVozDe,
  type AjustesDeVoz,
} from './ajustes';
import type { AjustesDoProcessador, MedidaDoProcessador } from './processador';
import { trocaDeImagens } from '../imagens/troca';
import { amostraDe, MedidorDaConexao, type QualidadeDaConexao } from './qualidade';
import urlDoProcessador from './processador.ts?worker&url';

export type Dispositivo = { id: string; nome: string };
export type Microfone = 'ligando' | 'ok' | 'sem-permissao' | 'sem-microfone' | 'erro';

export type EstadoDaVoz = {
  mudo: boolean;
  surdo: boolean;
  microfone: Microfone;
  falando: string[]; // ids de quem está falando agora; eu sou EU
  remotos: Record<string, { mudo: boolean; surdo: boolean }>;
  conexao: Record<string, QualidadeDaConexao>; // a qualidade da conexão com cada amigo (qualidade.ts)
  ajustes: AjustesDeVoz;
  entradas: Dispositivo[];
  saidas: Dispositivo[];
  testando: boolean; // "Testar o microfone": a pessoa se ouve
  apertado: boolean; // apertar para falar: a tecla está apertada (a voz vai)
  rnnoise: boolean; // o RNNoise carregou
  podeEscolherSaida: boolean;
};

/** O que a voz precisa do cliente (sinalização e avisos), sem importar o cliente (que importa a voz). */
export type LigacaoComOCliente = {
  enviar(msg: SinalDeVozParaEnviar): void;
  nomeDe(id: string): string;
  /** O que reconhece a pessoa entre salas e reconexões (a conta): a chave do volume e do silenciado. */
  chaveDe(id: string): string;
  avisar(texto: string, tipo?: 'info' | 'erro'): void;
  registrar(evento: string): void;
};

type ConexaoDeVoz = {
  id: string;
  pc: RTCPeerConnection;
  oferente: boolean; // quem ligou é quem liga de novo se a conexão cair
  pendentes: RTCIceCandidateInit[];
  canal: RTCDataChannel;
  receptor?: RTCRtpReceiver;
  elemento?: HTMLAudioElement;
  fonte?: MediaStreamAudioSourceNode;
  ganho?: GainNode;
  ultimaFala: number;
  tentativas: number;
  medidor: MedidorDaConexao;
  espera?: ReturnType<typeof setTimeout>;
  vigia?: ReturnType<typeof setTimeout>;
};

export const EU = 'eu';
// Acima disso (0 a 1) no último pacote que chegou, o amigo está falando. A porta de quem fala manda silêncio quando ele cala.
const NIVEL_DE_FALA = 0.015;
// O anel de quem fala apaga só depois disso sem fala: sem piscar entre uma palavra e outra.
const ANEL_SEGURA = 250;
const ESPERA_DESCONECTADO = 3_000;
const MEDIR_A_CONEXAO_A_CADA = 2_000;
// Apertar para falar: a voz continua um pouco depois de soltar a tecla, para não cortar o fim da última palavra.
const SEGURA_AO_SOLTAR = 150;
const TENTATIVAS_DE_VOZ = 3;
/**
 * O vigia: uma conexão de voz que não conecta nesse tempo é refeita, como uma que falhou. Sem ele, uma que ficava parada
 * em "conectando" (a combinação entre os dois não terminou: uma mensagem que se perdeu numa reconexão, ou os dois
 * ligando ao mesmo tempo e cada um atendendo a ligação do outro) nunca era refeita, porque só "failed" refazia. Visto
 * pelo dono em 19/10/2026: um amigo falava com outro, mas com ele ficava "conectando…" para sempre. Uma rede que bloqueia
 * de verdade dá "failed" em ~30 s; 20 s é antes disso, mas bem depois de uma conexão normal (~1 s).
 */
const VIGIA_DA_VOZ = 20_000;
// Depois do vigia, um sorteio de até tanto antes de ligar de novo (veja vigiar).
const SORTEIO_DO_VIGIA = 5_000;
const DO_SISTEMA = noApp ? 'do Windows' : 'do sistema'; // no navegador (e no celular), quem escolhe o padrão é o sistema

class Voz {
  private estado: EstadoDaVoz = {
    mudo: mudoGuardado(),
    surdo: surdoGuardado(),
    microfone: 'ligando',
    falando: [],
    remotos: {},
    conexao: {},
    ajustes: lerAjustes(),
    entradas: [],
    saidas: [],
    testando: false,
    apertado: false,
    rnnoise: false,
    podeEscolherSaida: typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype,
  };
  private readonly ouvintes = new Set<() => void>();
  private readonly ouvintesDaMedida = new Set<(m: MedidaDoProcessador) => void>();
  private cliente: LigacaoComOCliente | null = null;
  private ctx: AudioContext | null = null;
  private processador: AudioWorkletNode | GainNode | null = null;
  private destino: MediaStreamAudioDestinationNode | null = null;
  private mestre: GainNode | null = null;
  private monitor: GainNode | null = null;
  private microfone: MediaStream | null = null;
  private microfoneParado = false; // saí da sala: o microfone foi fechado e abre de novo na próxima entrada
  // Cada abertura do microfone tem um número: só a mais recente vale (trocar dois ajustes seguidos abre duas vezes).
  private aberturaDoMicrofone = 0;
  private fonteDoMicrofone: MediaStreamAudioSourceNode | null = null;
  private montagem: Promise<void> | null = null;
  private readonly conexoes = new Map<string, ConexaoDeVoz>();
  private naSala = false;
  private minhaUltimaFala = 0;
  private avisouSemVoz = new Set<string>();
  private soltar: ReturnType<typeof setTimeout> | undefined;

  // ===== Estado para o React =====

  inscrever = (ouvinte: () => void) => {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  };

  ler = () => this.estado;

  private mudar(parcial: Partial<EstadoDaVoz>) {
    this.estado = { ...this.estado, ...parcial };
    this.ouvintes.forEach((ouvinte) => ouvinte());
  }

  /** O volume do microfone 20 vezes por segundo (o medidor da engrenagem), sem redesenhar o resto da tela. */
  ouvirMedida(ouvinte: (m: MedidaDoProcessador) => void) {
    this.ouvintesDaMedida.add(ouvinte);
    return () => void this.ouvintesDaMedida.delete(ouvinte);
  }

  ligar(cliente: LigacaoComOCliente) {
    this.cliente = cliente;
  }

  // ===== Entrar e sair =====

  /**
   * Chamado no clique em Entrar: o navegador só deixa tocar som depois de um gesto da pessoa.
   * O áudio roda a 48 kHz, a taxa do RNNoise e do Opus.
   */
  preparar() {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
      } catch {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
      }
      // Sem gesto (link aberto e entrada automática), o som fica suspenso até o primeiro clique.
      const retomar = () => {
        if (this.ctx?.state === 'suspended') void this.ctx.resume();
      };
      addEventListener('pointerdown', retomar);
      addEventListener('keydown', retomar);
    }
    void this.ctx.resume().catch(() => undefined);
  }

  /** Entrei (ou voltei) na sala: ligo para todos os que já estavam. */
  async entrarNaSala(outros: string[]) {
    this.preparar();
    if (!this.ctx) return;
    this.naSala = true;
    for (const id of [...this.conexoes.keys()]) this.fechar(id);
    this.montagem ??= this.montar();
    await this.montagem;
    if (!this.naSala) return;
    if (this.microfoneParado) {
      this.microfoneParado = false;
      void this.abrirMicrofone();
    }
    for (const id of outros) await this.ligarPara(id);
  }

  /** Alguém saiu da sala (ou caiu): a conversa com essa pessoa acaba. */
  pessoaSaiu(id: string) {
    this.fechar(id);
    const remotos = { ...this.estado.remotos };
    delete remotos[id];
    const conexao = { ...this.estado.conexao };
    delete conexao[id];
    this.mudar({ remotos, conexao, falando: this.estado.falando.filter((outro) => outro !== id) });
  }

  sair() {
    this.naSala = false;
    this.aberturaDoMicrofone++; // um microfone ainda abrindo não fica ligado depois de sair
    for (const id of [...this.conexoes.keys()]) this.fechar(id);
    if (this.microfone) {
      this.microfone.getTracks().forEach((t) => t.stop());
      this.microfoneParado = true;
    }
    this.mudar({ falando: [], remotos: {}, conexao: {}, testando: false });
  }

  // ===== Microfone, fone e ajustes =====

  alternarMudo() {
    const mudo = !this.estado.mudo;
    // Desmutar o microfone com o fone desligado liga os dois, como no Discord.
    const surdo = mudo ? this.estado.surdo : false;
    guardarMudo(mudo);
    guardarSurdo(surdo);
    this.mudar({ mudo, surdo });
    tocar(mudo ? 'mudo' : 'desmudo');
    this.aplicarMudoESurdo();
  }

  /** Apertar para falar: a tecla do atalho foi apertada ou solta (voz/atalhos.ts). Fora desse modo, não faz nada. */
  falar(apertado: boolean) {
    clearTimeout(this.soltar);
    if (!this.estado.ajustes.apertarParaFalar) return;
    if (apertado) {
      if (!this.estado.apertado) this.mudar({ apertado: true });
      this.aplicarMudoESurdo();
      return;
    }
    this.soltar = setTimeout(() => {
      this.mudar({ apertado: false });
      this.aplicarMudoESurdo();
    }, SEGURA_AO_SOLTAR);
  }

  alternarSurdo() {
    const surdo = !this.estado.surdo;
    guardarSurdo(surdo);
    this.mudar({ surdo });
    tocar(surdo ? 'surdo' : 'dessurdo');
    this.aplicarMudoESurdo();
  }

  mudarAjustes(parcial: Partial<AjustesDeVoz>) {
    const antes = this.estado.ajustes;
    const ajustes = { ...antes, ...parcial };
    guardarAjustes(ajustes);
    this.mudar({ ajustes });
    this.enviarAjustesAoProcessador();
    this.aplicarMudoESurdo();
    // Microfone, eco, ganho e a supressão do navegador são do próprio microfone: abre de novo com os novos.
    const doMicrofone = (['entrada', 'cancelarEco', 'ganhoAutomatico'] as const).some((k) => ajustes[k] !== antes[k]);
    const supressaoDoNavegador = (ajustes.supressao === 'navegador') !== (antes.supressao === 'navegador');
    if ((doMicrofone || supressaoDoNavegador) && this.ctx && this.processador) void this.abrirMicrofone();
    if (ajustes.saida !== antes.saida) void this.aplicarSaida();
  }

  alternarTeste() {
    const testando = !this.estado.testando;
    this.mudar({ testando });
    if (this.monitor) this.monitor.gain.value = testando ? 1 : 0;
    this.preparar();
  }

  pararTeste() {
    if (this.estado.testando) this.alternarTeste();
  }

  volumeDe(id: string): number {
    return volumeDaVozDe(this.chaveDe(id));
  }

  silenciadoParaMim(id: string): boolean {
    return silenciadoParaMim(this.chaveDe(id));
  }

  mudarVolumeDe(id: string, volume: number) {
    guardarVolumeDaVozDe(this.chaveDe(id), volume);
    this.aplicarGanhoDe(id);
    this.mudar({}); // o menu do amigo redesenha
  }

  silenciarParaMim(id: string, silenciado: boolean) {
    guardarSilenciadoParaMim(this.chaveDe(id), silenciado);
    this.aplicarGanhoDe(id);
    this.mudar({});
  }

  /** Atualiza a lista de microfones e saídas (os nomes só aparecem depois de liberar o microfone). */
  async atualizarDispositivos() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const todos = await navigator.mediaDevices.enumerateDevices();
    // O Chrome no Windows lista também "default" e "communications": o padrão já é a opção ''.
    const lista = (tipo: MediaDeviceKind) =>
      todos
        .filter((d) => d.kind === tipo && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, nome: d.label || `${tipo === 'audioinput' ? 'Microfone' : 'Saída'} ${i + 1}` }));
    this.mudar({ entradas: lista('audioinput'), saidas: lista('audiooutput') });
  }

  // ===== O áudio =====

  private nomeDe(id: string) {
    return this.cliente?.nomeDe(id) ?? id;
  }

  private chaveDe(id: string) {
    return this.cliente?.chaveDe(id) ?? this.nomeDe(id);
  }

  private async montar() {
    const ctx = this.ctx!;
    // Um limitador antes da caixa de som: vários amigos falando juntos (ou um volume em 200%) não estouram.
    const limitador = criarLimitador(ctx);
    this.mestre = ctx.createGain();
    this.mestre.connect(limitador);
    this.monitor = ctx.createGain();
    this.monitor.gain.value = this.estado.testando ? 1 : 0;
    this.monitor.connect(limitador);
    this.destino = ctx.createMediaStreamDestination();
    try {
      const rnnoise = await carregarRnnoise().catch((erro) => {
        console.error('Não foi possível baixar o RNNoise', erro);
        return null;
      });
      await ctx.audioWorklet.addModule(urlDoProcessador);
      const no = new AudioWorkletNode(ctx, 'ozamigos-voz', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { rnnoise },
      });
      no.port.onmessage = (e: MessageEvent<MedidaDoProcessador>) => this.receberMedida(e.data);
      this.processador = no;
    } catch (erro) {
      // Sem o processador (navegador antigo), a voz funciona igual, só sem tirar o ruído e sem porta.
      console.error('O processador de voz não carregou', erro);
      this.cliente?.registrar('voz: processador não carregou; sem RNNoise e sem porta');
      this.processador = ctx.createGain();
    }
    this.processador.connect(this.destino);
    this.processador.connect(this.monitor);
    this.enviarAjustesAoProcessador();
    this.aplicarMudoESurdo();
    void this.aplicarSaida();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.atualizarDispositivos());
    setInterval(() => this.verQuemFala(), 100);
    setInterval(() => void this.medirConexoes(), MEDIR_A_CONEXAO_A_CADA);
    // Sem esperar: a permissão do microfone pode ficar aberta na tela, e a conversa já pode começar (ouvindo).
    void this.abrirMicrofone();
  }

  private async abrirMicrofone() {
    const ctx = this.ctx;
    if (!ctx || !this.processador || !navigator.mediaDevices?.getUserMedia) {
      this.mudar({ microfone: 'sem-microfone' });
      return;
    }
    const a = this.estado.ajustes;
    const restricoes = (dispositivo: string): MediaTrackConstraints => ({
      ...(dispositivo ? { deviceId: { exact: dispositivo } } : {}),
      echoCancellation: a.cancelarEco,
      noiseSuppression: a.supressao === 'navegador',
      autoGainControl: a.ganhoAutomatico,
      channelCount: 1,
    });
    const vez = ++this.aberturaDoMicrofone;
    let microfone: MediaStream;
    try {
      microfone = await navigator.mediaDevices.getUserMedia({ audio: restricoes(a.entrada) });
    } catch (erro) {
      if (vez !== this.aberturaDoMicrofone) return; // já pediram outro: este erro não importa mais
      const nome = (erro as DOMException).name;
      if (a.entrada && (nome === 'OverconstrainedError' || nome === 'NotFoundError')) {
        // O microfone escolhido sumiu (desconectado): volta para o padrão do Windows.
        this.cliente?.avisar(`O microfone escolhido não está conectado: usando o padrão ${DO_SISTEMA}.`);
        this.mudarAjustes({ entrada: '' });
        return;
      }
      const microfoneEstado: Microfone = nome === 'NotAllowedError' ? 'sem-permissao' : nome === 'NotFoundError' ? 'sem-microfone' : 'erro';
      this.mudar({ microfone: microfoneEstado });
      this.contarMeuEstado();
      this.cliente?.registrar(`voz: microfone indisponível (${nome})`);
      this.cliente?.avisar(
        microfoneEstado === 'sem-permissao'
          ? 'O Ozamigos não tem permissão para usar o microfone: você ouve os amigos, mas eles não te ouvem.'
          : 'Nenhum microfone encontrado: você ouve os amigos, mas eles não te ouvem. Conecte um e escolha na engrenagem.',
        'erro',
      );
      return;
    }
    if (vez !== this.aberturaDoMicrofone) {
      // Uma abertura mais nova (com os ajustes de agora) já está a caminho, ou a pessoa saiu: este fecha.
      microfone.getTracks().forEach((t) => t.stop());
      return;
    }
    this.fonteDoMicrofone?.disconnect();
    this.microfone?.getTracks().forEach((t) => t.stop());
    this.microfone = microfone;
    this.fonteDoMicrofone = ctx.createMediaStreamSource(microfone);
    this.fonteDoMicrofone.connect(this.processador);
    const [trilha] = microfone.getAudioTracks();
    // Desconectaram o microfone no meio da conversa: tenta o padrão do Windows.
    trilha.onended = () => {
      if (this.microfone === microfone && this.naSala) void this.abrirMicrofone();
    };
    this.cliente?.registrar(`voz: microfone "${trilha.label}"`);
    this.mudar({ microfone: 'ok' });
    this.contarMeuEstado();
    void this.atualizarDispositivos();
  }

  private enviarAjustesAoProcessador() {
    if (!(this.processador instanceof AudioWorkletNode)) {
      if (this.processador) (this.processador as GainNode).gain.value = this.estado.ajustes.volumeEntrada / 100;
      return;
    }
    const a = this.estado.ajustes;
    const ajustes: AjustesDoProcessador = {
      ganho: a.volumeEntrada / 100,
      tirarRuido: a.supressao === 'rnnoise',
      automatica: a.sensibilidadeAutomatica,
      limiarDb: a.limiarDb,
      semPorta: a.apertarParaFalar,
    };
    this.processador.port.postMessage(ajustes);
  }

  private aplicarMudoESurdo() {
    const { mudo, surdo, ajustes, apertado } = this.estado;
    // Mudo: a trilha manda silêncio (a conexão continua, e desmutar é na hora). Surdo também muta, como no Discord.
    // Apertar para falar: só com a tecla apertada.
    const trilha = this.destino?.stream.getAudioTracks()[0];
    if (trilha) trilha.enabled = !mudo && !surdo && (!ajustes.apertarParaFalar || apertado);
    if (this.mestre) this.mestre.gain.value = surdo ? 0 : ajustes.volumeSaida / 100;
    this.contarMeuEstado();
  }

  private async aplicarSaida() {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx?.setSinkId) return;
    try {
      await ctx.setSinkId(this.estado.ajustes.saida);
    } catch {
      if (this.estado.ajustes.saida) {
        this.cliente?.avisar(`A saída de áudio escolhida não está conectada: usando a padrão ${DO_SISTEMA}.`);
        this.mudarAjustes({ saida: '' });
      }
    }
  }

  private aplicarGanhoDe(id: string) {
    const c = this.conexoes.get(id);
    if (c?.ganho) c.ganho.gain.value = this.silenciadoParaMim(id) ? 0 : this.volumeDe(id) / 100;
  }

  private receberMedida(medida: MedidaDoProcessador) {
    if (medida.rnnoise !== this.estado.rnnoise) this.mudar({ rnnoise: medida.rnnoise });
    if (medida.aberta) this.minhaUltimaFala = performance.now();
    this.ouvintesDaMedida.forEach((ouvinte) => ouvinte(medida));
  }

  /** Quem está falando: o nível do último pacote de voz de cada amigo, e a porta do meu microfone. */
  private verQuemFala() {
    const agora = performance.now();
    const falando: string[] = [];
    const { mudo, surdo, microfone, ajustes, apertado } = this.estado;
    const vozVai = !mudo && !surdo && microfone === 'ok' && (!ajustes.apertarParaFalar || apertado);
    if (vozVai && agora - this.minhaUltimaFala < ANEL_SEGURA) falando.push(EU);
    for (const c of this.conexoes.values()) {
      const [fonte] = c.receptor?.getSynchronizationSources() ?? [];
      if (fonte && (fonte.audioLevel ?? 0) > NIVEL_DE_FALA && agora - fonte.timestamp < 500) c.ultimaFala = agora;
      if (agora - c.ultimaFala < ANEL_SEGURA && !this.estado.remotos[c.id]?.mudo) falando.push(c.id);
    }
    const antes = this.estado.falando;
    if (falando.length !== antes.length || falando.some((id) => !antes.includes(id))) this.mudar({ falando });
  }

  /** A qualidade da conexão com cada amigo, a cada 2 s. Só redesenha quando algo mudou. */
  private async medirConexoes() {
    const conexao: Record<string, QualidadeDaConexao> = {};
    for (const c of [...this.conexoes.values()]) {
      let relatorio: RTCStatsReport | null = null;
      try {
        relatorio = c.pc.connectionState === 'connected' ? await c.pc.getStats() : null;
      } catch {
        // a conexão fechou no meio da consulta
      }
      if (this.conexoes.get(c.id) !== c) continue;
      conexao[c.id] = c.medidor.medir(relatorio ? amostraDe(c.pc.connectionState, relatorio) : { estado: c.pc.connectionState });
    }
    const antes = this.estado.conexao;
    const mudou =
      Object.keys(conexao).length !== Object.keys(antes).length ||
      Object.entries(conexao).some(([id, q]) => {
        const a = antes[id];
        return !a || a.nivel !== q.nivel || a.idaEVoltaMs !== q.idaEVoltaMs || a.perdaPct !== q.perdaPct || a.jitterMs !== q.jitterMs;
      });
    if (mudou) this.mudar({ conexao });
  }

  // ===== As conexões de voz =====

  private novaConexao(id: string, oferente: boolean): ConexaoDeVoz {
    // As tentativas seguidas passam para a conexão nova: lidas antes de fechar a antiga (senão a conta zerava e
    // uma rede que não deixa conectar fazia ligar de novo para sempre, sem nunca avisar).
    const tentativas = this.conexoes.get(id)?.tentativas ?? 0;
    this.fechar(id);
    const pc = novaPeerConnection('voz');
    // O canal de dados é combinado (mesmo id dos dois lados): não precisa de mais sinalização.
    const canal = pc.createDataChannel('estado', { negotiated: true, id: 0 });
    // As imagens do chat vão num segundo canal da mesma conexão (imagens/troca.ts): direto entre os PCs.
    trocaDeImagens.conectar(id, pc.createDataChannel('imagens', { negotiated: true, id: 1 }), () => pc.sctp?.maxMessageSize);
    const c: ConexaoDeVoz = { id, pc, oferente, pendentes: [], canal, ultimaFala: 0, tentativas, medidor: new MedidorDaConexao() };
    this.conexoes.set(id, c);
    c.vigia = setTimeout(() => this.vigiar(c), VIGIA_DA_VOZ);
    canal.onopen = () => this.contarMeuEstado(c);
    canal.onmessage = (e) => {
      try {
        const { mudo, surdo } = JSON.parse(e.data);
        this.mudar({ remotos: { ...this.estado.remotos, [id]: { mudo: mudo === true, surdo: surdo === true } } });
      } catch {
        // mensagem estranha: ignora
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.cliente?.enviar({ tipo: 'candidato', para: id, canal: 'voz', candidato: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => this.ouvir(c, e);
    pc.onconnectionstatechange = () => {
      if (this.conexoes.get(id) !== c) return;
      this.cliente?.registrar(`voz com ${this.nomeDe(id)}: ${pc.connectionState}`);
      clearTimeout(c.espera);
      if (pc.connectionState === 'connected') {
        void caminhoDaConexao(pc).then((caminho) => caminho && this.cliente?.registrar(`voz com ${this.nomeDe(id)}: ${caminho}`));
        clearTimeout(c.vigia);
        c.tentativas = 0;
        this.avisouSemVoz.delete(id);
      } else if (pc.connectionState === 'failed') {
        this.refazer(c);
      } else if (pc.connectionState === 'disconnected') {
        c.espera = setTimeout(() => this.refazer(c), ESPERA_DESCONECTADO);
      }
    };
    return c;
  }

  /** O som do amigo: entra no volume dele e no volume de saída. */
  private ouvir(c: ConexaoDeVoz, e: RTCTrackEvent) {
    if (!this.ctx || !this.mestre) return;
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    // O Chrome só entrega o som de uma conexão WebRTC ao Web Audio se ele também estiver num elemento de áudio.
    const elemento = new Audio();
    elemento.muted = true;
    elemento.srcObject = stream;
    void elemento.play().catch(() => undefined);
    const fonte = this.ctx.createMediaStreamSource(stream);
    const ganho = this.ctx.createGain();
    fonte.connect(ganho).connect(this.mestre);
    Object.assign(c, { receptor: e.receiver, elemento, fonte, ganho });
    this.aplicarGanhoDe(c.id);
  }

  private fechar(id: string) {
    const c = this.conexoes.get(id);
    if (!c) return;
    clearTimeout(c.espera);
    clearTimeout(c.vigia);
    trocaDeImagens.desconectar(id);
    c.pc.close();
    c.fonte?.disconnect();
    c.ganho?.disconnect();
    if (c.elemento) c.elemento.srcObject = null;
    this.conexoes.delete(id);
  }

  private async ligarPara(id: string) {
    const c = this.novaConexao(id, true);
    c.pc.addTransceiver(this.minhaTrilha() ?? 'audio', { direction: 'sendrecv' });
    const oferta = await c.pc.createOffer();
    const descricao: RTCSessionDescriptionInit = { type: 'offer', sdp: opusDeVoz(oferta.sdp ?? '') };
    await c.pc.setLocalDescription(descricao);
    this.cliente?.enviar({ tipo: 'oferta', para: id, canal: 'voz', sdp: descricao });
  }

  /**
   * O vigia disparou: a conexão não conectou a tempo. Este lado liga de novo, tenha ele ligado ou atendido, depois de
   * um sorteio de até SORTEIO_DO_VIGIA: os vigias dos dois lados disparam quase juntos, e o primeiro a ligar troca a
   * conexão do outro (que então desiste: a dele já não é a atual). Sem o sorteio, as duas ligações se cruzariam de novo.
   * Uma ligação que se perdeu no caminho deixa só um lado com conexão (o outro nem a recebeu): esse liga sozinho.
   */
  private vigiar(c: ConexaoDeVoz) {
    if (this.conexoes.get(c.id) !== c || !this.naSala || c.pc.connectionState === 'connected') return;
    this.cliente?.registrar(`voz com ${this.nomeDe(c.id)}: não conectou em ${VIGIA_DA_VOZ / 1000} s (${c.pc.connectionState})`);
    c.vigia = setTimeout(() => {
      if (this.conexoes.get(c.id) !== c || c.pc.connectionState === 'connected') return;
      this.refazer(c, true);
    }, Math.random() * SORTEIO_DO_VIGIA);
  }

  /** A conexão caiu: quem ligou liga de novo (até 3 vezes seguidas); o outro lado espera a ligação nova. */
  private refazer(c: ConexaoDeVoz, peloVigia = false) {
    if (this.conexoes.get(c.id) !== c || !this.naSala || (!c.oferente && !peloVigia)) return;
    if (!peloVigia && c.pc.connectionState !== 'failed' && c.pc.connectionState !== 'disconnected') return;
    if (c.tentativas >= TENTATIVAS_DE_VOZ) {
      if (!this.avisouSemVoz.has(c.id)) {
        this.avisouSemVoz.add(c.id);
        this.cliente?.avisar(
          `Não foi possível ligar a voz com ${this.nomeDe(c.id)}. A rede de um de vocês pode estar bloqueando a conexão.`,
          'erro',
        );
      }
      return;
    }
    c.tentativas++;
    this.cliente?.registrar(`refazendo a voz com ${this.nomeDe(c.id)} (tentativa ${c.tentativas})`);
    void this.ligarPara(c.id);
  }

  async tratarSinal(msg: SinalDoServidor) {
    if (!this.naSala) return;
    if (msg.tipo === 'oferta') {
      await this.montagem;
      const c = this.novaConexao(msg.de, false);
      await c.pc.setRemoteDescription(msg.sdp);
      const [transceptor] = c.pc.getTransceivers();
      if (transceptor) {
        transceptor.direction = 'sendrecv';
        await transceptor.sender.replaceTrack(this.minhaTrilha());
      }
      await this.aplicarPendentes(c);
      const resposta = await c.pc.createAnswer();
      const descricao: RTCSessionDescriptionInit = { type: 'answer', sdp: opusDeVoz(resposta.sdp ?? '') };
      await c.pc.setLocalDescription(descricao);
      this.cliente?.enviar({ tipo: 'resposta', para: msg.de, canal: 'voz', sdp: descricao });
    } else if (msg.tipo === 'resposta') {
      const c = this.conexoes.get(msg.de);
      if (!c || c.pc.signalingState !== 'have-local-offer') return;
      await c.pc.setRemoteDescription(msg.sdp);
      await this.aplicarPendentes(c);
    } else {
      const c = this.conexoes.get(msg.de);
      if (!c) return;
      if (c.pc.remoteDescription) await adicionarCandidato(c.pc, msg.candidato);
      else c.pendentes.push(msg.candidato);
    }
  }

  private async aplicarPendentes(c: ConexaoDeVoz) {
    for (const candidato of c.pendentes) await adicionarCandidato(c.pc, candidato);
    c.pendentes = [];
  }

  private minhaTrilha(): MediaStreamTrack | null {
    return this.destino?.stream.getAudioTracks()[0] ?? null;
  }

  /** Conta aos amigos (ou a um, quando a conexão abre) se estou mudo ou surdo. */
  private contarMeuEstado(so?: ConexaoDeVoz) {
    const texto = JSON.stringify({ mudo: this.estado.mudo || this.estado.microfone !== 'ok', surdo: this.estado.surdo });
    for (const c of so ? [so] : this.conexoes.values()) {
      if (c.canal.readyState === 'open') c.canal.send(texto);
    }
  }

  /** Para o relatório: quantas conexões de voz e em que estado. */
  resumo(): string {
    return [...this.conexoes.values()].map((c) => `${this.nomeDe(c.id)}: ${c.pc.connectionState}`).join(', ');
  }
}

/** O binário do RNNoise, na versão com SIMD (mais rápida) quando o navegador tem. */
async function carregarRnnoise(): Promise<ArrayBuffer> {
  const simd = await fetch(urlDoRnnoiseSimd).then((r) => r.arrayBuffer());
  if (WebAssembly.validate(simd)) return simd;
  return fetch(urlDoRnnoise).then((r) => r.arrayBuffer());
}

export const voz = new Voz();
