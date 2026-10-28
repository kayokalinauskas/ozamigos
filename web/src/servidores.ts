// Os servidores salvos (ServidoresApi.java no servidor): a lista na entrada, a página de um servidor, os convites e as
// configurações dele. Quem decide quem pode o quê é o servidor; aqui, o papel só esconde os botões que não serviriam.

import { useCallback, useEffect, useState } from 'react';
import { enviar, type Resposta } from './conta';

export type Papel = 'dono' | 'admin' | 'membro';

export type ResumoDoServidor = { codigo: string; nome: string; icone: string | null; papel: Papel; membros: number };

export type Membro = { conta: string; nome: string; foto: string | null; papel: Papel };

export type Servidor = {
  codigo: string;
  nome: string;
  icone: string | null;
  papel: Papel;
  membrosConvidam: boolean;
  membros: Membro[];
};

export type Convite = { codigo: string; expiraEm: string | null; usosMaximos: number | null; usos: number; criadoPor: string | null };

export type Bloqueado = { conta: string; nome: string; foto: string | null; desde: string; porQuem: string | null };

export type PreviaDoConvite = { nome: string; icone: string | null; membros: number };

/** O que dá para fazer com cada papel: a mesma regra de Servidores.java, só para mostrar os botões certos. */
export function pode(servidor: Servidor) {
  const { papel } = servidor;
  return {
    mudarNomeEIcone: papel !== 'membro',
    convidar: papel !== 'membro' || servidor.membrosConvidam,
    cuidarDosConvites: papel !== 'membro',
    decidirSeMembrosConvidam: papel === 'dono',
    mudarPapeis: papel === 'dono',
    expulsar: (alvo: Membro) => alvo.papel !== 'dono' && (papel === 'dono' || (papel === 'admin' && alvo.papel === 'membro')),
    passarPosse: papel === 'dono',
    apagar: papel === 'dono',
    sair: papel !== 'dono',
  };
}

/** Os motivos de recusa da API, em texto para a pessoa. */
const MOTIVOS: Record<string, string> = {
  'servidor-nao-existe': 'Esse servidor não existe, ou você não faz parte dele.',
  'sem-permissao': 'Você não tem permissão para isso neste servidor.',
  'membro-nao-existe': 'Essa pessoa não está mais no servidor.',
  'convite-invalido': 'Esse convite não vale mais: ele venceu, já foi usado todas as vezes ou foi apagado. Peça outro a quem mandou.',
  bloqueado: 'Você foi removido deste servidor e não pode voltar por convite. Fale com quem cuida dele.',
  'nome-invalido': 'Escolha um nome para o servidor.',
  'icone-invalido': 'Não deu para usar essa imagem. Tente outra (PNG, JPEG ou WebP, até 2 MB).',
  'dono-nao-sai': 'O dono não sai do servidor: passe a posse para outra pessoa, ou apague o servidor.',
  'servidores-demais': 'Cada pessoa pode ser dona de até 10 servidores.',
  'participa-demais': 'Cada pessoa pode participar de até 100 servidores.',
  'membros-demais': 'Esse servidor já tem o máximo de 100 membros.',
  'convites-demais': 'Esse servidor já tem 20 convites valendo. Apague alguns antes de criar outro.',
  'sem-conta': 'Entre com a sua conta primeiro.',
  'contas-indisponiveis': 'Os servidores estão indisponíveis agora. Tente de novo daqui a pouco.',
  'muitas-tentativas': 'Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.',
  rede: 'Sem conexão com o Ozamigos. Confira a internet e tente de novo.',
};

export function textoDoErro(resposta: Resposta): string {
  return MOTIVOS[resposta.motivo ?? ''] ?? 'Não deu certo. Tente de novo.';
}

/** O resultado de uma ação: o corpo, ou o erro já em texto. */
type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string; motivo?: string };

async function pedir<T>(metodo: string, caminho: string, corpo?: unknown): Promise<Resultado<T>> {
  const resposta = await enviar(metodo, caminho, corpo);
  return resposta.ok ? { ok: true, valor: resposta.corpo as T } : { ok: false, erro: textoDoErro(resposta), motivo: resposta.motivo };
}

const base = (codigo: string) => `/api/servidores/${codigo}`;

export const servidores = {
  meus: () => pedir<{ servidores: ResumoDoServidor[] }>('GET', '/api/servidores'),
  criar: (nome: string) => pedir<{ codigo: string }>('POST', '/api/servidores', { nome }),
  ver: (codigo: string) => pedir<Servidor>('GET', base(codigo)),
  mudar: (codigo: string, mudanca: { nome?: string; membrosConvidam?: boolean }) => pedir<Servidor>('PATCH', base(codigo), mudanca),
  trocarIcone: (codigo: string, imagem: Blob) => pedir<{ icone: string | null }>('PUT', `${base(codigo)}/icone`, imagem),
  tirarIcone: (codigo: string) => pedir<{ icone: null }>('DELETE', `${base(codigo)}/icone`),
  apagar: (codigo: string) => pedir<void>('DELETE', base(codigo), { confirmar: true }),
  passarPosse: (codigo: string, para: string) => pedir<Servidor>('POST', `${base(codigo)}/dono`, { para }),
  mudarPapel: (codigo: string, conta: string, papel: 'admin' | 'membro') => pedir<Servidor>('PATCH', `${base(codigo)}/membros/${conta}`, { papel }),
  /** A própria conta: sair do servidor. Outra: expulsar (e bloquear). */
  tirar: (codigo: string, conta: string) => pedir<void>('DELETE', `${base(codigo)}/membros/${conta}`),
  convites: (codigo: string) => pedir<{ convites: Convite[] }>('GET', `${base(codigo)}/convites`),
  convidar: (codigo: string, horas: number | null, usos: number | null) =>
    pedir<{ codigo: string }>('POST', `${base(codigo)}/convites`, { horas, usos }),
  apagarConvite: (codigo: string, convite: string) => pedir<void>('DELETE', `${base(codigo)}/convites/${convite}`),
  bloqueados: (codigo: string) => pedir<{ bloqueados: Bloqueado[] }>('GET', `${base(codigo)}/bloqueados`),
  desbloquear: (codigo: string, conta: string) => pedir<void>('DELETE', `${base(codigo)}/bloqueados/${conta}`),
  previa: (convite: string) => pedir<PreviaDoConvite>('GET', `/api/convites/${convite}`),
  aceitar: (convite: string) => pedir<{ servidor: string }>('POST', `/api/convites/${convite}`),
};

/**
 * Um servidor, lido da API quando o componente aparece (e de novo com `recarregar`, depois de uma mudança). `erro`: não
 * deu para ler (não é membro, sem rede...).
 */
export function useServidor(codigo: string | null) {
  const [servidor, setServidor] = useState<Servidor | null>(null);
  const [erro, setErro] = useState('');
  const recarregar = useCallback(async () => {
    if (!codigo) return;
    const lido = await servidores.ver(codigo);
    if (lido.ok) {
      setServidor(lido.valor);
      setErro('');
    } else {
      setErro(lido.erro);
    }
  }, [codigo]);
  useEffect(() => {
    void recarregar();
  }, [recarregar]);
  return { servidor, erro, recarregar, setServidor };
}
