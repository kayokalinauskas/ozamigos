// O núcleo do app, sem nada de interface: sinalização com o servidor Java, conexões WebRTC
// e estatísticas. Os componentes React só leem o estado (via useCliente) e chamam as ações.

import { lembrado, lembrar } from './armazenamento';
import { QUALIDADES, QUALIDADE_PADRAO, ehQualidade, type Qualidade } from './qualidade';
import { tocar } from './sons';
import { noApp, ponte, resultadoDaUltimaEscolha, seletorCarregando } from './ponte';
import { pararSomDoApp, trilhaDoSomDoApp } from './somDoApp';

// STUN: servidores públicos que dizem ao navegador qual é o seu endereço visto da internet.
// Dois de empresas diferentes: se uma rede bloquear um, o outro responde.
const SERVIDORES_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];

export const LIMITE_POR_SALA = 8;

export type Pessoa = { id: string; nome: string };

export type Aviso = {
  id: number;
  texto: string;
  tipo: 'info' | 'erro';
  acao?: { rotulo: string; executar: () => void };
};

/** Uma linha de medição por conexão, atualizada a cada segundo. */
export type Metrica = {
  canal: Canal;
  id: string;
  fps: number;
  largura: number | null;
  altura: number | null;
  mbps: number;
  codec: string;
  captura: number | null; // fps que o navegador consegue copiar da tela (só envio)
  codificador: string | null;
  limite: string | null; // qualityLimitationReason (só envio; o Firefox não informa)
  rede: string | null; // host, srflx, prflx ou relay
  idaEVolta: number | null; // ms
  banda: number | null; // Mbps estimados de upload (só envio)
  congelamentos: number; // só recebimento
  perdidos: number; // só recebimento
  congelouAgora: boolean; // houve congelamento nos últimos segundos
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
  qualidade: Qualidade;
  metricas: Record<string, Metrica>; // `${canal}:${id}` -> medição
  avisos: Aviso[];
  conexaoPerdida: boolean; // caiu a conexão com o servidor; o cliente já está tentando voltar sozinho
};

type Canal = 'envio' | 'recebimento';
// medidas: canal de dados que vai junto com o vídeo. Quem assiste manda por ele o que recebe, quando quem
// transmite grava um teste de desempenho com os amigos (veja desempenho/).
type Conexao = { pc: RTCPeerConnection; pendentes: RTCIceCandidateInit[]; canal: Canal; id: string; medidas?: RTCDataChannel };
type Fonte = 'aplicativo' | 'tela' | 'escolher';

type Mensagem = Record<string, any> & { tipo: string };

const chave = (canal: Canal, id: string) => `${canal}:${id}`;

// Reconexão: espera 1 s, depois 2, 5 e então 10 s entre as tentativas, até conseguir.
const ESPERAS_PARA_RECONECTAR = [1_000, 2_000, 5_000, 10_000];
// Sem nenhuma mensagem do servidor por esse tempo (o pong chega a cada 30 s), a conexão está morta.
const SILENCIO_MAXIMO = 70_000;
// Quem volta dentro desse tempo com o mesmo nome é tratado como a mesma pessoa reconectando.
const JANELA_DE_VOLTA = 120_000;
// Conexão de vídeo "desconectada" por mais que isso é refeita (antes ficava congelada até desistir).
const ESPERA_DESCONECTADO = 2_000;
// Quem assiste segura ~200 ms de imagem antes de mostrar. Sem isso, cada soluço do Wi-Fi (ida e volta
// pulando de 8 para 222 ms, num relatório real) virava um congelamento. Para assistir, 200 ms não se notam.
const FOLGA_DE_REDE = 200;
// Com a tela parada, a captura do Chromium só entrega quadro quando algo muda (até 1 fps). Quem assiste via
// isso como congelamento (51 num relatório real, mostrando o Explorer). Com um piso, o Chromium repete o último
// quadro quando nenhum chega em 100 ms. É baixo de propósito: cada repetição é uma captura a mais, e o jogo
// que já sai a ~21 fps (um quadro a cada ~47 ms) nunca chega a pedir uma.
const FPS_MINIMO_DA_CAPTURA = 10;
// O relatório guarda as últimas linhas (medidas de cada segundo e acontecimentos): umas 2 horas com 2 conexões.
const LIMITE_DO_RELATORIO = 15_000;

/** Os ajustes de transmissão desta versão, como estão no código: vão no relatório do teste de desempenho. */
export const AJUSTES_DA_TRANSMISSAO = {
  servidoresIce: SERVIDORES_ICE.map((s) => s.urls).flat(),
  turn: false,
  topologia: 'malha P2P: uma RTCPeerConnection e uma codificação por pessoa assistindo',
  codecPreferido: 'H264 (setCodecPreferences), depois os outros',
  folgaDeRedeMs: FOLGA_DE_REDE,
  fpsMinimoDaCaptura: FPS_MINIMO_DA_CAPTURA,
  contentHint: 'motion',
  bundlePolicy: 'max-bundle',
  audio: 'Opus estéreo até 128 kbps, sem cancelamento de eco/ruído',
  escalaNoCodificador: 'scaleResolutionDownBy 1 (a captura já sai no tamanho da qualidade)',
};

/** Quem assiste, visto por quem transmite. */
export type Envio = { id: string; nome: string; pc: RTCPeerConnection; medidas: RTCDataChannel | null };

/** Uma linha do relatório: uma medida de uma conexão, ou um acontecimento. */
export type LinhaDoRelatorio = { momento: string } & ({ evento: string } | ({ medida: string } & Omit<Metrica, 'id'>));

export function codigoValido(codigo: string): boolean {
  return /^[A-Za-z0-9]{6,20}$/.test(codigo);
}

export function novoCodigo(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const aleatorios = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(aleatorios, (n) => letras[n % letras.length]).join('');
}

/** Aceita o código puro ou um link inteiro com ?sala=... (o que o amigo mandou no chat). */
export function codigoDe(texto: string): string {
  const limpo = texto.trim();
  try {
    const daUrl = new URL(limpo).searchParams.get('sala');
    if (daUrl) return daUrl;
  } catch {
    // não é um link: é o próprio código
  }
  return limpo;
}

export function linkDaSala(codigo: string): string {
  return `${location.origin}${location.pathname}?sala=${codigo}`;
}

class Cliente {
  private estado: Estado;
  private readonly ouvintes = new Set<() => void>();
  private ws: WebSocket | null = null;
  private readonly conexoes = new Map<string, Conexao>();
  private recusado = false;
  private nome = '';
  private senha = '';
  private ficha = ''; // dada pelo servidor; na reconexão, prova que somos a mesma pessoa
  private tentativas = 0;
  private reconexao: ReturnType<typeof setTimeout> | null = null;
  private ultimaMensagem = 0;
  // Nome de quem saiu -> quando, e se eu assistia. Quem volta ganha outro id: o nome é o que liga.
  private readonly saidas = new Map<string, { momento: number; assistia: boolean }>();
  private proximoAviso = 1;
  private readonly anteriores = new Map<string, { bytes: number; momento: number }>();
  private readonly historicoDeCongelamentos = new Map<string, number[]>();
  private readonly tentativasDeVideo = new Map<string, number>(); // id -> conexões de vídeo refeitas seguidas
  private readonly linhasDoRelatorio: LinhaDoRelatorio[] = [];
  // Conexões de envio que não são de ninguém da sala: os espectadores simulados do teste de desempenho.
  private readonly enviosExtras = new Set<RTCPeerConnection>();
  /** Chamado quando abre o canal de medidas de uma transmissão que eu assisto (desempenho/). */
  aoAbrirCanalDeMedidas: ((idTransmissor: string, canal: RTCDataChannel, pc: RTCPeerConnection) => void) | null = null;

  constructor() {
    const daUrl = new URLSearchParams(location.search).get('sala');
    const sala = daUrl && codigoValido(daUrl) ? daUrl : novoCodigo();
    const qualidade = lembrado('ozamigos-qualidade');
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
      qualidade: ehQualidade(qualidade) ? qualidade : QUALIDADE_PADRAO,
      metricas: {},
      avisos: [],
      conexaoPerdida: false,
    };
    this.trocarSala(sala);
    // Um "estou aqui" a cada 30 s: sem isso, proxies e hospedagens gratuitas fecham a conexão parada.
    setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN || this.estado.fase !== 'sala') return;
      // Uma rede que caiu de vez pode deixar o WebSocket "aberto" por minutos: o silêncio denuncia.
      if (Date.now() - this.ultimaMensagem > SILENCIO_MAXIMO) {
        this.perderConexao();
        return;
      }
      this.enviar({ tipo: 'ping' });
    }, 30_000);
    // Voltou a internet: tenta reconectar agora, sem esperar a próxima tentativa.
    addEventListener('online', () => {
      if (this.estado.conexaoPerdida) this.reconectar();
    });
    setInterval(() => void this.medir(), 1000);
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

  // ===== Avisos (os "toasts" do canto da tela) =====

  avisar(texto: string, tipo: Aviso['tipo'] = 'info', acao?: Aviso['acao']) {
    this.registrar(tipo === 'erro' ? `erro: ${texto}` : texto); // todo aviso da tela também vai para o relatório
    const aviso: Aviso = { id: this.proximoAviso++, texto, tipo, acao };
    this.mudar({ avisos: [...this.estado.avisos, aviso].slice(-4) });
    setTimeout(() => this.dispensar(aviso.id), acao ? 10_000 : 5_000);
  }

  dispensar(id: number) {
    this.mudar({ avisos: this.estado.avisos.filter((a) => a.id !== id) });
  }

  // ===== Relatório (para entender depois o que aconteceu numa sessão com os amigos) =====

  registrar(evento: string) {
    this.guardarLinha({ momento: new Date().toISOString(), evento });
  }

  private guardarLinha(linha: LinhaDoRelatorio) {
    this.linhasDoRelatorio.push(linha);
    if (this.linhasDoRelatorio.length > LIMITE_DO_RELATORIO) this.linhasDoRelatorio.shift();
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
      linhas: this.linhasDoRelatorio,
    };
  }

  /** Notificação do Windows, só quando a janela não está em foco (senão o aviso na tela basta). */
  private notificar(titulo: string, corpo: string) {
    if (document.hasFocus() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
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
    this.conectar();
  }

  private conectar() {
    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocolo}://${location.host}/sinal`);
    this.ws = ws;
    ws.onopen = () => {
      this.ultimaMensagem = Date.now();
      this.enviar({ tipo: 'entrar', sala: this.estado.sala, senha: this.senha, nome: this.nome, ficha: this.ficha });
    };
    ws.onclose = () => {
      if (this.recusado || this.ws !== ws) return;
      if (this.estado.fase === 'sala') {
        this.perderConexao();
      } else {
        this.mudar({ fase: 'entrada', erro: 'Não foi possível falar com o servidor. Se ele estava dormindo, espere 1 minuto e tente de novo.' });
      }
    };
    // As mensagens são tratadas uma de cada vez, na ordem em que chegaram.
    let fila = Promise.resolve();
    ws.onmessage = (evento) => {
      if (this.ws !== ws) return; // uma conexão antiga, já abandonada
      this.ultimaMensagem = Date.now();
      let msg: Mensagem;
      try {
        msg = JSON.parse(evento.data) as Mensagem;
      } catch {
        console.error('Mensagem inválida do servidor', evento.data);
        return;
      }
      fila = fila.then(() => this.tratar(msg)).catch((erro) => console.error('Erro ao tratar', msg, erro));
    };
  }

  // ===== Reconexão =====

  /**
   * Caiu a conexão com o servidor. As transmissões já abertas continuam (o vídeo não passa por ele),
   * e o cliente tenta voltar sozinho. Ao voltar, refaz as conexões e retoma o que estava assistindo.
   */
  private perderConexao() {
    const antiga = this.ws;
    this.ws = null;
    if (antiga) {
      antiga.onclose = null;
      antiga.onmessage = null;
      antiga.close();
    }
    if (!this.estado.conexaoPerdida) {
      this.registrar('caiu a conexão com o servidor');
      this.tentativas = 0;
      this.mudar({ conexaoPerdida: true });
    }
    this.agendarReconexao();
  }

  private agendarReconexao() {
    if (this.reconexao) return;
    const espera = ESPERAS_PARA_RECONECTAR[Math.min(this.tentativas, ESPERAS_PARA_RECONECTAR.length - 1)];
    this.tentativas++;
    this.reconexao = setTimeout(() => {
      this.reconexao = null;
      this.reconectar();
    }, espera);
  }

  /** Tenta agora. Se não der, a conexão fecha e o onclose agenda a próxima tentativa. */
  reconectar() {
    if (this.recusado || this.estado.fase !== 'sala') return;
    if (this.reconexao) {
      clearTimeout(this.reconexao);
      this.reconexao = null;
    }
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return; // já está tentando
    this.conectar();
  }

  /** De volta ao servidor, com um id novo: as conexões antigas não servem mais e são refeitas. */
  private voltei(msg: Mensagem) {
    for (const id of this.estado.assistindo) this.lembrarSaida(this.nomeDe(id), true);
    for (const { canal, id } of [...this.conexoes.values()]) this.fecharConexao(canal, id);
    this.tentativas = 0;
    this.mudar({
      meuId: msg.id,
      pessoas: msg.outros,
      transmitindo: msg.compartilhando,
      plateias: msg.plateias ?? {},
      assistindo: [],
      videos: {},
      conexaoPerdida: false,
    });
    if (this.estado.minhaTela) this.enviar({ tipo: 'comecei' }); // continuo transmitindo, agora com o id novo
    for (const id of msg.compartilhando as string[]) {
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

  sair() {
    this.recusado = true;
    this.pararDeTransmitir(false);
    this.conexoes.forEach(({ pc }) => pc.close());
    this.ws?.close();
    location.reload(); // volta para a entrada, com a mesma sala no link
  }

  private enviar(msg: Mensagem) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private async tratar(msg: Mensagem) {
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
        });
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          void Notification.requestPermission().catch(() => undefined);
        }
        aquecerWebRtc();
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
        this.notificar('Ozamigos', `${msg.nome} entrou na sala`);
        tocar('entrou');
        break;
      }
      case 'saiu': {
        const nomeQueSaiu = this.nomeDe(msg.id);
        this.lembrarSaida(nomeQueSaiu, e.assistindo.includes(msg.id));
        this.fecharConexao('envio', msg.id);
        this.fecharConexao('recebimento', msg.id);
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
          transmitindo: [...e.transmitindo, e.meuId],
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
        this.notificar('Ozamigos', `${nomeDeQuem} começou a transmitir`);
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
        await this.receberOferta(msg.de, msg.sdp);
        break;
      case 'resposta':
        await this.receberResposta(msg.de, msg.sdp);
        break;
      case 'candidato':
        // O canal vem do ponto de vista de quem mandou: o "envio" dele é o meu "recebimento".
        await this.receberCandidato(msg.de, msg.canal === 'envio' ? 'recebimento' : 'envio', msg.candidato);
        break;
      case 'erro':
        this.tratarErro(msg.motivo);
        break;
    }
  }

  private tratarErro(motivo: string) {
    const textos: Record<string, string> = {
      'senha-errada': 'Senha errada. Confira com quem mandou o link.',
      'sala-cheia': `A sala está cheia (máximo de ${LIMITE_POR_SALA} pessoas).`,
      'codigo-invalido': 'Código de sala inválido: use de 6 a 20 letras e números.',
    };
    const texto = textos[motivo] ?? `Erro: ${motivo}`;
    if (motivo in textos) {
      this.recusado = true;
      if (motivo === 'senha-errada') lembrar('ozamigos-senha', ''); // a senha pode ter mudado
      if (this.estado.fase === 'sala') {
        // Recusado ao reconectar (a senha mudou, a sala encheu): desfaz tudo e volta para a entrada.
        this.pararDeTransmitir(false);
        for (const { canal, id } of [...this.conexoes.values()]) this.fecharConexao(canal, id);
        this.mudar({ meuId: null, pessoas: [], transmitindo: [], plateias: {}, assistindo: [], videos: {}, conexaoPerdida: false });
      }
      this.mudar({ fase: 'entrada', erro: texto });
    } else {
      this.avisar(texto, 'erro');
    }
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
    const tela = await this.capturarDoNavegador(fonte);
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

  private async capturarDoNavegador(fonte: Fonte): Promise<MediaStream | null> {
    const superficie = fonte === 'aplicativo' ? 'window' : fonte === 'tela' ? 'monitor' : undefined;
    try {
      return await navigator.mediaDevices.getDisplayMedia({
        video: {
          ...(superficie ? { displaySurface: superficie } : {}), // abre o seletor já na aba certa
          ...this.tamanhoDaCaptura(),
        },
        // Som de jogo é música, não voz: nada de cancelar eco, tirar ruído ou mexer no volume.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        // Opções que só o Chrome e o Edge conhecem (os outros ignoram):
        ...{
          monitorTypeSurfaces: fonte === 'aplicativo' ? 'exclude' : 'include',
          selfBrowserSurface: 'exclude', // não oferecer a própria aba do Ozamigos
          systemAudio: 'include',
        },
      } as DisplayMediaStreamOptions);
    } catch {
      return null; // a pessoa cancelou o seletor
    }
  }

  private usarTela(tela: MediaStream) {
    const [video] = tela.getVideoTracks();
    video.contentHint = 'motion'; // jogo: priorizar movimento fluido em vez de nitidez de texto
    tela.getAudioTracks().forEach((audio) => (audio.contentHint = 'music'));
    video.onended = () => this.pararDeTransmitir(true); // botão "Parar compartilhamento" do navegador
    video.applyConstraints(this.tamanhoDaCaptura(true)).catch((erro) => console.warn('A captura não aceitou o piso de fps', erro));
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
    for (const pc of this.pcsDeEnvio()) {
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
    const tela = this.estado.minhaTela;
    if (!tela) return '';
    const { displaySurface } = tela.getVideoTracks()[0].getSettings() as MediaTrackSettings & { displaySurface?: string };
    const nomes: Record<string, string> = { window: 'Um aplicativo', monitor: 'A tela inteira', browser: 'Uma aba' };
    const audio = tela.getAudioTracks().length > 0 ? 'com som' : 'sem som';
    return `${nomes[displaySurface ?? ''] ?? 'Sua tela'}, ${audio}`;
  }

  // ===== Qualidade =====

  /** Troca a qualidade sem guardar a escolha: o teste de desempenho passa por todas e volta para a da pessoa. */
  async qualidadeTemporaria(qualidade: Qualidade) {
    this.registrar(`qualidade (teste): ${qualidade}`);
    this.mudar({ qualidade });
    await this.aplicarQualidade();
  }

  async mudarQualidade(qualidade: Qualidade) {
    this.registrar(`qualidade: ${qualidade}`);
    lembrar('ozamigos-qualidade', qualidade);
    this.mudar({ qualidade });
    await this.aplicarQualidade();
  }

  /**
   * A captura já sai no tamanho e no fps da qualidade (o navegador reduz a imagem uma vez só, na placa
   * de vídeo). Antes, cada amigo assistindo tinha o seu codificador reduzindo a mesma imagem, e a escala
   * ficava errada se a janela do jogo mudasse de tamanho no meio da transmissão.
   */
  // comPiso: o getDisplayMedia não aceita "min"; o piso entra depois, por applyConstraints.
  private tamanhoDaCaptura(comPiso = false): MediaTrackConstraints {
    const { altura, fps } = QUALIDADES[this.estado.qualidade];
    return {
      width: { max: Math.round((altura * 16) / 9) },
      height: { max: altura },
      frameRate: comPiso ? { min: FPS_MINIMO_DA_CAPTURA, ideal: fps, max: fps } : { ideal: fps, max: fps },
    };
  }

  // Os parâmetros do codificador para a qualidade escolhida (o tamanho vem da captura, sem escala aqui).
  private codificacao(): RTCRtpEncodingParameters {
    const qualidade = QUALIDADES[this.estado.qualidade];
    return {
      maxBitrate: qualidade.bitrate,
      maxFramerate: qualidade.fps,
      scaleResolutionDownBy: 1,
    };
  }

  private async aplicarQualidade() {
    const qualidade = QUALIDADES[this.estado.qualidade];
    // A captura acompanha a qualidade: a 30 fps, o navegador copia a tela metade das vezes; em 720p, já sai menor.
    const [trilha] = this.estado.minhaTela?.getVideoTracks() ?? [];
    if (trilha) {
      try {
        await trilha.applyConstraints(this.tamanhoDaCaptura(true));
      } catch (erro) {
        console.warn('Não foi possível mudar o tamanho e o fps da captura', erro);
      }
    }
    for (const pc of this.pcsDeEnvio()) {
      const remetente = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (!remetente) continue;
      const parametros = remetente.getParameters() as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };
      if (!parametros.encodings?.length) continue; // ainda negociando: a oferta já sai com a qualidade nova
      Object.assign(parametros.encodings[0], this.codificacao());
      parametros.degradationPreference = qualidade.preferencia;
      try {
        await remetente.setParameters(parametros);
      } catch (erro) {
        console.warn('Não foi possível mudar a qualidade', erro);
      }
    }
  }

  // ===== Conexões WebRTC =====

  private novaConexao(canal: Canal, idRemoto: string): Conexao {
    // max-bundle: vídeo e som pelo mesmo caminho de rede (menos candidatos, conexão mais rápida).
    const pc = new RTCPeerConnection({ iceServers: SERVIDORES_ICE, bundlePolicy: 'max-bundle' });
    const conexao: Conexao = { pc, pendentes: [], canal, id: idRemoto };
    this.conexoes.set(chave(canal, idRemoto), conexao);

    // Cada caminho de rede descoberto (candidato ICE) vai para o outro lado pelo servidor,
    // dizendo de qual das duas conexões ele é.
    pc.onicecandidate = (evento) => {
      if (evento.candidate) this.enviar({ tipo: 'candidato', para: idRemoto, canal, candidato: evento.candidate });
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
    if (this.ws?.readyState !== WebSocket.OPEN) {
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
    const prefixo = `${chave(canal, idRemoto)}:`;
    for (const chaveDoRelatorio of this.anteriores.keys()) {
      if (chaveDoRelatorio.startsWith(prefixo)) this.anteriores.delete(chaveDoRelatorio);
    }
    this.historicoDeCongelamentos.delete(chave(canal, idRemoto));
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
    this.fecharConexao('envio', idEspectador);
    const conexao = this.novaConexao('envio', idEspectador);
    const { pc } = conexao;
    this.montarEnvio(pc);
    // Criado antes da oferta, o canal entra na mesma negociação; fica parado até alguém gravar um teste.
    conexao.medidas = pc.createDataChannel('medidas', { ordered: true });
    const oferta = await pc.createOffer();
    await pc.setLocalDescription({ type: 'offer', sdp: opusEstereo(oferta.sdp ?? '') });
    this.enviar({ tipo: 'oferta', para: idEspectador, sdp: pc.localDescription });
  }

  /** Vídeo e som da minha tela numa conexão de envio, com a qualidade de agora. Serve também aos espectadores simulados. */
  montarEnvio(pc: RTCPeerConnection) {
    const tela = this.estado.minhaTela;
    if (!tela) throw new Error('Ninguém está transmitindo');
    const [video] = tela.getVideoTracks();
    const transceptor = pc.addTransceiver(video, {
      direction: 'sendonly',
      streams: [tela],
      sendEncodings: [this.codificacao()],
    });
    preferirH264(transceptor);
    // Sempre cria o canal de áudio, mesmo sem áudio agora: assim a troca de fonte não precisa renegociar.
    const [audio] = tela.getAudioTracks();
    pc.addTransceiver(audio ?? 'audio', { direction: 'sendonly', streams: [tela] });
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

  private pcsDeEnvio(): RTCPeerConnection[] {
    const reais = [...this.conexoes.values()].filter((c) => c.canal === 'envio').map((c) => c.pc);
    return [...reais, ...this.enviosExtras];
  }

  /** Quem está me assistindo agora (só os da sala). */
  envios(): Envio[] {
    return [...this.conexoes.values()]
      .filter((c) => c.canal === 'envio')
      .map((c) => ({ id: c.id, nome: this.nomeDe(c.id), pc: c.pc, medidas: c.medidas ?? null }));
  }

  private async receberResposta(idEspectador: string, sdp: RTCSessionDescriptionInit) {
    const conexao = this.conexoes.get(chave('envio', idEspectador));
    if (!conexao) return;
    await conexao.pc.setRemoteDescription(sdp);
    await this.aplicarCandidatosPendentes(conexao);
    // Se a rede ou o PC apertarem, o que sacrificar depende da qualidade escolhida (veja QUALIDADES).
    await this.aplicarPreferencia(conexao.pc);
  }

  // Lado de quem assiste: responde à oferta e entrega o vídeo para a interface.
  private async receberOferta(idTransmissor: string, sdp: RTCSessionDescriptionInit) {
    if (!this.estado.assistindo.includes(idTransmissor)) return; // desisti de assistir no meio do caminho
    this.fecharConexao('recebimento', idTransmissor);
    const conexao = this.novaConexao('recebimento', idTransmissor);
    conexao.pc.ondatachannel = ({ channel }) => {
      if (channel.label !== 'medidas') return;
      conexao.medidas = channel;
      this.aoAbrirCanalDeMedidas?.(idTransmissor, channel, conexao.pc);
    };
    conexao.pc.ontrack = (evento) => {
      // Folga contra soluços do Wi-Fi de quem assiste (veja FOLGA_DE_REDE); vale para vídeo e som, que andam juntos.
      try {
        (evento.receiver as RTCRtpReceiver & { jitterBufferTarget: number | null }).jitterBufferTarget = FOLGA_DE_REDE;
      } catch (erro) {
        console.warn('O navegador não aceitou a folga de rede', erro);
      }
      this.mudar({ videos: { ...this.estado.videos, [idTransmissor]: evento.streams[0] } });
    };
    await conexao.pc.setRemoteDescription(sdp);
    await this.aplicarCandidatosPendentes(conexao);
    const resposta = await conexao.pc.createAnswer();
    await conexao.pc.setLocalDescription({ type: 'answer', sdp: opusEstereo(resposta.sdp ?? '') });
    this.enviar({ tipo: 'resposta', para: idTransmissor, sdp: conexao.pc.localDescription });
  }

  // Um candidato pode chegar antes da oferta ou da resposta: guarda e aplica depois.
  private async receberCandidato(idRemoto: string, canal: Canal, candidato: RTCIceCandidateInit) {
    const conexao = this.conexoes.get(chave(canal, idRemoto));
    if (!conexao) return;
    if (conexao.pc.remoteDescription) {
      await conexao.pc.addIceCandidate(candidato);
    } else {
      conexao.pendentes.push(candidato);
    }
  }

  private async aplicarCandidatosPendentes(conexao: Conexao) {
    for (const candidato of conexao.pendentes) await conexao.pc.addIceCandidate(candidato);
    conexao.pendentes = [];
  }

  // ===== Estatísticas: os fps de verdade, e o porquê quando não chega lá =====

  private mbpsDesde(chaveDoRelatorio: string, bytes: number, momento: number): number {
    const anterior = this.anteriores.get(chaveDoRelatorio);
    this.anteriores.set(chaveDoRelatorio, { bytes, momento });
    return anterior ? ((bytes - anterior.bytes) * 8) / ((momento - anterior.momento) * 1000) : 0;
  }

  /** Congelou nos últimos 5 segundos? Guarda a contagem de cada segundo e compara com a de 5 s atrás. */
  private congelouAgora(chaveDaConexao: string, congelamentos: number): boolean {
    const historico = this.historicoDeCongelamentos.get(chaveDaConexao) ?? [];
    historico.push(congelamentos);
    if (historico.length > 6) historico.shift();
    this.historicoDeCongelamentos.set(chaveDaConexao, historico);
    return congelamentos > historico[0];
  }

  private async medir() {
    if (this.conexoes.size === 0) {
      if (Object.keys(this.estado.metricas).length > 0) this.mudar({ metricas: {} });
      return;
    }
    const metricas: Record<string, Metrica> = {};
    for (const [chaveDaConexao, { pc, id, canal }] of this.conexoes) {
      let relatorio: Map<string, any>;
      try {
        relatorio = (await pc.getStats()) as unknown as Map<string, any>;
      } catch {
        continue; // a conexão fechou durante a medição
      }
      let rede: string | null = null;
      let idaEVolta: number | null = null;
      let banda: number | null = null;
      relatorio.forEach((r) => {
        // Chrome e Edge apontam o par de candidatos escolhido no relatório "transport"; o Firefox marca o par com selected.
        let par = null;
        if (r.type === 'transport' && r.selectedCandidatePairId) par = relatorio.get(r.selectedCandidatePairId);
        if (r.type === 'candidate-pair' && r.selected) par = r;
        if (!par) return;
        rede = relatorio.get(par.remoteCandidateId)?.candidateType ?? null;
        idaEVolta = par.currentRoundTripTime != null ? Math.round(par.currentRoundTripTime * 1000) : null;
        if (canal === 'envio' && par.availableOutgoingBitrate) banda = par.availableOutgoingBitrate / 1e6;
      });
      relatorio.forEach((r) => {
        if (r.kind !== 'video' || (r.type !== 'outbound-rtp' && r.type !== 'inbound-rtp')) return;
        const enviando = r.type === 'outbound-rtp';
        // O Firefox gera ids de relatório novos a cada consulta: o ssrc identifica o fluxo nos dois navegadores.
        const mbps = this.mbpsDesde(`${chaveDaConexao}:${r.type}:${r.ssrc}`, enviando ? r.bytesSent : r.bytesReceived, r.timestamp);
        const congelamentos = r.freezeCount ?? 0;
        metricas[chaveDaConexao] = {
          canal,
          id,
          fps: Math.round(r.framesPerSecond ?? 0),
          largura: r.frameWidth ?? null,
          altura: r.frameHeight ?? null,
          mbps,
          codec: relatorio.get(r.codecId)?.mimeType?.replace('video/', '') ?? '?',
          // A captura vem antes do codificador: se ela já está baixa, o problema é o jogo/placa de vídeo, não a rede.
          captura: enviando ? (relatorio.get(r.mediaSourceId)?.framesPerSecond ?? null) : null,
          codificador: enviando ? (r.encoderImplementation ?? null) : null,
          limite: enviando ? (r.qualityLimitationReason ?? null) : null,
          rede,
          idaEVolta,
          banda,
          congelamentos,
          perdidos: r.framesDropped ?? 0,
          congelouAgora: !enviando && this.congelouAgora(chaveDaConexao, congelamentos),
        };
      });
    }
    this.mudar({ metricas });
    const momento = new Date().toISOString();
    for (const { id, ...medida } of Object.values(metricas)) this.guardarLinha({ momento, medida: this.nomeDe(id), ...medida });
  }
}

/**
 * O WebRTC manda o Opus em mono, a menos que as duas pontas peçam estéreo no SDP.
 * Som de jogo tem esquerda e direita: pedimos estéreo e até 128 kbps.
 */
function opusEstereo(sdp: string): string {
  const tipo = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp)?.[1];
  if (!tipo) return sdp;
  return sdp.replace(new RegExp(`(a=fmtp:${tipo} [^\\r\\n]*)`), (linha) =>
    linha.includes('stereo=1') ? linha : `${linha};stereo=1;sprop-stereo=1;maxaveragebitrate=128000`,
  );
}

/**
 * O primeiro uso do WebRTC na página pergunta à placa de vídeo quais codecs ela tem, e isso trava a
 * página por até 1,6 s (medido numa Radeon RX 7800 XT). Sem isto, a trava caía na hora em que o
 * primeiro amigo clicava em Assistir: a interface congelava e o som do PC picotava logo no começo.
 * Feito logo depois de entrar na sala, ninguém percebe, e as conexões seguintes já saem prontas.
 */
function aquecerWebRtc() {
  setTimeout(() => {
    try {
      RTCRtpReceiver.getCapabilities('video');
    } catch {
      // navegador sem WebRTC completo: a conexão de verdade mostra o erro
    }
  }, 300);
}

// H.264 é o codec que quase toda placa de vídeo codifica em hardware.
function preferirH264(transceptor: RTCRtpTransceiver) {
  if (!transceptor.setCodecPreferences) return;
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
  const h264 = codecs.filter((c) => c.mimeType === 'video/H264');
  if (h264.length === 0) return;
  transceptor.setCodecPreferences([...h264, ...codecs.filter((c) => c.mimeType !== 'video/H264')]);
}

export const cliente = new Cliente();
