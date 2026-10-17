// O núcleo do app, sem nada de interface: a sala (quem está, quem transmite, quem assiste) e as conexões de vídeo.
// Os componentes React só leem o estado (via useCliente) e chamam as ações. As peças ficam em conexao/:
//   sinalizacao.ts  o WebSocket com o servidor, com reconexão     protocolo.ts  as mensagens, com tipo
//   captura.ts      a captura da tela e o codificador             webrtc.ts     ajustes do WebRTC
//   medidor.ts      as estatísticas de cada segundo               relatorio.ts  o relatório da sessão

import { lembrado, lembrar } from './armazenamento';
import { QUALIDADE, QUALIDADES, type Qualidade } from './qualidade';
import { notificacaoLigada, type TipoDeNotificacao } from './notificacoes';
import { tocar } from './sons';
import { noApp, ponte, resultadoDaUltimaEscolha, seletorCarregando } from './ponte';
import { pararSomDoApp, trilhaDoSomDoApp } from './somDoApp';
import { voz } from './voz/voz';
import { FOLGA, FolgaAdaptativa } from './folga';
import { LIMITE_POR_SALA, codigoValido, novoCodigo } from './conexao/codigoDaSala';
import {
  FPS_MINIMO_DA_CAPTURA,
  capturarDoNavegador,
  codificacao,
  descreverFonte,
  montarEnvio,
  tamanhoDaCaptura,
  type Fonte,
} from './conexao/captura';
import { Medidor, type Metrica } from './conexao/medidor';
import type { Canal, MensagemDoServidor, MensagemParaOServidor, MotivoDoErro, Pessoa } from './conexao/protocolo';
import { Relatorio } from './conexao/relatorio';
import { Sinalizacao } from './conexao/sinalizacao';
import {
  SERVIDORES_ICE,
  adicionarCandidato,
  aquecerWebRtc,
  definirFolga,
  novaPeerConnection,
  opusEstereo,
} from './conexao/webrtc';

export type Aviso = {
  id: number;
  texto: string;
  tipo: 'info' | 'erro';
  acao?: { rotulo: string; executar: () => void };
};

export type Estado = {
  fase: 'entrada' | 'entrando' | 'sala';
  erro: string;
  sala: string;
  meuId: string | null;
  meuNome: string;
  pessoas: Pessoa[]; // as outras pessoas, na ordem em que entraram
  transmitindo: string[]; // quem está transmitindo agora (inclusive eu)
  plateias: Record<string, string[]>; // quem transmite -> quem assiste
  assistindo: string[]; // quem eu escolhi assistir (continua valendo se a pessoa parar e voltar)
  videos: Record<string, MediaStream>; // o que chega de cada pessoa que eu assisto
  minhaTela: MediaStream | null;
  qualidade: Qualidade; // sempre a mesma (qualidade.ts): fica no estado para os relatórios
  metricas: Record<string, Metrica>; // `${canal}:${id}` -> medição
  avisos: Aviso[];
  conexaoPerdida: boolean; // caiu a conexão com o servidor; o cliente já está tentando voltar sozinho
  gravacaoDaSala: { id: string; nome: string } | null; // quem está gravando as estatísticas da sala (Ctrl+Shift+G)
  chat: MensagemDoChat[]; // o que chegou desde que entrei; quem entra depois não vê o que foi dito antes
  chatAberto: boolean;
  chatNaoLidas: number;
};

type Conexao = { pc: RTCPeerConnection; pendentes: RTCIceCandidateInit[]; canal: Canal; id: string };

/** Uma mensagem do chat da sala. O nome é guardado na chegada: a pessoa pode sair da sala depois. */
export type MensagemDoChat = { numero: number; de: string; nome: string; texto: string; momento: number; minha: boolean };

/** O mesmo limite do servidor (SinalizacaoHandler.CHAT_MAXIMO): acima disso, ele corta. */
export const LIMITE_DO_CHAT = 500;
// O mesmo freio do servidor (CHAT_RAJADA e CHAT_JANELA_MS): conferido antes de mandar, a mensagem fica no campo.
const CHAT_RAJADA = 5;
const CHAT_JANELA = 3_000;
// O chat não fica guardado em lugar nenhum: só as últimas mensagens desta sessão, na memória da página.
const MENSAGENS_NA_TELA = 200;

const chave = (canal: Canal, id: string) => `${canal}:${id}`;

// Sem nenhuma mensagem do servidor por esse tempo (o pong chega a cada 30 s), a conexão está morta.
const SILENCIO_MAXIMO = 70_000;
// Quem volta dentro desse tempo com o mesmo nome é tratado como a mesma pessoa reconectando.
const JANELA_DE_VOLTA = 120_000;
// Conexão de vídeo "desconectada" por mais que isso é refeita (antes ficava congelada até desistir).
const ESPERA_DESCONECTADO = 2_000;
// Cada pessoa nova começa recebendo com metade do bitrate da qualidade, e o resto vem depois desse tempo. O codificador
// da placa passa do alvo no começo (9 Mbps pedindo 4, num teste com a AMD) enquanto o WebRTC ainda mede a rede: o excesso
// enchia a fila de envio e a imagem congelava 3 ou 4 vezes nos primeiros segundos.
const BITRATE_INICIAL = 0.5;
const SUBIR_BITRATE_DEPOIS = 6_000;

// Recusas do servidor que mandam a pessoa de volta para a tela de entrada, com o motivo.
const RECUSAS: Partial<Record<MotivoDoErro, string>> = {
  'senha-errada': 'Senha errada. Confira com quem mandou o link.',
  'muitas-tentativas': 'Muitas senhas erradas seguidas deste endereço. Espere 5 minutos e tente de novo.',
  'sala-cheia': `A sala está cheia (máximo de ${LIMITE_POR_SALA} pessoas).`,
  'codigo-invalido': 'Código de sala inválido: use de 6 a 20 letras e números.',
};

/** Os ajustes de transmissão desta versão, como estão no código: vão no relatório do teste de desempenho. */
export const AJUSTES_DA_TRANSMISSAO = {
  servidoresIce: SERVIDORES_ICE.map((s) => s.urls).flat(),
  turn: false,
  topologia: 'malha P2P: uma RTCPeerConnection e uma codificação por pessoa assistindo',
  codecPreferido: 'H264 (setCodecPreferences), depois os outros',
  folgaDeRedeMs: FOLGA.inicial,
  folgaDeRede: `adaptativa por conexão, só no vídeo (web/src/folga.ts): começa em ${FOLGA.inicial} ms, fica entre ${FOLGA.minima} e ${FOLGA.maxima} ms; sobe com o jitter e a cada congelamento, desce devagar com a rede calma. O som da transmissão fica com o ajuste automático do WebRTC`,
  bitrateInicial: `${BITRATE_INICIAL * 100}% do bitrate da qualidade nos primeiros ${SUBIR_BITRATE_DEPOIS / 1000} s de cada pessoa nova`,
  fpsMinimoDaCaptura: FPS_MINIMO_DA_CAPTURA,
  contentHint: 'motion',
  bundlePolicy: 'max-bundle',
  audio: 'Opus estéreo até 128 kbps, sem cancelamento de eco/ruído',
  escalaNoCodificador: 'scaleResolutionDownBy 1 (a captura já sai no tamanho da qualidade)',
  quandoFaltaBanda: 'degradationPreference maintain-resolution: o WebRTC baixa o fps e a nitidez de cada conexão sozinho, por pessoa assistindo; a resolução fica em 720p',
  somDaTransmissao: 'em outro MediaStream que o vídeo: quem assiste não sincroniza os dois, e a imagem não espera o som',
};

/** Uma conexão de vídeo com alguém da sala: quem me assiste (envio) ou quem eu assisto (recebimento). */
export type Ligacao = { id: string; nome: string; pc: RTCPeerConnection };

class Cliente {
  private estado: Estado;
  private readonly ouvintes = new Set<() => void>();
  private readonly sinalizacao = new Sinalizacao({
    aoAbrir: () => this.enviar({ tipo: 'entrar', sala: this.estado.sala, senha: this.senha, nome: this.nome, ficha: this.ficha }),
    aoReceber: (msg) => this.tratar(msg),
    aoFechar: () => this.conexaoFechou(),
  });
  private readonly conexoes = new Map<string, Conexao>();
  private recusado = false;
  private nome = '';
  private senha = '';
  private ficha = ''; // dada pelo servidor; na reconexão, prova que somos a mesma pessoa
  // Nome de quem saiu -> quando, e se eu assistia. Quem volta ganha outro id: o nome é o que liga.
  private readonly saidas = new Map<string, { momento: number; assistia: boolean }>();
  private proximoAviso = 1;
  private proximaMensagem = 1;
  private avisoDoChat: { de: string; aviso: number } | null = null; // o aviso da última mensagem, enquanto na tela
  private envioDoChat: number[] = []; // quando mandei as últimas mensagens (o freio)
  private avisoDoFreio: number | null = null;
  private readonly tentativasDeVideo = new Map<string, number>(); // id -> conexões de vídeo refeitas seguidas
  private readonly folgas = new Map<string, FolgaAdaptativa>(); // quem eu assisto -> folga de rede (folga.ts)
  private readonly relatorioDaSessao = new Relatorio();
  private readonly medidor = new Medidor((id, pc, jitter, congelamentos) => this.ajustarFolga(id, pc, jitter, congelamentos));
  private medindo = false;
  // Conexões de envio que não são de ninguém da sala: os espectadores simulados do teste de desempenho.
  private readonly enviosExtras = new Set<RTCPeerConnection>();
  /** Quem grava as estatísticas da sala recebe aqui as medidas de cada pessoa (desempenho/gravadorDaSala.ts). */
  aoReceberMedidas: ((de: string, pacote: unknown) => void) | null = null;
  /** O servidor recusou começar a gravação: outra pessoa já grava. */
  aoRecusarGravacao: (() => void) | null = null;

  /** A página abriu num link de sala (o que um amigo mandou), e não na entrada com uma sala nova sorteada. */
  readonly veioDeUmLink: boolean;

  constructor() {
    const daUrl = new URLSearchParams(location.search).get('sala');
    this.veioDeUmLink = Boolean(daUrl && codigoValido(daUrl));
    const sala = daUrl && codigoValido(daUrl) ? daUrl : novoCodigo();
    lembrar('ozamigos-qualidade', ''); // a escolha de qualidade saiu (14/10/2026): o que estava guardado não serve mais
    this.estado = {
      fase: 'entrada',
      erro: '',
      sala,
      meuId: null,
      meuNome: lembrado('ozamigos-nome'),
      pessoas: [],
      transmitindo: [],
      plateias: {},
      assistindo: [],
      videos: {},
      minhaTela: null,
      qualidade: QUALIDADE,
      chat: [],
      chatAberto: false,
      chatNaoLidas: 0,
      metricas: {},
      avisos: [],
      conexaoPerdida: false,
      gravacaoDaSala: null,
    };
    this.trocarSala(sala);
    // Um "estou aqui" a cada 30 s: sem isso, proxies e hospedagens gratuitas fecham a conexão parada.
    setInterval(() => {
      if (!this.sinalizacao.aberta || this.estado.fase !== 'sala') return;
      // Uma rede que caiu de vez pode deixar o WebSocket "aberto" por minutos: o silêncio denuncia.
      if (this.sinalizacao.silencio() > SILENCIO_MAXIMO) {
        this.perderConexao();
        return;
      }
      this.enviar({ tipo: 'ping' });
    }, 30_000);
    // Voltou a internet: tenta reconectar agora, sem esperar a próxima tentativa.
    addEventListener('online', () => {
      if (this.estado.conexaoPerdida) this.reconectar();
    });
    // Voltou para a janela com o chat aberto: as mensagens que chegaram enquanto isso já estão à vista.
    addEventListener('focus', () => {
      if (this.estado.chatAberto && this.estado.chatNaoLidas > 0) this.mudar({ chatNaoLidas: 0 });
    });
    // No celular, o navegador congela a página em segundo plano e a conexão cai sem avisar. Ao voltar para ela, confere
    // na hora: sem isso, a pessoa via "Sem conexão" por até 10 s (ou 70 s, até o silêncio denunciar a queda).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || this.estado.fase !== 'sala') return;
      if (this.estado.conexaoPerdida) this.reconectar();
      else if (this.sinalizacao.silencio() > 35_000) this.perderConexao(); // o pong chega a cada 30 s: está muda
    });
    setInterval(() => void this.medir(), 1000);
    voz.ligar({
      enviar: (msg) => this.enviar(msg),
      nomeDe: (id) => this.nomeDe(id),
      avisar: (texto, tipo) => this.avisar(texto, tipo),
      registrar: (evento) => this.registrar(evento),
    });
  }

  // ===== Estado para o React =====

  inscrever = (ouvinte: () => void) => {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  };

  ler = () => this.estado;

  private mudar(parcial: Partial<Estado>) {
    this.estado = { ...this.estado, ...parcial };
    this.ouvintes.forEach((ouvinte) => ouvinte());
  }

  nomeDe(id: string): string {
    if (id === this.estado.meuId) return 'Você';
    return this.estado.pessoas.find((p) => p.id === id)?.nome ?? 'Amigo';
  }

  /** O nome como os outros veem (o meu também), para relatórios. */
  nomeReal(id: string): string {
    return id === this.estado.meuId ? this.estado.meuNome || 'Eu' : this.nomeDe(id);
  }

  // ===== Avisos (os "toasts" do canto da tela) =====

  avisar(texto: string, tipo: Aviso['tipo'] = 'info', acao?: Aviso['acao']) {
    this.registrar(tipo === 'erro' ? `erro: ${texto}` : texto); // todo aviso da tela também vai para o relatório
    this.mostrarAviso(texto, tipo, acao);
  }

  /** O aviso na tela, sem ir para o relatório (as mensagens do chat não vão: o relatório é para diagnóstico). */
  private mostrarAviso(texto: string, tipo: Aviso['tipo'] = 'info', acao?: Aviso['acao']): number {
    const aviso: Aviso = { id: this.proximoAviso++, texto, tipo, acao };
    this.mudar({ avisos: [...this.estado.avisos, aviso].slice(-4) });
    setTimeout(() => this.dispensar(aviso.id), acao ? 10_000 : 5_000);
    return aviso.id;
  }

  dispensar(id: number) {
    this.mudar({ avisos: this.estado.avisos.filter((a) => a.id !== id) });
  }

  // ===== Relatório (para entender depois o que aconteceu numa sessão com os amigos) =====

  registrar(evento: string) {
    this.relatorioDaSessao.registrar(evento);
  }

  /** Tudo o que foi medido e aconteceu nesta sessão, com o contexto para ler depois. */
  relatorio() {
    return {
      geradoEm: new Date().toISOString(),
      sala: this.estado.sala,
      eu: this.estado.meuNome,
      app: noApp ? `app ${ponte?.versao ?? '?'}` : 'navegador',
      navegador: navigator.userAgent,
      tela: `${screen.width}x${screen.height} @${devicePixelRatio}`,
      qualidade: this.estado.qualidade,
      transmitindo: this.estado.minhaTela ? this.descreverFonte() : null,
      linhas: this.relatorioDaSessao.linhas,
    };
  }

  /** Notificação do Windows, só quando a janela não está em foco (senão o aviso na tela basta) e se o tipo está ligado. */
  private notificar(tipo: TipoDeNotificacao, titulo: string, corpo: string) {
    if (document.hasFocus() || !notificacaoLigada(tipo)) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification(titulo, { body: corpo, silent: true });
    } catch {
      // sem notificações: o aviso na tela continua lá
    }
  }

  // ===== Entrada =====

  trocarSala(codigo: string) {
    if (!codigoValido(codigo)) return;
    history.replaceState(null, '', `?sala=${codigo}`);
    this.mudar({ sala: codigo });
  }

  entrar(nome: string, senha: string) {
    if (this.estado.fase !== 'entrada') return; // dois cliques abririam duas conexões (uma "pessoa fantasma")
    this.recusado = false;
    this.nome = nome;
    this.senha = senha;
    this.ficha = '';
    this.mudar({ fase: 'entrando', erro: '', meuNome: nome.trim() || 'Amigo' });
    voz.preparar(); // no clique: o navegador só deixa tocar som depois de um gesto
    this.sinalizacao.conectar();
  }

  private conexaoFechou() {
    if (this.recusado) return;
    if (this.estado.fase === 'sala') {
      this.perderConexao();
    } else {
      this.mudar({ fase: 'entrada', erro: 'Não foi possível falar com o servidor. Se ele estava dormindo, espere 1 minuto e tente de novo.' });
    }
  }

  // ===== Reconexão =====

  /**
   * Caiu a conexão com o servidor. As transmissões já abertas continuam (o vídeo não passa por ele),
   * e o cliente tenta voltar sozinho. Ao voltar, refaz as conexões e retoma o que estava assistindo.
   */
  private perderConexao() {
    if (!this.estado.conexaoPerdida) {
      this.registrar('caiu a conexão com o servidor');
      this.sinalizacao.zerarEsperas();
      this.mudar({ conexaoPerdida: true });
    }
    this.sinalizacao.tentarDeNovo();
  }

  /** Tenta agora. Se não der, a conexão fecha e a próxima tentativa é agendada sozinha. */
  reconectar() {
    if (this.recusado || this.estado.fase !== 'sala') return;
    this.sinalizacao.reconectarAgora();
  }

  /** De volta ao servidor, com um id novo: as conexões antigas não servem mais e são refeitas. */
  private voltei(msg: Extract<MensagemDoServidor, { tipo: 'bem-vindo' }>) {
    for (const id of this.estado.assistindo) this.lembrarSaida(this.nomeDe(id), true);
    for (const { canal, id } of [...this.conexoes.values()]) this.fecharConexao(canal, id);
    this.sinalizacao.zerarEsperas();
    this.mudar({
      meuId: msg.id,
      pessoas: msg.outros,
      transmitindo: msg.compartilhando,
      plateias: msg.plateias ?? {},
      assistindo: [],
      videos: {},
      conexaoPerdida: false,
      gravacaoDaSala: msg.gravando ?? null,
    });
    if (this.estado.minhaTela) this.enviar({ tipo: 'comecei' }); // continuo transmitindo, agora com o id novo
    void voz.entrarNaSala(msg.outros.map((p) => p.id)); // a voz também é refeita, com o id novo
    for (const id of msg.compartilhando) {
      if (this.voltandoQuemEuAssistia(id)) this.assistir(id);
    }
    this.avisar('Conexão com o servidor restabelecida');
  }

  private lembrarSaida(nome: string, assistia: boolean) {
    this.saidas.set(nome, { momento: Date.now(), assistia });
  }

  /** Quem saiu há pouco com esse nome, ou null. */
  private saidaRecente(nome: string) {
    const saida = this.saidas.get(nome);
    if (saida && Date.now() - saida.momento < JANELA_DE_VOLTA) return saida;
    this.saidas.delete(nome);
    return null;
  }

  /** É alguém que eu assistia, caiu e voltou com outro id? Responde uma vez só. */
  private voltandoQuemEuAssistia(id: string): boolean {
    const nome = this.nomeDe(id);
    if (!this.saidaRecente(nome)?.assistia) return false;
    this.saidas.delete(nome);
    return true;
  }

  /** Sai da sala e volta para a entrada: na mesma sala do link, ou em outra (um convite aceito). */
  sair(paraASala?: string) {
    this.recusado = true;
    this.pararDeTransmitir(false);
    this.conexoes.forEach(({ pc }) => pc.close());
    voz.sair();
    this.sinalizacao.encerrar();
    if (paraASala) location.assign(`?sala=${paraASala}`);
    else location.reload(); // volta para a entrada, com a mesma sala no link
  }

  /**
   * Um convite para uma sala (link ozamigos:// aberto com o app aberto). Na entrada, a sala do convite entra no campo.
   * Já numa sala, não tira ninguém da conversa sem perguntar: um aviso com "Entrar" leva para a sala nova.
   */
  abrirConvite(codigo: string) {
    if (!codigoValido(codigo)) return;
    const { fase, sala } = this.estado;
    if (fase === 'entrada') {
      this.trocarSala(codigo);
    } else if (fase === 'sala' && codigo !== sala) {
      this.avisar(`Convite para a sala ${codigo}.`, 'info', { rotulo: 'Entrar', executar: () => this.sair(codigo) });
    }
  }

  private enviar(msg: MensagemParaOServidor) {
    this.sinalizacao.enviar(msg);
  }

  private async tratar(msg: MensagemDoServidor) {
    const e = this.estado;
    switch (msg.tipo) {
      case 'bem-vindo': {
        this.ficha = msg.ficha ?? '';
        if (e.fase === 'sala') {
          this.voltei(msg);
          break;
        }
        this.registrar(`entrei na sala ${this.estado.sala} como ${this.estado.meuNome}`);
        lembrar('ozamigos-nome', this.nome);
        lembrar('ozamigos-senha', this.senha);
        this.mudar({
          fase: 'sala',
          meuId: msg.id,
          pessoas: msg.outros,
          transmitindo: msg.compartilhando,
          plateias: msg.plateias ?? {},
          gravacaoDaSala: msg.gravando ?? null,
        });
        if (msg.gravando) this.avisar(`${msg.gravando.nome} está gravando as estatísticas da sala: o Ozamigos manda para essa pessoa como as transmissões chegam aqui.`);
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          void Notification.requestPermission().catch(() => undefined);
        }
        aquecerWebRtc();
        void voz.entrarNaSala(msg.outros.map((p) => p.id)); // quem chega liga a voz para todos
        break;
      }
      case 'entrou': {
        this.mudar({ pessoas: [...e.pessoas, { id: msg.id, nome: msg.nome }] });
        const saida = this.saidaRecente(msg.nome);
        if (saida) {
          this.avisar(`${msg.nome} reconectou`); // caiu e voltou: sem som nem notificação
          if (!saida.assistia) this.saidas.delete(msg.nome);
          break;
        }
        this.avisar(`${msg.nome} entrou na sala`);
        this.notificar('entrou', 'Ozamigos', `${msg.nome} entrou na sala`);
        tocar('entrou');
        break;
      }
      case 'saiu': {
        const nomeQueSaiu = this.nomeDe(msg.id);
        this.lembrarSaida(nomeQueSaiu, e.assistindo.includes(msg.id));
        this.fecharConexao('envio', msg.id);
        this.fecharConexao('recebimento', msg.id);
        voz.pessoaSaiu(msg.id);
        const plateias = { ...e.plateias };
        delete plateias[msg.id];
        this.mudar({
          pessoas: this.estado.pessoas.filter((p) => p.id !== msg.id),
          transmitindo: e.transmitindo.filter((id) => id !== msg.id),
          assistindo: e.assistindo.filter((id) => id !== msg.id),
          plateias,
        });
        this.avisar(`${nomeQueSaiu} saiu da sala`);
        tocar('saiu');
        break;
      }
      case 'pode-compartilhar':
        if (!e.minhaTela || !e.meuId) break; // parei antes de o servidor responder
        this.mudar({
          transmitindo: [...e.transmitindo.filter((id) => id !== e.meuId), e.meuId],
          plateias: { ...e.plateias, [e.meuId]: [] },
        });
        break;
      case 'compartilhando': {
        this.mudar({
          transmitindo: [...e.transmitindo.filter((id) => id !== msg.id), msg.id],
          plateias: { ...e.plateias, [msg.id]: [] },
        });
        const nomeDeQuem = this.nomeDe(msg.id);
        tocar('aoVivo');
        if (e.assistindo.includes(msg.id)) {
          // Eu já assistia essa pessoa antes de ela parar: volto a assistir sozinho.
          this.enviar({ tipo: 'assistir', para: msg.id });
          this.avisar(`${nomeDeQuem} voltou a transmitir`);
        } else if (this.voltandoQuemEuAssistia(msg.id)) {
          this.assistir(msg.id); // caiu e voltou com outro id: continuo assistindo
        } else {
          this.avisar(`${nomeDeQuem} começou a transmitir`, 'info', {
            rotulo: 'Assistir',
            executar: () => this.assistir(msg.id),
          });
        }
        this.notificar('transmissao', 'Ozamigos', `${nomeDeQuem} começou a transmitir`);
        break;
      }
      case 'parou': {
        this.fecharConexao('recebimento', msg.id);
        const plateias = { ...e.plateias };
        delete plateias[msg.id];
        this.mudar({ transmitindo: e.transmitindo.filter((id) => id !== msg.id), plateias });
        break;
      }
      case 'plateia':
        this.mudar({ plateias: { ...e.plateias, [msg.id]: msg.ids } });
        break;
      case 'assistir':
        // Alguém clicou em "Assistir" na minha transmissão: abro uma conexão só para essa pessoa.
        if (e.minhaTela) await this.enviarOferta(msg.de);
        break;
      case 'deixar':
        this.fecharConexao('envio', msg.de);
        break;
      case 'oferta':
      case 'resposta':
      case 'candidato':
        if (msg.canal === 'voz') await voz.tratarSinal(msg);
        else await this.tratarSinalDeVideo(msg);
        break;
      case 'gravacao-da-sala': {
        const minha = msg.id === e.meuId;
        if (msg.ligada) {
          this.mudar({ gravacaoDaSala: { id: msg.id, nome: msg.nome ?? this.nomeDe(msg.id) } });
          if (!minha && e.gravacaoDaSala?.id !== msg.id) {
            this.avisar(`${this.nomeDe(msg.id)} começou a gravar as estatísticas da sala: o Ozamigos manda para essa pessoa como as transmissões chegam aqui. Você não precisa fazer nada.`);
          }
        } else if (e.gravacaoDaSala?.id === msg.id) {
          this.mudar({ gravacaoDaSala: null });
          if (!minha) this.avisar(`${e.gravacaoDaSala.nome} terminou a gravação das estatísticas da sala.`);
        }
        break;
      }
      case 'medidas':
        this.aoReceberMedidas?.(msg.de, msg.pacote);
        break;
      case 'chat':
        this.receberMensagem(msg.de, msg.texto);
        break;
      case 'erro':
        if (msg.motivo === 'chat-rapido-demais') {
          this.avisarFreioDoChat(); // raro: o freio daqui já segura antes, mas o relógio dos dois lados difere um pouco
          break;
        }
        if (msg.motivo === 'sala-ja-gravando') {
          this.aoRecusarGravacao?.();
          this.avisar(`${e.gravacaoDaSala?.nome ?? 'Outra pessoa'} já está gravando as estatísticas desta sala.`, 'erro');
          break;
        }
        this.tratarErro(msg.motivo);
        break;
      case 'pong':
        break; // só mostra que o servidor ainda ouve (a Sinalizacao já anotou a hora)
      default:
        msg satisfies never; // uma mensagem nova no protocolo.ts precisa de um caso aqui
    }
  }

  private async tratarSinalDeVideo(msg: Extract<MensagemDoServidor, { tipo: 'oferta' | 'resposta' | 'candidato' }>) {
    if (msg.tipo === 'oferta') await this.receberOferta(msg.de, msg.sdp);
    else if (msg.tipo === 'resposta') await this.receberResposta(msg.de, msg.sdp);
    // O canal vem do ponto de vista de quem mandou: o "envio" dele é o meu "recebimento".
    else await this.receberCandidato(msg.de, msg.canal === 'envio' ? 'recebimento' : 'envio', msg.candidato);
  }

  private tratarErro(motivo: MotivoDoErro) {
    // Um sinal para quem acabou de sair: a saída já cuida de fechar a conexão.
    if (motivo === 'destinatario-nao-esta-na-sala') return;
    const recusa = RECUSAS[motivo];
    if (!recusa) {
      this.avisar(`Erro: ${motivo}`, 'erro');
      return;
    }
    this.recusado = true;
    if (motivo === 'senha-errada') lembrar('ozamigos-senha', ''); // a senha pode ter mudado
    if (this.estado.fase === 'sala') {
      // Recusado ao reconectar (a senha mudou, a sala encheu): desfaz tudo e volta para a entrada.
      this.pararDeTransmitir(false);
      for (const { canal, id } of [...this.conexoes.values()]) this.fecharConexao(canal, id);
      voz.sair();
      this.mudar({ meuId: null, pessoas: [], transmitindo: [], plateias: {}, assistindo: [], videos: {}, conexaoPerdida: false, gravacaoDaSala: null });
    }
    this.mudar({ fase: 'entrada', erro: recusa });
  }

  // ===== Chat da sala =====

  /** Manda uma mensagem. Ela aparece na tela quando o servidor a devolve (é assim que se sabe que chegou). */
  mandarMensagem(texto: string): boolean {
    const limpo = texto.trim();
    if (!limpo || this.estado.fase !== 'sala' || !this.sinalizacao.aberta) return false;
    const agora = Date.now();
    this.envioDoChat = this.envioDoChat.filter((momento) => agora - momento < CHAT_JANELA);
    if (this.envioDoChat.length >= CHAT_RAJADA) {
      this.avisarFreioDoChat();
      return false; // a mensagem continua no campo, para mandar daqui a pouco
    }
    this.envioDoChat.push(agora);
    this.enviar({ tipo: 'chat', texto: limpo.slice(0, LIMITE_DO_CHAT * 2) }); // o servidor corta no limite certo
    return true;
  }

  /** Um aviso só, mesmo com vários Enter seguidos. */
  private avisarFreioDoChat() {
    if (this.avisoDoFreio !== null) this.dispensar(this.avisoDoFreio);
    this.avisoDoFreio = this.mostrarAviso('Muitas mensagens seguidas: espere uns segundos para mandar a próxima.', 'erro');
  }

  abrirChat(aberto: boolean) {
    // Aberto o chat, o aviso da última mensagem já não serve: ela está ali no painel.
    if (aberto && this.avisoDoChat) this.dispensar(this.avisoDoChat.aviso);
    this.mudar({ chatAberto: aberto, chatNaoLidas: aberto ? 0 : this.estado.chatNaoLidas });
  }

  private receberMensagem(de: string, texto: string) {
    const e = this.estado;
    const minha = de === e.meuId;
    const nome = minha ? e.meuNome : this.nomeDe(de);
    const mensagem: MensagemDoChat = { numero: this.proximaMensagem++, de, nome, texto, momento: Date.now(), minha };
    // Não lida: o chat estava fechado, ou a janela estava atrás de outra (o jogo). Conta no botão e na barra de tarefas.
    const lida = minha || (e.chatAberto && document.hasFocus());
    this.mudar({ chat: [...e.chat, mensagem].slice(-MENSAGENS_NA_TELA), chatNaoLidas: e.chatNaoLidas + (lida ? 0 : 1) });
    if (lida) return;
    tocar('mensagem');
    if (!e.chatAberto) {
      // Várias mensagens seguidas da mesma pessoa: o aviso novo toma o lugar do anterior, sem empilhar.
      if (this.avisoDoChat?.de === de) this.dispensar(this.avisoDoChat.aviso);
      const aviso = this.mostrarAviso(`${nome}: ${texto}`, 'info', { rotulo: 'Responder', executar: () => this.abrirChat(true) });
      this.avisoDoChat = { de, aviso };
    }
    this.notificar('chat', nome, texto); // com a janela atrás do jogo
  }

  // ===== Assistir =====

  assistir(id: string) {
    if (this.estado.assistindo.includes(id)) return;
    this.registrar(`assistir ${this.nomeDe(id)}`);
    this.mudar({ assistindo: [...this.estado.assistindo, id] });
    this.enviar({ tipo: 'assistir', para: id });
  }

  deixarDeAssistir(id: string) {
    this.registrar(`parar de assistir ${this.nomeDe(id)}`);
    this.mudar({ assistindo: this.estado.assistindo.filter((outro) => outro !== id) });
    this.fecharConexao('recebimento', id);
    this.enviar({ tipo: 'deixar', para: id });
  }

  // ===== Transmitir a minha tela =====

  /**
   * Abre o seletor e começa (ou troca) a transmissão. Precisa ser chamado direto no clique:
   * o navegador exige um gesto da pessoa. No app para Windows, o seletor é o do Ozamigos.
   */
  async transmitir(fonte: Fonte) {
    const tela = await this.capturar(fonte);
    if (!tela) return;
    if (this.estado.minhaTela) {
      await this.trocarFonte(tela);
    } else {
      this.usarTela(tela);
      await this.aplicarQualidade();
      this.enviar({ tipo: 'comecei' });
    }
  }

  private async capturar(fonte: Fonte): Promise<MediaStream | null> {
    if (noApp) seletorCarregando(true);
    const tela = await capturarDoNavegador(fonte, this.estado.qualidade);
    if (noApp) seletorCarregando(false); // se o app recusou antes de mostrar as fontes, o seletor fecha
    if (!tela || !noApp) return tela;
    // No app, o som do PC vem do auxiliar do Windows (sem o Discord e sem o próprio Ozamigos).
    const { somDoApp } = await resultadoDaUltimaEscolha();
    if (somDoApp) {
      try {
        tela.addTrack(await trilhaDoSomDoApp());
      } catch (erro) {
        // Sem a faixa de som, a transmissão segue só com vídeo (melhor que deixar a captura ligada à toa).
        console.error('Não foi possível montar o som do PC', erro);
        pararSomDoApp();
        this.avisar('Não foi possível transmitir o som do PC; a transmissão segue sem som.', 'erro');
      }
    } else if (this.estado.minhaTela) {
      pararSomDoApp(); // trocou para uma fonte sem som
    }
    return tela;
  }

  private usarTela(tela: MediaStream) {
    const [video] = tela.getVideoTracks();
    video.contentHint = 'motion'; // jogo: priorizar movimento fluido em vez de nitidez de texto
    tela.getAudioTracks().forEach((audio) => (audio.contentHint = 'music'));
    video.onended = () => this.pararDeTransmitir(true); // botão "Parar compartilhamento" do navegador
    video.applyConstraints(tamanhoDaCaptura(this.estado.qualidade, true)).catch((erro) => console.warn('A captura não aceitou o piso de fps', erro));
    this.mudar({ minhaTela: tela });
    const { width, height, frameRate } = video.getSettings();
    this.registrar(`transmitindo: ${this.descreverFonte()}, captura ${width}x${height} @${frameRate}`);
  }

  // Troca o que está sendo transmitido sem refazer as conexões:
  // replaceTrack põe a trilha nova no lugar da antiga, dentro da conexão que já existe.
  private async trocarFonte(nova: MediaStream) {
    const antiga = this.estado.minhaTela!;
    this.usarTela(nova);
    const [video] = nova.getVideoTracks();
    const [audio] = nova.getAudioTracks();
    for (const { pc } of this.conexoesDeEnvio()) {
      for (const transceptor of pc.getTransceivers()) {
        const tipo = transceptor.receiver.track.kind;
        await transceptor.sender.replaceTrack(tipo === 'video' ? video : (audio ?? null));
      }
    }
    antiga.getVideoTracks()[0].onended = null; // parar a antiga não pode encerrar a transmissão
    // A faixa de som do app passa de uma fonte para a outra: só para o que não continua.
    antiga.getTracks().filter((trilha) => !nova.getTracks().includes(trilha)).forEach((trilha) => trilha.stop());
    await this.aplicarQualidade(); // a fonte nova pode ter outro tamanho
  }

  pararDeTransmitir(avisarServidor: boolean) {
    const { minhaTela, meuId } = this.estado;
    if (!minhaTela) return;
    this.registrar('parei de transmitir');
    minhaTela.getTracks().forEach((trilha) => trilha.stop());
    if (noApp) pararSomDoApp();
    for (const { canal, id } of [...this.conexoes.values()]) {
      if (canal === 'envio') this.fecharConexao(canal, id);
    }
    const plateias = { ...this.estado.plateias };
    if (meuId) delete plateias[meuId];
    this.mudar({
      minhaTela: null,
      transmitindo: this.estado.transmitindo.filter((id) => id !== meuId),
      plateias,
    });
    if (avisarServidor) this.enviar({ tipo: 'parei' });
  }

  descreverFonte(): string {
    return this.estado.minhaTela ? descreverFonte(this.estado.minhaTela) : '';
  }

  // ===== Qualidade =====

  private async aplicarQualidade() {
    // A captura acompanha a qualidade: a 30 fps, o navegador copia a tela metade das vezes; em 720p, já sai menor.
    const [trilha] = this.estado.minhaTela?.getVideoTracks() ?? [];
    if (trilha) {
      try {
        await trilha.applyConstraints(tamanhoDaCaptura(this.estado.qualidade, true));
      } catch (erro) {
        console.warn('Não foi possível mudar o tamanho e o fps da captura', erro);
      }
    }
    for (const { pc } of this.conexoesDeEnvio()) await this.aplicarNoEnvio(pc);
  }

  /** O que o codificador recebe (bitrate, fps e o que sacrificar quando faltar banda ou placa de vídeo). */
  private async aplicarNoEnvio(pc: RTCPeerConnection) {
    const remetente = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!remetente) return;
    const parametros = remetente.getParameters() as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };
    if (!parametros.encodings?.length) return; // ainda negociando: a oferta já sai com a qualidade nova
    Object.assign(parametros.encodings[0], codificacao(this.estado.qualidade));
    parametros.degradationPreference = QUALIDADES[this.estado.qualidade].preferencia;
    try {
      await remetente.setParameters(parametros);
    } catch (erro) {
      console.warn('Não foi possível mudar a qualidade', erro);
    }
  }

  // ===== Conexões WebRTC =====

  private novaConexao(canal: Canal, idRemoto: string): Conexao {
    const pc = novaPeerConnection();
    const conexao: Conexao = { pc, pendentes: [], canal, id: idRemoto };
    this.conexoes.set(chave(canal, idRemoto), conexao);

    // Cada caminho de rede descoberto (candidato ICE) vai para o outro lado pelo servidor,
    // dizendo de qual das duas conexões ele é.
    pc.onicecandidate = (evento) => {
      if (evento.candidate) this.enviar({ tipo: 'candidato', para: idRemoto, canal, candidato: evento.candidate.toJSON() });
    };
    // Quem assiste cuida de refazer a conexão que caiu; quem transmite só responde ao pedido novo.
    let conectou = false;
    let espera: ReturnType<typeof setTimeout> | undefined;
    pc.onconnectionstatechange = () => {
      console.log(`Conexão de ${canal} com ${idRemoto}: ${pc.connectionState}`);
      this.registrar(`conexão de ${canal} com ${this.nomeDe(idRemoto)}: ${pc.connectionState}`);
      if (canal !== 'recebimento') return;
      clearTimeout(espera);
      if (pc.connectionState === 'connected') {
        conectou = true;
        this.tentativasDeVideo.delete(idRemoto);
      } else if (pc.connectionState === 'disconnected') {
        // Uma oscilação curta volta sozinha; parada por mais tempo, a imagem congelaria até o "failed" (uns 30 s).
        espera = setTimeout(() => this.refazerVideo(idRemoto, pc, conectou), ESPERA_DESCONECTADO);
      } else if (pc.connectionState === 'failed') {
        this.refazerVideo(idRemoto, pc, conectou);
      }
    };
    return conexao;
  }

  /**
   * A conexão de vídeo caiu (a rede de alguém oscilou): pede a transmissão de novo, sem ninguém clicar.
   * Se nunca chegou a conectar, é a rede que não deixa (falta TURN): tenta uma vez só e avisa.
   */
  private refazerVideo(id: string, pc: RTCPeerConnection, conectou: boolean) {
    if (this.conexoes.get(chave('recebimento', id))?.pc !== pc) return; // já foi trocada ou fechada
    if (pc.connectionState !== 'disconnected' && pc.connectionState !== 'failed') return; // voltou sozinha
    if (!this.estado.assistindo.includes(id) || !this.estado.transmitindo.includes(id)) return;
    if (!this.sinalizacao.aberta) {
      // Sem o servidor não dá para pedir de novo; e a conexão velha ainda pode voltar sozinha.
      setTimeout(() => this.refazerVideo(id, pc, conectou), ESPERA_DESCONECTADO);
      return;
    }
    const tentativas = (this.tentativasDeVideo.get(id) ?? 0) + 1;
    this.fecharConexao('recebimento', id);
    if (tentativas > (conectou ? 3 : 1)) {
      this.tentativasDeVideo.delete(id);
      this.avisar(`Não foi possível conectar direto com ${this.nomeDe(id)}. Algumas redes exigem um servidor TURN.`, 'erro', {
        rotulo: 'Tentar de novo',
        executar: () => this.pedirVideoDeNovo(id),
      });
      return;
    }
    this.tentativasDeVideo.set(id, tentativas);
    this.registrar(`refazendo o vídeo de ${this.nomeDe(id)} (tentativa ${tentativas})`);
    this.pedirVideoDeNovo(id);
  }

  /** "deixar" e "assistir" seguidos: quem transmite fecha a conexão velha e manda uma oferta nova. */
  private pedirVideoDeNovo(id: string) {
    if (!this.estado.assistindo.includes(id)) return;
    this.fecharConexao('recebimento', id);
    this.enviar({ tipo: 'deixar', para: id });
    this.enviar({ tipo: 'assistir', para: id });
  }

  private fecharConexao(canal: Canal, idRemoto: string) {
    const conexao = this.conexoes.get(chave(canal, idRemoto));
    if (!conexao) return;
    conexao.pc.close();
    this.conexoes.delete(chave(canal, idRemoto));
    this.medidor.esquecer(chave(canal, idRemoto));
    if (canal === 'recebimento') this.folgas.delete(idRemoto);
    const metricas = { ...this.estado.metricas };
    delete metricas[chave(canal, idRemoto)];
    const parcial: Partial<Estado> = { metricas };
    if (canal === 'recebimento') {
      const videos = { ...this.estado.videos };
      delete videos[idRemoto];
      parcial.videos = videos;
    }
    this.mudar(parcial);
  }

  // Lado de quem transmite: uma conexão de envio (e uma oferta) para cada pessoa que pediu para assistir.
  private async enviarOferta(idEspectador: string) {
    const tela = this.estado.minhaTela;
    if (!tela) return;
    this.fecharConexao('envio', idEspectador); // conexão refeita começa do zero, na qualidade de agora
    const { pc } = this.novaConexao('envio', idEspectador);
    montarEnvio(tela, this.estado.qualidade, pc, BITRATE_INICIAL);
    setTimeout(() => void this.bitrateCheio(pc), SUBIR_BITRATE_DEPOIS);
    const oferta = await pc.createOffer();
    const descricao: RTCSessionDescriptionInit = { type: 'offer', sdp: opusEstereo(oferta.sdp ?? '') };
    await pc.setLocalDescription(descricao);
    this.enviar({ tipo: 'oferta', para: idEspectador, sdp: descricao });
  }

  /** Vídeo e som da minha tela numa conexão de envio, com a qualidade de agora. Serve também aos espectadores simulados. */
  montarEnvio(pc: RTCPeerConnection) {
    const tela = this.estado.minhaTela;
    if (!tela) throw new Error('Ninguém está transmitindo');
    montarEnvio(tela, this.estado.qualidade, pc);
  }

  /** Passados os primeiros segundos de uma pessoa nova, o bitrate sobe para o da qualidade. */
  private async bitrateCheio(pc: RTCPeerConnection) {
    if (pc.connectionState === 'closed') return;
    const remetente = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!remetente) return;
    const parametros = remetente.getParameters();
    if (!parametros.encodings?.length) return;
    Object.assign(parametros.encodings[0], codificacao(this.estado.qualidade));
    try {
      await remetente.setParameters(parametros);
    } catch (erro) {
      console.warn('Não foi possível subir o bitrate', erro);
    }
  }

  /** O que sacrificar quando faltar banda ou placa de vídeo, conforme a qualidade (veja QUALIDADES). */
  async aplicarPreferencia(pc: RTCPeerConnection) {
    const remetente = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!remetente) return;
    const parametros = remetente.getParameters() as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };
    parametros.degradationPreference = QUALIDADES[this.estado.qualidade].preferencia;
    try {
      await remetente.setParameters(parametros);
    } catch (erro) {
      console.warn('O navegador não aceitou degradationPreference', erro);
    }
  }

  /** Os espectadores simulados acompanham as trocas de qualidade e de fonte, como os de verdade. */
  registrarEnvioExtra(pc: RTCPeerConnection) {
    this.enviosExtras.add(pc);
  }

  removerEnvioExtra(pc: RTCPeerConnection) {
    this.enviosExtras.delete(pc);
  }

  /** As conexões de envio, com o id de quem assiste (null nos espectadores simulados do teste). */
  private conexoesDeEnvio(): { id: string | null; pc: RTCPeerConnection }[] {
    const reais = [...this.conexoes.values()].filter((c) => c.canal === 'envio').map(({ id, pc }) => ({ id, pc }));
    return [...reais, ...[...this.enviosExtras].map((pc) => ({ id: null, pc }))];
  }

  /** Quem está me assistindo agora (só os da sala). */
  envios(): Ligacao[] {
    return this.ligacoes('envio');
  }

  /** Quem eu estou assistindo agora. */
  recebimentos(): Ligacao[] {
    return this.ligacoes('recebimento');
  }

  private ligacoes(canal: Canal): Ligacao[] {
    return [...this.conexoes.values()].filter((c) => c.canal === canal).map((c) => ({ id: c.id, nome: this.nomeDe(c.id), pc: c.pc }));
  }

  // ===== Gravação das estatísticas da sala (desempenho/) =====

  /** Pede ao servidor para começar ou parar a gravação. A resposta chega como "gravacao-da-sala" para todos. */
  gravarSala(ligada: boolean) {
    this.enviar({ tipo: 'gravar-sala', ligada });
  }

  /** As medidas deste segundo, para quem está gravando (o servidor entrega só a essa pessoa). */
  mandarMedidas(pacote: Extract<MensagemParaOServidor, { tipo: 'medidas' }>['pacote']) {
    this.enviar({ tipo: 'medidas', pacote });
  }

  private async receberResposta(idEspectador: string, sdp: RTCSessionDescriptionInit) {
    const conexao = this.conexoes.get(chave('envio', idEspectador));
    if (!conexao) return;
    await conexao.pc.setRemoteDescription(sdp);
    await this.aplicarCandidatosPendentes(conexao);
    // Se a rede ou o PC apertarem, o WebRTC baixa o fps e a nitidez, não a resolução (QUALIDADES em qualidade.ts).
    await this.aplicarPreferencia(conexao.pc);
  }

  // Lado de quem assiste: responde à oferta e entrega o vídeo para a interface.
  private async receberOferta(idTransmissor: string, sdp: RTCSessionDescriptionInit) {
    if (!this.estado.assistindo.includes(idTransmissor)) return; // desisti de assistir no meio do caminho
    this.fecharConexao('recebimento', idTransmissor);
    const conexao = this.novaConexao('recebimento', idTransmissor);
    const folga = new FolgaAdaptativa();
    this.folgas.set(idTransmissor, folga);
    let faixas: MediaStreamTrack[] = [];
    conexao.pc.ontrack = (evento) => {
      // Folga contra soluços do Wi-Fi de quem assiste (folga.ts), só no vídeo. No som, ela fazia a imagem esperar mais:
      // o navegador sincroniza os dois, e a folga do som somada à saída de áudio (~200 ms a mais no Android, medido)
      // segurava a imagem junto. O som fica com o ajuste automático do WebRTC, que já se adapta à rede.
      if (evento.track.kind === 'video') definirFolga(evento.receiver, folga.alvo);
      // A imagem e o som chegam separados (montarEnvio): aqui eles se juntam num MediaStream só para o <video>.
      faixas = [...faixas.filter((faixa) => faixa.kind !== evento.track.kind), evento.track];
      this.mudar({ videos: { ...this.estado.videos, [idTransmissor]: new MediaStream(faixas) } });
    };
    await conexao.pc.setRemoteDescription(sdp);
    await this.aplicarCandidatosPendentes(conexao);
    const resposta = await conexao.pc.createAnswer();
    const descricao: RTCSessionDescriptionInit = { type: 'answer', sdp: opusEstereo(resposta.sdp ?? '') };
    await conexao.pc.setLocalDescription(descricao);
    this.enviar({ tipo: 'resposta', para: idTransmissor, sdp: descricao });
  }

  // Um candidato pode chegar antes da oferta ou da resposta: guarda e aplica depois.
  private async receberCandidato(idRemoto: string, canal: Canal, candidato: RTCIceCandidateInit) {
    const conexao = this.conexoes.get(chave(canal, idRemoto));
    if (!conexao) return;
    if (conexao.pc.remoteDescription) {
      await adicionarCandidato(conexao.pc, candidato);
    } else {
      conexao.pendentes.push(candidato);
    }
  }

  private async aplicarCandidatosPendentes(conexao: Conexao) {
    for (const candidato of conexao.pendentes) await adicionarCandidato(conexao.pc, candidato);
    conexao.pendentes = [];
  }

  // ===== Estatísticas (conexao/medidor.ts) =====

  /** A folga de quem eu assisto acompanha a rede: sobe com jitter e congelamentos, desce com a rede calma. */
  private ajustarFolga(id: string, pc: RTCPeerConnection, jitter: number | undefined, congelamentos: number) {
    const folga = this.folgas.get(id);
    if (!folga) return;
    const antes = folga.alvo;
    const alvo = folga.medir(jitter != null ? jitter * 1000 : null, congelamentos);
    if (alvo === antes) return;
    for (const receptor of pc.getReceivers()) if (receptor.track.kind === 'video') definirFolga(receptor, alvo);
    if (Math.abs(alvo - antes) >= 25) this.registrar(`folga de rede vendo ${this.nomeDe(id)}: ${alvo} ms`);
  }

  /** Uma medição por vez: com muitas conexões, o getStats de todas pode passar de 1 s e as medições se empilhariam. */
  private async medir() {
    if (this.medindo) return;
    if (this.conexoes.size === 0) {
      if (Object.keys(this.estado.metricas).length > 0) this.mudar({ metricas: {} });
      return;
    }
    this.medindo = true;
    try {
      const metricas = await this.medidor.medir(this.conexoes);
      this.mudar({ metricas });
      this.relatorioDaSessao.registrarMedidas(metricas, (id) => this.nomeDe(id));
    } finally {
      this.medindo = false;
    }
  }
}

export const cliente = new Cliente();
