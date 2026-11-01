// O núcleo do app, sem nada de interface: a sala (quem está, quem transmite, quem assiste) e as conexões de vídeo.
// Os componentes React só leem o estado (via useCliente) e chamam as ações. As peças ficam em conexao/:
//   sinalizacao.ts  o WebSocket com o servidor, com reconexão     protocolo.ts  as mensagens, com tipo
//   captura.ts      a captura da tela e o codificador             webrtc.ts     ajustes do WebRTC
//   medidor.ts      as estatísticas de cada segundo               relatorio.ts  o relatório da sessão

import { lembrar } from './armazenamento';
import { QUALIDADE, QUALIDADES, aceitaHevc, type Qualidade } from './qualidade';
import { qualidadeEscolhida } from './escolhaDeQualidade';
import { notificacaoLigada, type TipoDeNotificacao } from './notificacoes';
import { tocar } from './sons';
import { esquecerEscolha, noApp, ponte, resultadoDaUltimaEscolha, seletorCarregando } from './ponte';
import { pararSomDoApp, trilhaDoSomDoApp } from './somDoApp';
import { aoPararVideoDoApp, ehVideoDoApp, pararVideoDoApp, trilhaDoVideoDoApp } from './videoDoApp';
import { voz } from './voz/voz';
import { trocaDeImagens } from './imagens/troca';
import { novoIdDeImagem, type Chegada } from './imagens/protocolo';
import type { ImagemComprimida } from './imagens/compressor';
import { FOLGA, FolgaAdaptativa } from './folga';
import { lerConta } from './conta';

import { LIMITE_POR_SALA, servidorDoCaminho } from './conexao/codigoDaSala';
import {
  FPS_MINIMO_DA_CAPTURA,
  capturarDoNavegador,
  capturarPelaFonte,
  codificacao,
  descreverFonte,
  marcarSuperficie,
  montarEnvio,
  tamanhoDaCaptura,
  type Fonte,
} from './conexao/captura';
import { Medidor, type MedidaDoRecebimento, type Metrica } from './conexao/medidor';
import type { Canal, LimiteDoVideo, MensagemDoServidor, MensagemParaOServidor, MotivoDoErro, Pessoa } from './conexao/protocolo';
import { Relatorio } from './conexao/relatorio';
import { Sinalizacao } from './conexao/sinalizacao';
import {
  CODEC_SEGUINTE,
  SERVIDORES_ICE,
  VigiaDoCodificador,
  VigiaDoDecodificador,
  adicionarCandidato,
  aquecerWebRtc,
  caminhoDaConexao,
  definirFolga,
  conexoesAbertas,
  definirRetransmissao,
  lerCodificador,
  novaPeerConnection,
  opusEstereo,
  preferirCodecs,
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
  /**
   * O código do servidor salvo (/s/<codigo>, Servidores.java) da página, ou null na entrada. São as únicas salas: entra
   * quem é membro, com a conta, sem senha (decisão do dono, 28/10/2026).
   */
  servidor: string | null;
  meuId: string | null;
  meuNome: string;
  minhaConta: string | null; // o id da minha conta, se entrei com uma (o servidor diz no "bem-vindo"); null: convidado
  minhaFoto: string | null;
  pessoas: Pessoa[]; // as outras pessoas, na ordem em que entraram
  transmitindo: string[]; // quem está transmitindo agora (inclusive eu)
  plateias: Record<string, string[]>; // quem transmite -> quem assiste
  assistindo: string[]; // quem eu escolhi assistir (continua valendo se a pessoa parar e voltar)
  videos: Record<string, MediaStream>; // o que chega de cada pessoa que eu assisto
  minhaTela: MediaStream | null;
  qualidade: Qualidade; // a da transmissão de agora (720p, ou o 1080p escolhido na engrenagem do app)
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
export type MensagemDoChat = {
  numero: number;
  de: string;
  nome: string;
  foto?: string | null; // a da conta, guardada na chegada junto com o nome
  texto: string;
  momento: number;
  minha: boolean;
  imagem?: ImagemDoChat;
  previa?: PreviaDeLink;
};

/** O cartão de um link de vídeo (YouTube, Twitch...): o servidor busca, ninguém da sala acessa o site. */
export type PreviaDeLink = {
  url: string;
  site: string;
  titulo: string | null;
  autor: string | null;
  miniatura: string | null;
  aoVivo: boolean; // um canal da Twitch ou da Kick transmitindo agora
};

/** Uma imagem do chat (imagens/): veio direto do PC de quem mandou e só existe na memória desta página. */
export type ImagemDoChat = {
  id: string;
  largura: number;
  altura: number;
  miniatura: string; // a prévia borrada, enquanto a imagem chega ('' sem)
  url: string | null; // a imagem inteira, quando chega (e até sair da memória)
  estado: 'chegando' | 'pronta' | 'falhou' | 'apagada';
  progresso: number; // de 0 a 1, enquanto chega
  envio: { para: Record<string, string>; entregues: string[]; falhas: string[] } | null; // só nas minhas (id -> nome)
};

/** O mesmo limite do servidor (SinalizacaoHandler.CHAT_MAXIMO): acima disso, ele corta. */
export const LIMITE_DO_CHAT = 500;
// O mesmo freio do servidor (CHAT_RAJADA e CHAT_JANELA_MS): conferido antes de mandar, a mensagem fica no campo.
const CHAT_RAJADA = 5;
const CHAT_JANELA = 3_000;
// O chat não fica guardado em lugar nenhum: só as últimas mensagens desta sessão, na memória da página.
const MENSAGENS_NA_TELA = 200;
// As imagens que ficam na memória (cada uma tem até 1,5 MB, mais a imagem decodificada na tela); as mais antigas saem.
const IMAGENS_NA_MEMORIA = /Android|iPhone|iPad|Mobi/.test(navigator.userAgent) ? 20 : 50;
// O freio de quem manda imagens (quem recebe tem um mais largo, em imagens/protocolo.ts).
const IMAGENS_POR_MINUTO = 12;
/**
 * Quantos bytes por segundo as imagens podem usar enquanto eu transmito (sem transmitir, vão no ritmo da rede).
 * A conexão de voz, por onde vão, não divide a banda com a do vídeo: sem freio, uma imagem podia encher o upload e
 * engasgar a transmissão. 3 Mbps: um print de jogo (~1,4 MB) chega em ~4 s para cada pessoa.
 */
const RITMO_DAS_IMAGENS_TRANSMITINDO = 375_000;

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
// Cada conexão de envio lê o codificador a cada tanto desde a oferta, até o primeiro quadro (VigiaDoCodificador, em
// webrtc.ts), e desiste depois do máximo: uma conexão que nem conecta é caso para o refazerVideo de quem assiste.
const LER_CODIFICADOR_A_CADA = 1_000;
const VIGIAR_CODIFICADOR_POR = 60_000;
const NOME_DO_CODEC: Record<string, string> = { 'video/H265': 'H.265', 'video/H264': 'H.264', 'video/VP8': 'VP8, no processador' };

// Chamar a atenção de alguém: até tantas vezes nessa janela, para cada pessoa (a mesma regra do servidor,
// CHAMADAS_POR_JANELA e CHAMADAS_JANELA_MS).
export const CHAMADAS_POR_JANELA = 5;
export const CHAMADAS_JANELA = 60_000;

// Recusas do servidor que mandam a pessoa de volta para a tela de entrada, com o motivo.
const RECUSAS: Partial<Record<MotivoDoErro, string>> = {
  'sala-cheia': `A sala está cheia (máximo de ${LIMITE_POR_SALA} pessoas).`,
  'sem-conta': 'Para entrar num servidor, entre com a sua conta.',
  'servidor-nao-existe': 'Esse servidor não existe, ou você não faz parte dele.',
  'servidores-indisponiveis': 'Os servidores estão indisponíveis agora. Tente de novo daqui a pouco.',
  expulso: 'Você foi removido deste servidor.',
  'servidor-apagado': 'Este servidor foi apagado pelo dono.',
  'fora-do-servidor': 'Você não faz mais parte deste servidor.',
};

/** Os ajustes de transmissão desta versão, como estão no código: vão no relatório do teste de desempenho. */
export const AJUSTES_DA_TRANSMISSAO = {
  servidoresIce: SERVIDORES_ICE.map((s) => s.urls).flat(),
  turn: 'credenciais do servidor (Retransmissao.java), quando ligada; usada só quando o caminho direto falha',
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
    aoAbrir: () => this.enviar(this.pedidoDeEntrada()),
    aoReceber: (msg) => this.tratar(msg),
    aoFechar: () => this.conexaoFechou(),
  });
  private readonly conexoes = new Map<string, Conexao>();
  private recusado = false;
  private ficha = ''; // dada pelo servidor; na reconexão, prova que somos a mesma pessoa
  // Quem saiu (chaveDe: a conta) -> quando, e se eu assistia. Quem volta ganha outro id.
  private readonly saidas = new Map<string, { momento: number; assistia: boolean }>();
  /** A conexão nova é da conta que mudou (renovarConexao), e não de uma queda: sem o aviso de "restabelecida". */
  private renovando = false;
  private proximoAviso = 1;
  private proximaMensagem = 1;
  private readonly imagensMinhas = new Map<string, ImagemComprimida>(); // para o "Tentar de novo"
  private envioDeImagens: number[] = []; // quando mandei as últimas imagens (o freio)
  private codecsRecusados = new Set<string>(); // o codificador da placa falhou neles (vigiarCodificador): de fora até recarregar
  private ecos: (() => void)[] = []; // imagens esperando o texto que vai antes delas voltar do servidor
  private avisoDoChat: { de: string; aviso: number } | null = null; // o aviso da última mensagem, enquanto na tela
  private envioDoChat: number[] = []; // quando mandei as últimas mensagens (o freio)
  private avisoDoFreio: number | null = null;
  // Quem chamei (chaveDe) -> quando. Não pelo id: quem reconecta ganha outro, e o freio do servidor é por conexão.
  private readonly chamadas = new Map<string, number[]>();
  private readonly tentativasDeVideo = new Map<string, number>(); // id -> conexões de vídeo refeitas seguidas
  private readonly folgas = new Map<string, FolgaAdaptativa>(); // quem eu assisto -> folga de rede (folga.ts)
  private readonly vigiasDaImagem = new WeakMap<RTCPeerConnection, VigiaDoDecodificador>(); // conexão de recebimento -> vigia
  private readonly travasDaImagem = new Map<string, number>(); // codec -> vezes que a imagem travou aqui (vigiarImagem)
  private readonly codecsQueTravamAqui = new Set<string>(); // travaram duas vezes: a resposta os tira, até recarregar
  private readonly relatorioDaSessao = new Relatorio();
  private readonly medidor = new Medidor((id, pc, medida) => {
    this.ajustarFolga(id, pc, medida);
    this.vigiarImagem(id, pc, medida);
  });
  private medindo = false;
  // Conexões de envio que não são de ninguém da sala: os espectadores simulados do teste de desempenho.
  private readonly enviosExtras = new Set<RTCPeerConnection>();
  /** Quem grava as estatísticas da sala recebe aqui as medidas de cada pessoa (desempenho/gravadorDaSala.ts). */
  aoReceberMedidas: ((de: string, pacote: unknown) => void) | null = null;
  /** O servidor recusou começar a gravação: outra pessoa já grava. */
  aoRecusarGravacao: (() => void) | null = null;

  constructor() {
    // A página abre na entrada (a lista dos servidores, como o Discord), ou na de um servidor (/s/<codigo>). O app
    // abre sempre na raiz, e não entra sozinho em sala nenhuma (pedido do dono, 28/10/2026).
    lembrar('ozamigos-qualidade', ''); // a escolha de qualidade saiu (14/10/2026): o que estava guardado não serve mais
    this.esquecerOQueSaiu();
    this.estado = {
      fase: 'entrada',
      erro: '',
      servidor: servidorDoCaminho(location.pathname),
      meuId: null,
      meuNome: '', // o da conta, que chega no bem-vindo
      minhaConta: null,
      minhaFoto: null,
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
    aoPararVideoDoApp((aviso) => void this.videoDoAppParou(aviso));
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
      chaveDe: (id) => this.chaveDe(id),
      avisar: (texto, tipo) => this.avisar(texto, tipo),
      registrar: (evento) => this.registrar(evento),
    });
    trocaDeImagens.ligar({
      chegou: (de, evento) => this.chegouImagem(de, evento),
      ritmo: () => (this.estado.meuId && this.estado.transmitindo.includes(this.estado.meuId) ? RITMO_DAS_IMAGENS_TRANSMITINDO : Infinity),
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

  /**
   * O que reconhece a pessoa mesmo quando o id da conexão muda (uma reconexão): a conta (todos têm uma). Também é a
   * chave dos volumes e do silenciado de cada um, que valem em qualquer sala e com qualquer nome. Quem não está na
   * lista (já saiu) fica com uma chave que não é de mais ninguém.
   */
  chaveDe(id: string): string {
    const conta = this.estado.pessoas.find((p) => p.id === id)?.conta;
    return conta ? `conta:${conta}` : `id:${id}`;
  }

  /** A foto da conta de alguém da sala (a minha também), ou null. */
  fotoDe(id: string): string | null {
    if (id === this.estado.meuId) return this.estado.minhaFoto;
    return this.estado.pessoas.find((p) => p.id === id)?.foto ?? null;
  }

  /**
   * Entrou ou saiu da conta com a sala aberta (Configurações → Conta, no app): uma conexão nova com o servidor, que lê
   * a sessão nova, e as conexões com os amigos são refeitas (como numa reconexão). O nome e a reserva mudam na hora.
   */
  renovarConexao() {
    if (this.estado.fase !== 'sala' || this.recusado) return;
    this.registrar('conexão renovada: a conta mudou');
    this.renovando = true;
    this.sinalizacao.conectar();
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
      sala: `servidor ${this.estado.servidor}`,
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

  /**
   * O que as salas com senha guardavam (saíram em 28/10/2026): o nome de convidado, as senhas, o último lugar,
   * a última sala e as marcas da entrada automática. Uma vez por abertura, é barato, e ninguém fica com uma senha velha.
   */
  private esquecerOQueSaiu() {
    for (const chave of ['ozamigos-nome', 'ozamigos-senha', 'ozamigos-ultima-sala', 'ozamigos-ultimo-grupo', 'ozamigos-nao-entrar-sozinho', 'ozamigos-escolheu-convidado']) {
      lembrar(chave, '');
    }
    try {
      for (const chave of Object.keys(localStorage)) if (chave.startsWith('ozamigos-senha:')) localStorage.removeItem(chave);
    } catch {
      // sem o localStorage, não há o que esquecer
    }
  }

  /** Sem senha nem nome: quem entra é a conta (o cookie da sessão), e o servidor confere se ela é membro. */
  private pedidoDeEntrada(): MensagemParaOServidor {
    return { tipo: 'entrar', servidor: this.estado.servidor ?? '', ficha: this.ficha };
  }

  /**
   * Entra na sala de um servidor salvo, da lista da entrada ou da página dele, sem recarregar: o endereço vira o do
   * servidor (/s/<codigo>). Só com a conta, que é quem entra.
   */
  entrarNoServidor(codigo: string) {
    const { conta } = lerConta();
    if (this.estado.fase !== 'entrada' || !conta) return; // dois cliques abririam duas conexões (uma "pessoa fantasma")
    if (location.pathname !== `/s/${codigo}`) history.replaceState(null, '', `/s/${codigo}`);
    this.recusado = false;
    this.ficha = '';
    this.mudar({ servidor: codigo, fase: 'entrando', erro: '', meuNome: conta.nome });
    voz.preparar(); // no clique: o navegador só deixa tocar som depois de um gesto
    this.sinalizacao.conectar();
  }

  private conexaoFechou() {
    if (this.recusado) return;
    if (this.estado.fase === 'sala') {
      this.perderConexao();
    } else {
      this.mudar({ fase: 'entrada', erro: 'Não foi possível conectar. Confira a internet e tente de novo em instantes.' });
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

  /** A retransmissão que o servidor deu (ou tirou): vale para as conexões novas. Só o fato vai para o relatório. */
  private usarRetransmissao(video: RTCIceServer[], vozes: RTCIceServer[], limite?: LimiteDoVideo) {
    definirRetransmissao('voz', vozes);
    definirRetransmissao('video', video);
    const doVideo = video.length ? 'disponível' : limite ? `cortada (limite ${limite})` : 'não';
    this.registrar(`retransmissão: voz ${vozes.length ? 'disponível' : 'não'}, vídeo ${doVideo}`);
    if (!limite) this.avisouDoLimite = false;
    else if (!this.avisouDoLimite) void this.avisarDoLimiteDoVideo(limite, vozes.length > 0);
  }

  /**
   * O vídeo ficou sem a retransmissão por um limite de consumo (Retransmissao.java): quem depende dela fica sabendo por
   * quê, uma vez (pedido do dono, 26/10/2026). Pelo limite geral, só quem tem uma transmissão passando por ela agora:
   * quem conecta direto nem percebe o corte.
   */
  private avisouDoLimite = false;
  private async avisarDoLimiteDoVideo(limite: LimiteDoVideo, vozContinua: boolean) {
    this.avisouDoLimite = true;
    if (limite === 'geral') {
      const conexoes = [...conexoesAbertas('video'), ...(vozContinua ? [] : conexoesAbertas('voz'))];
      const caminhos = await Promise.all(conexoes.map((pc) => caminhoDaConexao(pc)));
      if (!caminhos.includes('retransmitido')) return;
    }
    // Sem a voz também: o teto de todos, ou a credencial da voz usada para outra coisa (Retransmissao.java).
    const texto =
      limite === 'seu'
        ? vozContinua
          ? 'Você assistiu bastante hoje pela conexão de reserva da sua internet, e o vídeo por ela chegou ao limite do dia. A voz continua normalmente, e o vídeo volta amanhã.'
          : 'Você usou bastante hoje a conexão de reserva da sua internet, e ela chegou ao limite do dia. Ela volta amanhã.'
        : vozContinua
          ? 'O vídeo pela conexão de reserva chegou ao limite do Ozamigos por enquanto. A voz continua normalmente.'
          : 'A conexão de reserva chegou ao limite do Ozamigos por enquanto.';
    this.avisar(texto, 'erro');
  }

  /** De volta ao servidor, com um id novo: as conexões antigas não servem mais e são refeitas. */
  private voltei(msg: Extract<MensagemDoServidor, { tipo: 'bem-vindo' }>) {
    for (const id of this.estado.assistindo) this.lembrarSaida(this.chaveDe(id), true);
    for (const { canal, id } of [...this.conexoes.values()]) this.fecharConexao(canal, id);
    this.sinalizacao.zerarEsperas();
    this.mudar({
      meuId: msg.id,
      ...this.quemSouEu(msg),
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
    if (this.renovando) this.avisar(this.estado.minhaConta ? `Você está na sala com a sua conta, como ${this.estado.meuNome}.` : 'Você está na sala como convidado.');
    else this.avisar('Conexão com o servidor restabelecida');
    this.renovando = false;
  }

  /** O que o "bem-vindo" diz de mim: com conta, o nome dela (o servidor não usa o que a página mandou) e a foto. */
  private quemSouEu(msg: Extract<MensagemDoServidor, { tipo: 'bem-vindo' }>): Partial<Estado> {
    return { meuNome: msg.nome ?? this.estado.meuNome, minhaConta: msg.conta ?? null, minhaFoto: msg.foto ?? null };
  }

  private lembrarSaida(chave: string, assistia: boolean) {
    this.saidas.set(chave, { momento: Date.now(), assistia });
  }

  /** Quem saiu há pouco com essa chave (chaveDe), ou null. */
  private saidaRecente(chave: string) {
    const saida = this.saidas.get(chave);
    if (saida && Date.now() - saida.momento < JANELA_DE_VOLTA) return saida;
    this.saidas.delete(chave);
    return null;
  }

  /** É alguém que eu assistia, caiu e voltou com outro id? Responde uma vez só. */
  private voltandoQuemEuAssistia(id: string): boolean {
    const chave = this.chaveDe(id);
    if (!this.saidaRecente(chave)?.assistia) return false;
    this.saidas.delete(chave);
    return true;
  }

  /** Sai da sala e volta para a lista dos servidores. */
  sair(para = '/') {
    this.recusado = true;
    this.pararDeTransmitir(false);
    this.conexoes.forEach(({ pc }) => pc.close());
    voz.sair();
    this.sinalizacao.encerrar();
    location.assign(para);
  }

  /**
   * Um convite aberto no app (ozamigos://convite/<codigo>, com o app já aberto): fora de uma sala, vai à página dele;
   * numa sala, não tira ninguém da conversa sem perguntar, um aviso com "Abrir" é que leva.
   */
  abrirConvite(convite: string) {
    if (!/^[A-Za-z0-9]{10}$/.test(convite)) return;
    if (this.estado.fase === 'sala') {
      this.avisar('Você recebeu um convite para um servidor.', 'info', { rotulo: 'Abrir', executar: () => this.sair(`/c/${convite}`) });
    } else {
      location.assign(`/c/${convite}`);
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
        this.usarRetransmissao(msg.retransmissao ?? [], msg.retransmissaoDaVoz ?? [], msg.limiteDoVideo);
        if (e.fase === 'sala') {
          this.voltei(msg);
          break;
        }
        this.mudar(this.quemSouEu(msg));
        this.registrar(`entrei no servidor ${e.servidor} como ${this.estado.meuNome}`);
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
        if (e.pessoas.some((p) => p.id === msg.id)) break; // já veio na lista do "bem-vindo" (entramos ao mesmo tempo)
        this.mudar({ pessoas: [...e.pessoas, { id: msg.id, nome: msg.nome, conta: msg.conta, foto: msg.foto }] });
        const chaveDeQuemEntrou = this.chaveDe(msg.id);
        const saida = this.saidaRecente(chaveDeQuemEntrou);
        if (saida) {
          this.avisar(`${msg.nome} reconectou`); // caiu e voltou: sem som nem notificação
          if (!saida.assistia) this.saidas.delete(chaveDeQuemEntrou);
          break;
        }
        this.avisar(`${msg.nome} entrou na sala`);
        this.notificar('entrou', 'Ozamigos', `${msg.nome} entrou na sala`);
        tocar('entrou');
        break;
      }
      case 'saiu': {
        const nomeQueSaiu = this.nomeDe(msg.id);
        this.lembrarSaida(this.chaveDe(msg.id), e.assistindo.includes(msg.id));
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
            this.avisar(`${this.nomeDe(msg.id)} começou a gravar as estatísticas da sala: o Ozamigos manda para essa pessoa como as transmissões chegam aqui.`);
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
      case 'previa':
        this.receberPrevia(msg);
        break;
      case 'chamado':
        this.receberChamado(msg.de);
        break;
      case 'erro':
        if (msg.motivo === 'chat-rapido-demais') {
          this.avisarFreioDoChat(); // raro: o freio daqui já segura antes, mas o relógio dos dois lados difere um pouco
          break;
        }
        if (msg.motivo === 'chamar-cedo-demais') {
          this.avisar('Espere um pouco para chamar de novo.', 'erro');
          break;
        }
        if (msg.motivo === 'sala-ja-gravando') {
          this.aoRecusarGravacao?.();
          this.avisar(`${e.gravacaoDaSala?.nome ?? 'Outra pessoa'} já está gravando as estatísticas desta sala.`, 'erro');
          break;
        }
        this.tratarErro(msg.motivo);
        break;
      case 'retransmissao':
        this.usarRetransmissao(msg.servidores, msg.voz ?? [], msg.limiteDoVideo);
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
    if (this.estado.fase === 'sala') {
      // Tirado da sala (expulso, o servidor apagado) ou recusado ao reconectar (a sala encheu): desfaz tudo e volta
      // para a entrada do servidor, com o motivo.
      this.pararDeTransmitir(false);
      for (const { canal, id } of [...this.conexoes.values()]) this.fecharConexao(canal, id);
      voz.sair();
      this.mudar({ meuId: null, pessoas: [], transmitindo: [], plateias: {}, assistindo: [], videos: {}, conexaoPerdida: false, gravacaoDaSala: null });
    }
    this.mudar({ fase: 'entrada', erro: recusa });
  }

  // ===== Chamar a atenção =====

  /** As vezes que chamei essa pessoa no último minuto. */
  private chamadasRecentes(chaveDaPessoa: string): number[] {
    const recentes = (this.chamadas.get(chaveDaPessoa) ?? []).filter((t) => Date.now() - t < CHAMADAS_JANELA);
    this.chamadas.set(chaveDaPessoa, recentes);
    return recentes;
  }

  /** Quanto falta para poder chamar essa pessoa de novo (0: já pode; só espera quem já chamou 5 vezes no minuto). */
  chamarDeNovoEm(id: string): number {
    const recentes = this.chamadasRecentes(this.chaveDe(id));
    return recentes.length < CHAMADAS_POR_JANELA ? 0 : Math.max(0, recentes[0] + CHAMADAS_JANELA - Date.now());
  }

  /**
   * "Voltei, volta aí também": um som e um aviso só para essa pessoa, mesmo com o som do Ozamigos e as notificações
   * desligados. Até 5 vezes por minuto para cada pessoa (o servidor confere).
   */
  chamar(id: string) {
    if (this.chamarDeNovoEm(id) > 0 || !this.estado.pessoas.some((p) => p.id === id)) return;
    const nome = this.nomeDe(id);
    const chaveDaPessoa = this.chaveDe(id);
    this.chamadas.set(chaveDaPessoa, [...this.chamadasRecentes(chaveDaPessoa), Date.now()]);
    this.enviar({ tipo: 'chamar', para: id });
    this.registrar(`chamei a atenção de ${nome}`);
    this.mostrarAviso(`Você chamou ${nome}.`);
    this.mudar({}); // o botão passa a contar o tempo para chamar de novo
  }

  /**
   * Alguém chamou a minha atenção: o som toca mesmo com os sons de aviso desligados, e a notificação do Windows aparece
   * mesmo com as notificações desligadas (é para isso que existe). Quem eu silenciei para mim não me chama.
   */
  private receberChamado(de: string) {
    if (voz.silenciadoParaMim(de)) return;
    const nome = this.nomeDe(de);
    this.registrar(`${nome} chamou a minha atenção`);
    tocar('chamado', true);
    // Com o som do Ozamigos desligado, o aviso já traz o botão para ligar (e o aviso fica mais tempo na tela).
    const ligarOSom = voz.ler().surdo ? { rotulo: 'Ligar o som', executar: () => voz.alternarSurdo() } : undefined;
    this.mostrarAviso(`${nome} está chamando você.`, 'info', ligarOSom);
    ponte?.chamarAtencao?.();
    if (document.hasFocus() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const aviso = new Notification('Ozamigos', { body: `${nome} está chamando você.`, silent: true });
      aviso.onclick = () => focus();
    } catch {
      // sem notificações: o som e o aviso na tela continuam
    }
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
    const minha = de === this.estado.meuId;
    const nome = minha ? this.estado.meuNome : this.nomeDe(de);
    this.porNoChat({ de, nome, texto, minha });
    if (minha) this.ecos.shift()?.(); // o texto que ia antes de imagens voltou do servidor: agora vão as imagens
    else this.contarNova(de, `${nome}: ${texto}`, nome, texto);
  }

  /**
   * A prévia de um link chega logo depois da mensagem: vai para a mensagem mais recente com esse link e sem prévia.
   * A miniatura só entra se for uma imagem JPEG embutida (nunca um endereço: ninguém da sala busca nada no site).
   */
  private receberPrevia(msg: Extract<MensagemDoServidor, { tipo: 'previa' }>) {
    const texto = (valor: unknown, maximo: number) => (typeof valor === 'string' && valor.trim() ? valor.trim().slice(0, maximo) : null);
    if (typeof msg.url !== 'string' || !/^https?:\/\//.test(msg.url) || typeof msg.site !== 'string') return;
    const miniatura = typeof msg.miniatura === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(msg.miniatura) ? msg.miniatura : null;
    const previa: PreviaDeLink = {
      url: msg.url,
      site: msg.site.slice(0, 40),
      titulo: texto(msg.titulo, 200),
      autor: texto(msg.autor, 100),
      miniatura,
      aoVivo: msg.aoVivo === true,
    };
    const chat = this.estado.chat;
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].previa || !chat[i].texto.includes(msg.url)) continue;
      this.mudar({ chat: chat.map((m, j) => (j === i ? { ...m, previa } : m)) });
      return;
    }
  }

  private porNoChat(campos: Omit<MensagemDoChat, 'numero' | 'momento'>) {
    const mensagem = { foto: this.fotoDe(campos.de), ...campos, numero: this.proximaMensagem++, momento: Date.now() };
    const chat = [...this.estado.chat, mensagem];
    chat.slice(0, -MENSAGENS_NA_TELA).forEach((velha) => this.soltarImagem(velha.imagem));
    this.mudar({ chat: chat.slice(-MENSAGENS_NA_TELA) });
  }

  /**
   * Uma mensagem nova de outra pessoa. Não lida: o chat estava fechado, ou a janela estava atrás de outra (o jogo).
   * Conta no botão e na barra de tarefas, toca o som, e vira aviso na tela e notificação do Windows.
   */
  private contarNova(de: string, aviso: string, titulo: string, corpo: string) {
    const e = this.estado;
    if (e.chatAberto && document.hasFocus()) return;
    this.mudar({ chatNaoLidas: e.chatNaoLidas + 1 });
    tocar('mensagem');
    if (!e.chatAberto) {
      // Várias mensagens seguidas da mesma pessoa: o aviso novo toma o lugar do anterior, sem empilhar.
      if (this.avisoDoChat?.de === de) this.dispensar(this.avisoDoChat.aviso);
      const id = this.mostrarAviso(aviso, 'info', { rotulo: 'Responder', executar: () => this.abrirChat(true) });
      this.avisoDoChat = { de, aviso: id };
    }
    this.notificar('chat', titulo, corpo); // com a janela atrás do jogo
  }

  // ===== Imagens do chat (imagens/) =====

  /**
   * Manda as imagens da bandeja, uma mensagem para cada. Vão direto para o PC de cada pessoa da sala, pela conexão
   * de voz; quem não tem essa conexão aparece em "não chegou para". Devolve false se o freio segurou.
   */
  mandarImagens(prontas: { imagem: ImagemComprimida; url: string }[], texto = ''): boolean {
    const e = this.estado;
    if (prontas.length === 0 || e.fase !== 'sala') return false;
    const agora = Date.now();
    this.envioDeImagens = this.envioDeImagens.filter((momento) => agora - momento < 60_000);
    if (this.envioDeImagens.length + prontas.length > IMAGENS_POR_MINUTO) {
      this.mostrarAviso(`Muitas imagens seguidas: até ${IMAGENS_POR_MINUTO} por minuto.`, 'erro');
      return false;
    }
    this.envioDeImagens.push(...prontas.map(() => agora));
    if (!texto.trim()) {
      this.colocarImagens(prontas);
      return true;
    }
    // Com texto: ele vai antes, como no Discord. O texto passa pelo servidor e as imagens vão direto, e as imagens
    // chegavam antes dele para uns e depois para outros. Elas só saem quando o servidor devolve o texto (ou em 3 s).
    if (!this.mandarMensagem(texto)) {
      this.envioDeImagens = this.envioDeImagens.slice(0, -prontas.length);
      return false;
    }
    let colocou = false;
    const colocar = () => {
      if (colocou) return;
      colocou = true;
      this.ecos = this.ecos.filter((eco) => eco !== colocar);
      this.colocarImagens(prontas);
    };
    this.ecos.push(colocar);
    setTimeout(colocar, 3_000);
    return true;
  }

  private colocarImagens(prontas: { imagem: ImagemComprimida; url: string }[]) {
    const e = this.estado;
    if (e.fase !== 'sala') {
      prontas.forEach(({ url }) => URL.revokeObjectURL(url));
      return;
    }
    for (const { imagem, url } of prontas) {
      const id = novoIdDeImagem();
      this.imagensMinhas.set(id, imagem);
      const para = Object.fromEntries(this.estado.pessoas.map((p) => [p.id, p.nome]));
      const envio = { para, entregues: [], falhas: [] };
      const { largura, altura } = imagem;
      const minhaImagem: ImagemDoChat = { id, largura, altura, miniatura: '', url, estado: 'pronta', progresso: 1, envio };
      this.porNoChat({ de: e.meuId ?? '', nome: e.meuNome, texto: '', minha: true, imagem: minhaImagem });
      this.enviarImagem(id, Object.keys(para));
    }
    this.limitarImagens();
  }

  /**
   * Quem não recebeu a imagem e ainda está na sala, com o id de agora: quem reconectou ganhou outro id e é
   * reconhecido pelo nome (como na volta automática a assistir).
   */
  pessoaDeAgora(id: string, nome: string): Pessoa | undefined {
    const { pessoas } = this.estado;
    return pessoas.find((p) => p.id === id) ?? pessoas.find((p) => p.nome === nome);
  }

  /** Manda de novo para quem não recebeu e ainda está na sala. */
  reenviarImagem(id: string) {
    const envio = this.estado.chat.find((m) => m.minha && m.imagem?.id === id)?.imagem?.envio;
    if (!envio || !this.imagensMinhas.has(id)) return;
    const para = { ...envio.para };
    const falhas: string[] = [];
    const deNovo: string[] = [];
    for (const antigo of envio.falhas) {
      const pessoa = this.pessoaDeAgora(antigo, envio.para[antigo]);
      if (!pessoa) {
        falhas.push(antigo);
        continue;
      }
      delete para[antigo];
      para[pessoa.id] = pessoa.nome;
      deNovo.push(pessoa.id);
    }
    this.mudarImagem(this.estado.meuId ?? '', id, (img) => ({ ...img, envio: { ...envio, para, falhas } }));
    this.enviarImagem(id, deNovo);
  }

  private enviarImagem(id: string, pessoas: string[]) {
    const imagem = this.imagensMinhas.get(id);
    if (!imagem || pessoas.length === 0) return;
    const comeco = performance.now();
    const meuId = this.estado.meuId ?? '';
    const resultados = pessoas.map(async (pessoa) => {
      const motivo = await trocaDeImagens.enviar(pessoa, { id, ...imagem });
      this.mudarImagem(meuId, id, (img) => {
        if (!img.envio) return img;
        const envio = motivo ? { ...img.envio, falhas: [...img.envio.falhas, pessoa] } : { ...img.envio, entregues: [...img.envio.entregues, pessoa] };
        return { ...img, envio };
      });
      return motivo ? `${this.nomeDe(pessoa)} (${motivo})` : null;
    });
    void Promise.all(resultados).then((falhas) => {
      const naoChegou = falhas.filter(Boolean);
      const segundos = ((performance.now() - comeco) / 1000).toFixed(1);
      const kb = Math.round(imagem.bytes.length / 1024);
      this.registrar(
        `imagem de ${kb} KB (${imagem.largura}×${imagem.altura}) para ${pessoas.length} pessoa(s) em ${segundos} s` +
          (naoChegou.length ? `; não chegou para ${naoChegou.join(', ')}` : ''),
      );
    });
  }

  private chegouImagem(de: string, evento: Chegada) {
    const nome = this.nomeDe(de);
    if (evento.tipo === 'comecou') {
      const { id, largura, altura, miniatura } = evento;
      const imagem: ImagemDoChat = {
        id,
        largura,
        altura,
        miniatura: miniatura && `data:image/webp;base64,${miniatura}`,
        url: null,
        estado: 'chegando',
        progresso: 0,
        envio: null,
      };
      this.porNoChat({ de, nome, texto: '', minha: false, imagem });
    } else if (evento.tipo === 'progresso') {
      // Redesenhar a cada pedaço de 64 KB seria demais: só a cada 5%.
      this.mudarImagem(de, evento.id, (img) => (evento.fracao - img.progresso >= 0.05 ? { ...img, progresso: evento.fracao } : img));
    } else if (evento.tipo === 'chegou') {
      const url = URL.createObjectURL(new Blob([evento.bytes as BlobPart], { type: 'image/webp' }));
      this.mudarImagem(de, evento.id, (img) => ({ ...img, url, estado: 'pronta', progresso: 1 }));
      this.limitarImagens();
      this.contarNova(de, `${nome} mandou uma imagem`, nome, 'Mandou uma imagem');
    } else {
      this.mudarImagem(de, evento.id, (img) => ({ ...img, estado: 'falhou' }));
      this.registrar(`imagem de ${nome} não chegou: ${evento.motivo}`);
    }
  }

  private mudarImagem(de: string, id: string, mudanca: (imagem: ImagemDoChat) => ImagemDoChat) {
    let mudou = false;
    const chat = this.estado.chat.map((m) => {
      if (m.de !== de || m.imagem?.id !== id) return m;
      const imagem = mudanca(m.imagem);
      if (imagem === m.imagem) return m;
      mudou = true;
      return { ...m, imagem };
    });
    if (mudou) this.mudar({ chat });
  }

  /** Só as últimas IMAGENS_NA_MEMORIA ficam: as mais antigas saem da memória e viram um aviso no chat. */
  private limitarImagens() {
    const naMemoria = this.estado.chat.filter((m) => m.imagem?.url);
    const sobrando = new Set(naMemoria.slice(0, Math.max(0, naMemoria.length - IMAGENS_NA_MEMORIA)));
    if (sobrando.size === 0) return;
    sobrando.forEach((m) => this.soltarImagem(m.imagem));
    this.mudar({ chat: this.estado.chat.map((m) => (sobrando.has(m) && m.imagem ? { ...m, imagem: { ...m.imagem, url: null, estado: 'apagada' } } : m)) });
  }

  private soltarImagem(imagem: ImagemDoChat | undefined) {
    if (!imagem) return;
    if (imagem.url) URL.revokeObjectURL(imagem.url);
    this.imagensMinhas.delete(imagem.id);
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
    // A qualidade escolhida na engrenagem vale a partir daqui (trocá-la no meio refaria a captura do app).
    const qualidade = qualidadeEscolhida();
    const tela = await this.capturar(fonte, qualidade);
    if (!tela) return;
    // O codec fica o negociado na conexão: passando de 720p para 1080p (ou o contrário), as conexões de envio são refeitas
    // para irem no codec certo (em 1080p, nunca H.265: aceitaHevc).
    const refazerConexoes = Boolean(this.estado.minhaTela) && aceitaHevc(qualidade) !== aceitaHevc(this.estado.qualidade);
    if (qualidade !== this.estado.qualidade) {
      this.registrar(`qualidade: ${QUALIDADES[qualidade].rotulo}`);
      this.mudar({ qualidade });
    }
    if (this.estado.minhaTela) {
      await this.trocarFonte(tela);
      if (refazerConexoes) for (const { id } of this.conexoesDeEnvio()) if (id) void this.enviarOferta(id); // os simulados (sem id) ficam
    } else {
      this.usarTela(tela);
      await this.aplicarQualidade();
      this.enviar({ tipo: 'comecei' });
    }
  }

  private async capturar(fonte: Fonte, qualidade: Qualidade): Promise<MediaStream | null> {
    if (noApp) {
      esquecerEscolha();
      seletorCarregando(true);
    }
    let tela = await capturarDoNavegador(fonte, qualidade);
    if (noApp) seletorCarregando(false); // se o app recusou antes de mostrar as fontes, o seletor fecha
    if (!noApp) return tela;
    const { somDoApp, videoDoApp, tipo } = await resultadoDaUltimaEscolha();
    const videoAtual = this.estado.minhaTela?.getVideoTracks()[0];
    const trilhaDoApp = trilhaDoVideoDoApp();
    if (videoDoApp && trilhaDoApp) {
      // O vídeo vem da captura do app: o app recusou o getDisplayMedia de propósito.
      tela?.getTracks().forEach((trilha) => trilha.stop());
      marcarSuperficie(trilhaDoApp, tipo === 'tela' ? 'monitor' : 'window');
      tela = new MediaStream([trilhaDoApp]);
    } else if (tela || !ehVideoDoApp(videoAtual)) {
      // Vai a captura do Chromium (ou nada foi escolhido sem transmitir): a trilha do app, se montada, não serve.
      pararVideoDoApp();
    }
    if (!tela) return null;
    // No app, o som do PC vem do auxiliar do Windows (sem o Discord e sem o próprio Ozamigos).
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
    // A captura do app já sai no tamanho, no fps e com o piso (repete o último quadro com a imagem parada).
    if (!ehVideoDoApp(video)) {
      video.applyConstraints(tamanhoDaCaptura(this.estado.qualidade, true)).catch((erro) => console.warn('A captura não aceitou o piso de fps', erro));
    }
    this.mudar({ minhaTela: tela });
    const { width, height, frameRate } = video.getSettings();
    this.registrar(
      ehVideoDoApp(video)
        ? `transmitindo: ${this.descreverFonte()}, captura do app`
        : `transmitindo: ${this.descreverFonte()}, captura do navegador ${width}x${height} @${frameRate}`,
    );
  }

  /** Por onde a imagem da minha transmissão é capturada (para as estatísticas): 'app', 'navegador' ou null. */
  origemDaCaptura(): 'app' | 'navegador' | null {
    const [video] = this.estado.minhaTela?.getVideoTracks() ?? [];
    return video ? (ehVideoDoApp(video) ? 'app' : 'navegador') : null;
  }

  /**
   * A captura do app parou sozinha. A janela fechou: a transmissão acaba, como na captura do Chromium. Falhou: a mesma
   * fonte passa para a captura do Chromium, sem ninguém clicar e sem refazer as conexões.
   */
  private async videoDoAppParou({ motivo, fonte }: { motivo: 'fechou' | 'falhou'; fonte: string }) {
    const tela = this.estado.minhaTela;
    if (!tela || !ehVideoDoApp(tela.getVideoTracks()[0])) return;
    const descricao = this.descreverFonte();
    if (motivo === 'fechou') {
      this.registrar('a janela transmitida fechou');
      this.pararDeTransmitir(true);
      return;
    }
    this.registrar('a captura do app parou: a transmissão segue pela captura do navegador');
    const nova = await capturarPelaFonte(fonte, this.estado.qualidade);
    if (this.estado.minhaTela !== tela) {
      nova?.getTracks().forEach((trilha) => trilha.stop()); // parou ou trocou de fonte enquanto isso
      return;
    }
    if (!nova) {
      this.pararDeTransmitir(true);
      this.avisar('A transmissão parou por um erro na captura. Clique em Transmitir para continuar.', 'erro');
      return;
    }
    const [video] = nova.getVideoTracks();
    marcarSuperficie(video, descricao.startsWith('A tela') ? 'monitor' : 'window');
    pararVideoDoApp();
    await this.trocarFonte(new MediaStream([video, ...tela.getAudioTracks()]));
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
    if (noApp) {
      pararSomDoApp();
      pararVideoDoApp();
    }
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
    if (trilha && !ehVideoDoApp(trilha)) {
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
    const pc = novaPeerConnection('video');
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
        void caminhoDaConexao(pc).then((caminho) => caminho && this.registrar(`vídeo de ${this.nomeDe(idRemoto)}: ${caminho}`));
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
      this.avisar(`Não foi possível conectar com ${this.nomeDe(id)}. A rede de um de vocês pode estar bloqueando a conexão.`, 'erro', {
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
    montarEnvio(tela, this.estado.qualidade, pc, BITRATE_INICIAL, this.codecsRecusados);
    setTimeout(() => void this.bitrateCheio(pc), SUBIR_BITRATE_DEPOIS);
    this.vigiarCodificador(pc, idEspectador);
    const oferta = await pc.createOffer();
    const descricao: RTCSessionDescriptionInit = { type: 'offer', sdp: opusEstereo(oferta.sdp ?? '') };
    await pc.setLocalDescription(descricao);
    this.enviar({ tipo: 'oferta', para: idEspectador, sdp: descricao });
  }

  /** Vídeo e som da minha tela numa conexão de envio, com a qualidade de agora. Serve também aos espectadores simulados. */
  montarEnvio(pc: RTCPeerConnection) {
    const tela = this.estado.minhaTela;
    if (!tela) throw new Error('Ninguém está transmitindo');
    montarEnvio(tela, this.estado.qualidade, pc, 1, this.codecsRecusados);
  }

  /**
   * Conectada, com a captura entregando quadros, e o codificador da placa sem soltar nenhum (um driver quebrado): esta
   * conexão é refeita no codec seguinte (CODEC_SEGUINTE), e as próximas já saem nele, até a página recarregar. Não fica
   * guardado: num PC assim, a placa voltava a codificar em outro dia, e a conferência custa só os segundos do prazo.
   * Cada conexão vigia a sua: as que nasceram num codec recusado depois se refazem sozinhas no prazo delas.
   */
  private vigiarCodificador(pc: RTCPeerConnection, idEspectador: string) {
    const vigia = new VigiaDoCodificador();
    const inicio = performance.now();
    const minha = () => pc.connectionState !== 'closed' && this.conexoes.get(chave('envio', idEspectador))?.pc === pc;
    const ler = async () => {
      if (!minha() || performance.now() - inicio > VIGIAR_CODIFICADOR_POR) return;
      const leitura = await lerCodificador(pc);
      if (!minha()) return; // fechada ou refeita durante a leitura
      const decisao = leitura ? vigia.ler(leitura, performance.now()) : 'esperar';
      if (decisao === 'esperar') {
        setTimeout(() => void ler(), LER_CODIFICADOR_A_CADA);
        return;
      }
      if (decisao !== 'trocar' || !leitura) return;
      if (!this.codecsRecusados.has(leitura.codec)) {
        this.codecsRecusados.add(leitura.codec);
        const seguinte = CODEC_SEGUINTE[leitura.codec];
        this.registrar(`o codificador ${NOME_DO_CODEC[leitura.codec]} não soltou quadros: as transmissões passam para ${NOME_DO_CODEC[seguinte] ?? seguinte}`);
      }
      void this.enviarOferta(idEspectador);
    };
    setTimeout(() => void ler(), LER_CODIFICADOR_A_CADA);
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
    // Sem os codecs que travaram o decodificador daqui (vigiarImagem), a resposta faz quem transmite usar o seguinte.
    if (this.codecsQueTravamAqui.size > 0) {
      const transceptor = conexao.pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
      if (transceptor) preferirCodecs(transceptor, this.codecsQueTravamAqui);
    }
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
  private ajustarFolga(id: string, pc: RTCPeerConnection, { jitterEmSegundos, congelamentos }: MedidaDoRecebimento) {
    const folga = this.folgas.get(id);
    if (!folga) return;
    const antes = folga.alvo;
    const alvo = folga.medir(jitterEmSegundos != null ? jitterEmSegundos * 1000 : null, congelamentos);
    if (alvo === antes) return;
    for (const receptor of pc.getReceivers()) if (receptor.track.kind === 'video') definirFolga(receptor, alvo);
    if (Math.abs(alvo - antes) >= 25) this.registrar(`folga de rede vendo ${this.nomeDe(id)}: ${alvo} ms`);
  }

  /**
   * Os quadros de quem eu assisto chegam e nenhum vira imagem (VigiaDoDecodificador): o decodificador travou, e a tela
   * ficava branca até a pessoa sair e entrar de novo. Refaz só a conexão desse vídeo, como a saída e a volta faziam, e
   * um codec que trava pela segunda vez sai das próximas respostas (receberOferta), até a página recarregar: quem
   * transmite cai no H.264 ou no VP8, como no VigiaDoCodificador.
   */
  private vigiarImagem(id: string, pc: RTCPeerConnection, { recebidos, decodificados, codec }: MedidaDoRecebimento) {
    if (this.conexoes.get(chave('recebimento', id))?.pc !== pc || recebidos === undefined || decodificados === undefined) return;
    let vigia = this.vigiasDaImagem.get(pc);
    if (!vigia) this.vigiasDaImagem.set(pc, (vigia = new VigiaDoDecodificador()));
    // Escondida (minimizada, na bandeja), a página não decodifica vídeo: não é trava.
    if (document.visibilityState !== 'visible' || pc.connectionState !== 'connected') {
      vigia.esquecer();
      return;
    }
    if (vigia.ler({ recebidos, decodificados }, performance.now()) !== 'refazer') return;
    const vezes = (this.travasDaImagem.get(codec) ?? 0) + 1;
    this.travasDaImagem.set(codec, vezes);
    const nome = NOME_DO_CODEC[codec] ?? (codec || 'codec desconhecido');
    if (vezes >= 2 && codec in CODEC_SEGUINTE && !this.codecsQueTravamAqui.has(codec)) {
      this.codecsQueTravamAqui.add(codec);
      this.registrar(`a imagem travou ${vezes} vezes no decodificador ${nome}: os vídeos que chegam passam para ${NOME_DO_CODEC[CODEC_SEGUINTE[codec]]}`);
    }
    this.registrar(`o vídeo de ${this.nomeDe(id)} chegava sem imagem (decodificador ${nome}): refazendo a conexão`);
    this.pedirVideoDeNovo(id);
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
