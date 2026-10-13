// O worker da gravação da sala: guarda as linhas de cada segundo e gera os arquivos (análise, relatório para IA,
// páginas e JSON) fora da thread da página. Com 1 hora e 4 pessoas, gerar tudo leva ~0,5 s: na página, isso
// travaria o vídeo de quem grava a cada salvamento (e sujaria as próprias medidas).
// Só importa código sem DOM: análise e relatórios.

import { analisarSala } from './analiseDaSala';
import { relatorioHtml } from './relatorioHtml';
import { relatorioDaSalaParaIa } from './relatorioIa';
import type { GravacaoDaSala } from './tipos';

/** As listas que só crescem: a página manda só as linhas novas, a cada segundo. */
export type Linhas = Pick<GravacaoDaSala, 'envio' | 'captura' | 'recepcao' | 'pcAmostras' | 'pagina' | 'acontecimentos' | 'papeis'>;
/** O resto é pequeno e vai inteiro. */
export type Meta = Omit<GravacaoDaSala, keyof Linhas>;

export type Pedido =
  | { tipo: 'linhas'; meta: Meta; novas: Linhas }
  | { tipo: 'gerar'; id: number; final: boolean };

export type Resposta = { tipo: 'arquivos'; id: number; arquivos: Record<string, string> } | { tipo: 'erro'; id: number; mensagem: string };

export const LISTAS: (keyof Linhas)[] = ['envio', 'captura', 'recepcao', 'pcAmostras', 'pagina', 'acontecimentos', 'papeis'];

/** Nome de arquivo sem caracteres que o Windows recusa. */
const nomeDeArquivo = (texto: string) => texto.replace(/[\\/:*?"<>|]/g, '_').trim() || 'sem nome';

/**
 * Os arquivos de uma gravação. Durante a gravação, só o relatório para IA (o principal, e pequeno); no fim,
 * também os dados completos e uma página com gráficos por transmissão.
 */
export function arquivosDaGravacao(gs: GravacaoDaSala, final: boolean): Record<string, string> {
  const analise = analisarSala(gs);
  const arquivos: Record<string, string> = { 'estatisticas para IA.md': relatorioDaSalaParaIa(gs, analise) };
  if (final) {
    arquivos['dados.json'] = JSON.stringify(gs);
    for (const { nome, g, a } of analise.transmissoes) arquivos[`transmissao de ${nomeDeArquivo(nome)}.html`] = relatorioHtml(g, a, nome);
  }
  return arquivos;
}

// Dentro do worker (não roda quando o arquivo é importado pela página ou pelos testes).
const escopo = globalThis as unknown as { WorkerGlobalScope?: unknown; onmessage: ((evento: MessageEvent<Pedido>) => void) | null; postMessage(resposta: Resposta): void };
if (typeof escopo.WorkerGlobalScope !== 'undefined') {
  let gs: GravacaoDaSala | null = null;
  escopo.onmessage = (evento) => {
    const pedido = evento.data;
    if (pedido.tipo === 'linhas') {
      if (!gs) gs = { ...pedido.meta, envio: [], captura: [], recepcao: [], pcAmostras: [], pagina: [], acontecimentos: [], papeis: [] };
      Object.assign(gs, pedido.meta);
      for (const lista of LISTAS) (gs[lista] as unknown[]).push(...pedido.novas[lista]);
      return;
    }
    try {
      if (!gs) throw new Error('nenhuma linha recebida');
      const resposta: Resposta = { tipo: 'arquivos', id: pedido.id, arquivos: arquivosDaGravacao(gs, pedido.final) };
      escopo.postMessage(resposta);
    } catch (erro) {
      escopo.postMessage({ tipo: 'erro', id: pedido.id, mensagem: String(erro) });
    }
  };
}
