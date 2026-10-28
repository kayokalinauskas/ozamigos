// A conta de quem usa a página (login pelo Google ou pelo Discord; ContaApi.java no servidor). Um store pequeno, sem
// React, como o cliente: os componentes leem com useConta() e chamam as ações daqui.
//
// O servidor é quem manda: a sessão vai no cookie (que a página nem enxerga, HttpOnly), e na sala o nome e a foto vêm
// da conta no "bem-vindo". Daqui, só o que a entrada e a engrenagem mostram.

import { useSyncExternalStore } from 'react';
import { noApp, ponte } from './ponte';

export type Provedor = 'google' | 'discord';

export const NOME_DO_PROVEDOR: Record<Provedor, string> = { google: 'Google', discord: 'Discord' };

export type Conta = { id: string; nome: string; foto: string | null; provedores: Provedor[] };

export type EstadoDaConta = {
  carregada: boolean; // já perguntou ao servidor quem é (antes disso, a entrada mostra o de sempre)
  login: Provedor[]; // com o que dá para entrar; vazio sem login no servidor, ou num app antigo
  conta: Conta | null;
  ocupada: boolean; // entrando, saindo, salvando
  erro: string;
};

/** Os motivos que voltam do login (?erro-de-login=, ou da porta do app), em texto para a pessoa. */
const MOTIVOS: Record<string, string> = {
  indisponivel: 'Não foi possível entrar com a conta agora. Entre como convidado ou tente de novo daqui a pouco.',
  recusado: 'O login não foi concluído. Tente de novo.',
  'muitas-tentativas': 'Muitas tentativas de entrar em pouco tempo. Espere alguns minutos e tente de novo.',
  'contas-novas-demais': 'Muitas contas novas no Ozamigos agora. Tente de novo daqui a uma hora.',
  // Quem testou os dois logins separados tem duas contas: o texto diz como juntar (sem mesclar contas no servidor).
  'de-outra-pessoa':
    'Essa conta já entrou no Ozamigos sozinha, como outra conta. Para juntar as duas: saia, entre com ela, apague-a em Configurações → Conta, e ligue de novo aqui.',
  'ja-tem-desse-provedor': 'A sua conta já tem uma conta desse tipo ligada.',
  'sem-conta': 'Entre na sua conta primeiro.',
  tempo: 'O login demorou demais. Tente de novo.',
  'codigo-invalido': 'O login demorou demais. Tente de novo.',
};
const MOTIVO_DESCONHECIDO = 'Não foi possível abrir o login. Tente de novo.';

export function textoDoMotivo(motivo: string): string {
  return MOTIVOS[motivo] ?? MOTIVO_DESCONHECIDO;
}

/** No app, o login vai pelo navegador do sistema (1.3.0 em diante); um app antigo não tem o botão. */
const LOGIN_POSSIVEL = !noApp || Boolean(ponte?.conta);

let estado: EstadoDaConta = { carregada: false, login: [], conta: null, ocupada: false, erro: '' };
const ouvintes = new Set<() => void>();

function mudar(parcial: Partial<EstadoDaConta>) {
  estado = { ...estado, ...parcial };
  ouvintes.forEach((ouvinte) => ouvinte());
}

export function useConta(): EstadoDaConta {
  return useSyncExternalStore(
    (ouvinte) => {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    () => estado,
  );
}

export function lerConta(): EstadoDaConta {
  return estado;
}

/** Sem resposta, ou com o banco ainda não pronto: pergunta de novo nesse ritmo, mais devagar depois de um tempo. */
const NOVA_TENTATIVA_MS = 3_000;
const NOVA_TENTATIVA_DEMORADA_MS = 10_000;
/** Até lá, a entrada mostra "Carregando…"; depois, o aviso de indisponível (e continua tentando por trás). */
const AVISAR_DEPOIS_MS = 20_000;
let indisponivelDesde: number | null = null;
let novaTentativa: ReturnType<typeof setTimeout> | undefined;

/**
 * Pergunta ao servidor quem é. Sem resposta (sem internet), ou com o banco ainda não pronto (o servidor acabou de
 * acordar: ele responde antes do banco), pergunta de novo sozinha, até dar: antes, a entrada ficava em "não está
 * disponível agora" até a pessoa reabrir o app.
 */
export async function carregarConta(): Promise<void> {
  clearTimeout(novaTentativa);
  try {
    const resposta = await fetch('/api/eu', { cache: 'no-store' });
    if (!resposta.ok) throw new Error(String(resposta.status));
    const corpo = (await resposta.json()) as { login?: Provedor[]; conta?: Conta | null; indisponivel?: boolean };
    if (!corpo.indisponivel) {
      indisponivelDesde = null;
      mudar({ carregada: true, login: LOGIN_POSSIVEL ? (corpo.login ?? []) : [], conta: corpo.conta ?? null });
      return;
    }
  } catch {
    // sem resposta: como indisponível
  }
  indisponivelDesde ??= Date.now();
  const esperou = Date.now() - indisponivelDesde;
  // Só na abertura: uma conta já carregada (a releitura depois de ligar ou desligar um provedor) fica como estava.
  if (esperou >= AVISAR_DEPOIS_MS && !estado.carregada) mudar({ carregada: true, login: [], conta: null });
  novaTentativa = setTimeout(() => void carregarConta(), esperou >= AVISAR_DEPOIS_MS ? NOVA_TENTATIVA_DEMORADA_MS : NOVA_TENTATIVA_MS);
}

/**
 * O erro que voltou do login (?erro-de-login=), lido quando este módulo carrega: o cliente (que importa este módulo)
 * reescreve o endereço da sala ao nascer, e o erro se perderia.
 */
const ERRO_DO_LOGIN = new URLSearchParams(location.search).get('erro-de-login');

/**
 * O erro que voltou do login para a entrada: vira o aviso da conta, e sai do endereço (recarregar não mostra de novo,
 * e copiar o link não leva o erro junto).
 */
export function lerErroDoEndereco() {
  if (!ERRO_DO_LOGIN) return;
  const motivo = ERRO_DO_LOGIN;
  const parametros = new URLSearchParams(location.search);
  parametros.delete('erro-de-login');
  const resto = parametros.toString();
  history.replaceState(null, '', location.pathname + (resto ? `?${resto}` : '') + location.hash);
  mudar({ erro: textoDoMotivo(motivo) });
}

/** Para onde o navegador volta depois do login: esta mesma página. */
function aqui(): string {
  return location.pathname + location.search;
}

const VOLTANDO_DO_LOGIN = 'ozamigos-voltando-do-login';

/** Indo para o provedor: a volta é a mesma página, e não um link de convite (voltouDoLogin). */
function irAoProvedor(endereco: string) {
  try {
    sessionStorage.setItem(VOLTANDO_DO_LOGIN, 'sim');
  } catch {
    // sem o sessionStorage, a volta pode mostrar a pergunta do convite: é só continuar
  }
  location.assign(endereco);
}

/**
 * A página abriu na volta do login (uma vez): a sala no endereço é a de antes, e não um link que um amigo mandou, então
 * o cliente não pergunta se a pessoa quer abrir no app (Convite.tsx).
 */
export function voltouDoLogin(): boolean {
  try {
    const voltou = sessionStorage.getItem(VOLTANDO_DO_LOGIN) === 'sim';
    sessionStorage.removeItem(VOLTANDO_DO_LOGIN);
    return voltou;
  } catch {
    return false;
  }
}

/**
 * Entrar com o Google ou o Discord. No navegador, a página vai ao provedor e volta já logada. No app, o login abre no
 * navegador do sistema e o app recebe um código de uso único, que vira a sessão no cookie desta janela. Resolve true
 * quando a página continua aberta e logada (só no app).
 */
export async function entrarCom(provedor: Provedor): Promise<boolean> {
  if (!ponte?.conta) {
    irAoProvedor(`/conta/entrar/${provedor}?voltar=${encodeURIComponent(aqui())}`);
    return false;
  }
  mudar({ ocupada: true, erro: '' });
  const volta = await pelaPonte(() => ponte!.conta!.loginPeloNavegador(provedor));
  if (!volta.codigo) return falhou(volta.erro);
  const troca = await enviar('POST', '/api/conta/codigo', { codigo: volta.codigo });
  if (!troca.ok) return falhou(troca.motivo);
  await carregarConta();
  mudar({ ocupada: false });
  return true;
}

/** Ligar mais um provedor à conta (Configurações → Conta). No app, com um código de ligação, pelo navegador. */
export async function ligar(provedor: Provedor): Promise<void> {
  if (!ponte?.conta) {
    irAoProvedor(`/conta/ligar/${provedor}?voltar=${encodeURIComponent(aqui())}`);
    return;
  }
  mudar({ ocupada: true, erro: '' });
  const pedido = await enviar('POST', '/api/eu/ligacao');
  if (!pedido.ok || typeof pedido.corpo?.ligacao !== 'string') {
    falhou(pedido.motivo);
    return;
  }
  const ligacao = pedido.corpo.ligacao;
  const volta = await pelaPonte(() => ponte!.conta!.loginPeloNavegador(provedor, ligacao));
  if (!volta.codigo) {
    falhou(volta.erro);
    return;
  }
  // A ligação só vale com esta confirmação: o código chegou à porta deste app, e a sessão é a desta janela. Um link
  // de ligação aberto por outra pessoa não liga nada (ContaApi.confirmarLigacao).
  const confirmacao = await enviar('POST', '/api/eu/ligacao/confirmar', { codigo: volta.codigo });
  if (!confirmacao.ok) {
    falhou(confirmacao.motivo);
    return;
  }
  await carregarConta();
  mudar({ ocupada: false });
}

export async function desligar(provedor: Provedor): Promise<void> {
  mudar({ ocupada: true, erro: '' });
  const resposta = await enviar('DELETE', `/api/eu/provedores/${provedor}`);
  if (!resposta.ok) {
    falhou(resposta.motivo === 'ultima' ? 'ultima' : resposta.motivo, 'A conta precisa de pelo menos uma forma de entrar.');
    return;
  }
  await carregarConta();
  mudar({ ocupada: false });
}

/** O nome novo, já limpo pelo servidor (as mesmas regras do nome na sala); null se não deu. */
export async function renomear(nome: string): Promise<string | null> {
  mudar({ ocupada: true, erro: '' });
  const resposta = await enviar('PATCH', '/api/eu', { nome });
  if (!resposta.ok || typeof resposta.corpo?.nome !== 'string' || !estado.conta) {
    falhou(resposta.motivo);
    return null;
  }
  mudar({ ocupada: false, conta: { ...estado.conta, nome: resposta.corpo.nome } });
  return resposta.corpo.nome;
}

/** Sai da conta neste aparelho. Resolve true se saiu. */
export async function sairDaConta(): Promise<boolean> {
  mudar({ ocupada: true, erro: '' });
  const resposta = await enviar('POST', '/api/eu/sair');
  if (!resposta.ok) return falhou(resposta.motivo);
  mudar({ ocupada: false, conta: null });
  return true;
}

/** Sai da conta em todos os aparelhos, este inclusive (e quem estava numa sala com ela sai). Resolve true se saiu. */
export async function sairDeTodos(): Promise<boolean> {
  mudar({ ocupada: true, erro: '' });
  const resposta = await enviar('POST', '/api/eu/sair-de-todos');
  if (!resposta.ok) return falhou(resposta.motivo);
  mudar({ ocupada: false, conta: null });
  return true;
}

/** Apaga a conta e tudo dela, na hora. Resolve true se apagou. */
export async function apagarConta(): Promise<boolean> {
  mudar({ ocupada: true, erro: '' });
  const resposta = await enviar('DELETE', '/api/eu', { confirmar: true });
  if (!resposta.ok) return falhou(resposta.motivo);
  mudar({ ocupada: false, conta: null });
  return true;
}

/** A ponte do app recusou (a janela recarregou, um erro do processo principal): vira um erro comum, sem travar nada. */
async function pelaPonte(chamar: () => Promise<{ codigo?: string; erro?: string }>) {
  try {
    return await chamar();
  } catch {
    return { erro: 'navegador' };
  }
}

function falhou(motivo: string | undefined, texto?: string): false {
  // Outro login começou por cima deste: o novo é que diz como terminou.
  if (motivo === 'outro-login') return false;
  mudar({ ocupada: false, erro: texto ?? textoDoMotivo(motivo ?? '') });
  return false;
}

export type Resposta = { ok: boolean; motivo?: string; corpo?: Record<string, unknown> };

/**
 * Os pedidos à API: JSON, na mesma origem (o servidor confere o Origin das ações, ProtecaoDaApi.java). Um `Blob` vai
 * como está (o ícone de um servidor). Sem rede, `motivo` é "rede".
 */
export async function enviar(metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
  try {
    const arquivo = corpo instanceof Blob;
    const resposta = await fetch(caminho, {
      method: metodo,
      cache: 'no-store',
      headers: corpo === undefined || arquivo ? undefined : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : arquivo ? corpo : JSON.stringify(corpo),
    });
    const texto = await resposta.text();
    const json = texto ? (JSON.parse(texto) as Record<string, unknown>) : undefined;
    return { ok: resposta.ok, motivo: typeof json?.erro === 'string' ? json.erro : undefined, corpo: json };
  } catch {
    return { ok: false, motivo: 'rede' };
  }
}
