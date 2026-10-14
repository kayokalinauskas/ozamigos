// O relatório da sessão: medidas de cada segundo e acontecimentos, para entender depois o que aconteceu
// numa noite com os amigos (o painel de estatísticas baixa tudo como JSON).

import type { Metrica } from './medidor';

/** Uma linha do relatório: uma medida de uma conexão, ou um acontecimento. */
export type LinhaDoRelatorio = { momento: string } & ({ evento: string } | ({ medida: string } & Omit<Metrica, 'id'>));

// As últimas linhas: umas 2 horas com 2 conexões.
const LIMITE_DO_RELATORIO = 15_000;

export class Relatorio {
  readonly linhas: LinhaDoRelatorio[] = [];

  registrar(evento: string) {
    this.guardar({ momento: new Date().toISOString(), evento });
  }

  /** As medidas deste segundo, uma linha por conexão, com o nome de quem está do outro lado. */
  registrarMedidas(metricas: Record<string, Metrica>, nomeDe: (id: string) => string) {
    const momento = new Date().toISOString();
    for (const { id, ...medida } of Object.values(metricas)) this.guardar({ momento, medida: nomeDe(id), ...medida });
  }

  private guardar(linha: LinhaDoRelatorio) {
    this.linhas.push(linha);
    if (this.linhas.length > LIMITE_DO_RELATORIO) this.linhas.shift();
  }
}
