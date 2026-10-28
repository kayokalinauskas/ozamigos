// As mensagens trocadas com o servidor de sinalização (SinalizacaoHandler.java), uma a uma.
// Com um tipo para cada mensagem, o compilador avisa sobre campo com nome errado ou mensagem esquecida no switch.
// Mudou algo aqui? Mude também o servidor (e o teste dele, SinalizacaoTest.java).

import type { Pacote } from '../desempenho/tipos';

/** As duas conexões de vídeo, do ponto de vista de quem fala: quem me assiste (envio) e quem eu assisto (recebimento). */
export type Canal = 'envio' | 'recebimento';

/**
 * Alguém da sala. Com conta (login pelo Google ou pelo Discord): `conta` é o id dela, que reconhece a pessoa mesmo com
 * o id da conexão mudando, e `foto` o endereço da foto (no próprio servidor), se tiver. Sem `conta`, é convidado.
 */
export type Pessoa = { id: string; nome: string; conta?: string; foto?: string };

/** Oferta e resposta do WebRTC. Sem `canal`, são do vídeo; com `canal: 'voz'`, da conversa por voz. */
type Descricao = { sdp: RTCSessionDescriptionInit; canal?: 'voz' };
/** No vídeo, o canal vem do ponto de vista de quem mandou: o "envio" dele é o meu "recebimento". */
type Candidato = { candidato: RTCIceCandidateInit; canal: Canal | 'voz' };

// ===== Do navegador para o servidor =====

export type MensagemParaOServidor =
  // Com `grupo`, um grupo criado na hora (a sala é a dele, e `sala` vai vazia); `criar` o cria se não existe.
  // servidor: o código de um servidor salvo (sem senha, só membros com a conta; sala e senha vão vazias).
  | { tipo: 'entrar'; sala: string; senha: string; nome: string; ficha: string; grupo?: string; criar?: boolean; servidor?: string }
  | { tipo: 'comecei' }
  | { tipo: 'parei' }
  | { tipo: 'assistir'; para: string }
  | { tipo: 'deixar'; para: string }
  | ({ tipo: 'oferta'; para: string } & Descricao)
  | ({ tipo: 'resposta'; para: string } & Descricao)
  | ({ tipo: 'candidato'; para: string } & Candidato)
  | { tipo: 'gravar-sala'; ligada: boolean }
  | { tipo: 'medidas'; pacote: Pacote }
  // O chat da sala: o servidor só repassa para todos da sala (quem mandou também) e não guarda nada.
  | { tipo: 'chat'; texto: string }
  // Chamar a atenção de alguém da sala: um som e um aviso só para essa pessoa, uma vez por minuto (o servidor confere).
  | { tipo: 'chamar'; para: string }
  | { tipo: 'ping' };

/** Os sinais da conversa por voz (voz/voz.ts), que passam pelo mesmo servidor. */
export type SinalDeVozParaEnviar = Extract<MensagemParaOServidor, { tipo: 'oferta' | 'resposta' | 'candidato' }> & { canal: 'voz' };

// ===== Do servidor para o navegador =====

export type MotivoDoErro =
  | 'senha-errada'
  | 'grupo-nao-existe'
  | 'grupo-em-uso'
  | 'grupo-invalido'
  | 'senha-curta'
  | 'muitos-grupos'
  | 'grupos-demais'
  // Dos servidores salvos: sem conta, não é membro (ou não existe), banco fora do ar; e, já na sala, tirado dela.
  | 'sem-conta'
  | 'servidor-nao-existe'
  | 'servidores-indisponiveis'
  | 'expulso'
  | 'servidor-apagado'
  | 'muitas-tentativas'
  | 'sala-cheia'
  | 'codigo-invalido'
  | 'ja-esta-numa-sala'
  | 'entre-numa-sala-primeiro'
  | 'destinatario-nao-esta-na-sala'
  | 'sala-ja-gravando'
  | 'mensagem-invalida'
  | 'chat-rapido-demais'
  | 'chamar-cedo-demais'
  | 'tipo-desconhecido';

export type MensagemDoServidor =
  | {
      tipo: 'bem-vindo';
      id: string;
      ficha: string;
      // O nome com que entrei: com conta, o dela (o servidor ignora o que a página mandou). Sem `conta`, convidado.
      nome?: string;
      conta?: string;
      foto?: string;
      outros: Pessoa[];
      compartilhando: string[];
      plateias: Record<string, string[]>;
      gravando?: { id: string; nome: string };
      // A retransmissão para quem não conecta direto (Retransmissao.java), uma para o vídeo (`retransmissao`, o nome de
      // antes) e outra para a voz; sem elas, só conexões diretas. limiteDoVideo: por que o vídeo veio sem.
      retransmissao?: RTCIceServer[];
      retransmissaoDaVoz?: RTCIceServer[];
      limiteDoVideo?: LimiteDoVideo;
      // Convidado num servidor com a retransmissão ligada: entrando com a conta, ela vem (Retransmissao.java).
      retransmissaoSoComConta?: true;
    }
  | ({ tipo: 'entrou' } & Pessoa)
  | { tipo: 'saiu'; id: string }
  | { tipo: 'pode-compartilhar' }
  | { tipo: 'compartilhando'; id: string }
  | { tipo: 'parou'; id: string }
  | { tipo: 'plateia'; id: string; ids: string[] }
  | { tipo: 'assistir'; de: string }
  | { tipo: 'deixar'; de: string }
  | ({ tipo: 'oferta'; de: string } & Descricao)
  | ({ tipo: 'resposta'; de: string } & Descricao)
  | ({ tipo: 'candidato'; de: string } & Candidato)
  // Quem gravava e saiu da sala: o aviso de fim vem sem o nome.
  | { tipo: 'gravacao-da-sala'; ligada: boolean; id: string; nome?: string | null }
  // O pacote vem de outro PC: quem recebe confere antes de usar (desempenho/gravadorDaSala.ts).
  | { tipo: 'medidas'; de: string; pacote: unknown }
  // O texto já vem limpo pelo servidor (sem caracteres de controle, até 500 caracteres).
  | { tipo: 'chat'; de: string; texto: string }
  // A prévia de um link de vídeo do chat, buscada pelo servidor (PreviasDeLinks): chega logo depois da mensagem.
  | { tipo: 'previa'; url: string; site: string; titulo?: string; autor?: string; miniatura?: string; aoVivo?: boolean }
  | { tipo: 'chamado'; de: string }
  // As credenciais da retransmissão que valem agora: `servidores` do vídeo, `voz` da voz; a lista vazia, cortada.
  | { tipo: 'retransmissao'; servidores: RTCIceServer[]; voz?: RTCIceServer[]; limiteDoVideo?: LimiteDoVideo }
  | { tipo: 'erro'; motivo: MotivoDoErro }
  | { tipo: 'pong' };

/** Por que o vídeo ficou sem a retransmissão: o uso desta pessoa passou do limite do dia, ou o de todos juntos. */
export type LimiteDoVideo = 'seu' | 'geral';

export type SinalDoServidor = Extract<MensagemDoServidor, { tipo: 'oferta' | 'resposta' | 'candidato' }>;

/** O texto que chegou pelo WebSocket, se tiver cara de mensagem (um objeto com `tipo`). */
export function lerMensagem(texto: string): MensagemDoServidor | null {
  try {
    const msg: unknown = JSON.parse(texto);
    return typeof msg === 'object' && msg !== null && typeof (msg as { tipo?: unknown }).tipo === 'string'
      ? (msg as MensagemDoServidor)
      : null;
  } catch {
    return null;
  }
}
