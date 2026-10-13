// A análise da gravação da sala: cada transmissão vira uma Gravacao (modo "sala") e passa pela mesma análise
// do teste (analise.ts). Por cima disso, o que só aparece olhando a sala inteira: quem transmite e assiste ao
// mesmo tempo, e o PC de quem só assiste.

import type { Qualidade } from '../qualidade';
import { analisar, fmt, type Analise, type Diagnostico } from './analise';
import { FORMATO, type Gravacao, type GravacaoDaSala } from './tipos';

export type TransmissaoDaSala = { nome: string; g: Gravacao; a: Analise };

export type ResumoDaPessoa = {
  nome: string;
  app: string;
  placa: string | null;
  segundos: number; // com medidas
  transmitiu: number; // segundos transmitindo para alguém
  assistiu: number; // segundos assistindo alguém
  assistiuQuem: string[];
  fluidezAssistindo: number | null; // % dos quadros no tempo, em tudo que essa pessoa assistiu (dos trechos de cada transmissão)
  congelamentosAssistindo: number;
  msDecodificacao: number | null;
  cpuApp: number | null;
  cpuPc: number | null;
  cpuPcMax: number | null;
  placa3d: number | null;
  placa3dMax: number | null;
  placaVideo: number | null;
  placaVideoMax: number | null;
  janelaVisivelPct: number | null;
  tarefasLongas: number;
  msTarefaMaior: number;
};

export type AnaliseDaSala = {
  transmissoes: TransmissaoDaSala[];
  pessoas: ResumoDaPessoa[];
  diagnosticos: Diagnostico[];
  resumo: { titulo: string; texto: string };
};

const valores = (lista: (number | null | undefined)[]) => lista.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
const media = (lista: (number | null | undefined)[]) => {
  const v = valores(lista);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
const maximo = (lista: (number | null | undefined)[]) => {
  const v = valores(lista);
  return v.length ? Math.max(...v) : null;
};
const mediana = (lista: (number | null | undefined)[]) => {
  const v = valores(lista).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

/** Cada pessoa que transmitiu para alguém vira uma Gravacao, como as do teste, com o nome dela. */
export function transmissoesDaSala(gs: GravacaoDaSala): { nome: string; g: Gravacao }[] {
  return Object.entries(gs.trechos)
    .filter(([, trechos]) => trechos.some((t) => t.fim > t.inicio))
    .map(([nome, trechos]) => {
      const pessoa = gs.pessoas.find((p) => p.nome === nome);
      const ambiente = pessoa?.ambiente ?? null;
      const recepcao = gs.recepcao.filter((r) => r.transmissor === nome);
      const quemAssistiu = [...new Set(recepcao.map((r) => r.espectador))];
      const qualidades = trechos.map((t) => t.qualidade);
      const qualidade = qualidades.sort((a, b) => qualidades.filter((q) => q === b).length - qualidades.filter((q) => q === a).length)[0] as Qualidade;
      const g: Gravacao = {
        formato: FORMATO,
        modo: 'sala',
        roteiro: null,
        inicio: gs.inicio,
        duracao: gs.duracao,
        interrompido: false,
        app: ambiente?.app ?? '?',
        navegador: ambiente?.navegador ?? '?',
        pc: ambiente?.pc ?? null,
        tela: ambiente?.tela ?? '?',
        qualidadeDaPessoa: qualidade,
        fonte: pessoa?.fontes.join(' | ') || '?',
        ajustes: gs.ajustes,
        qualidades: gs.qualidades,
        trechos: trechos.filter((t) => t.fim > t.inicio),
        espectadoresReais: quemAssistiu.map((n) => ({ nome: n, ambiente: gs.pessoas.find((p) => p.nome === n)?.ambiente ?? null })),
        envio: gs.envio.filter((e) => e.transmissor === nome),
        captura: gs.captura.filter((c) => c.pessoa === nome),
        recepcao,
        pcAmostras: gs.pcAmostras.filter((p) => p.pessoa === nome),
        pagina: gs.pagina.filter((p) => p.pessoa === nome),
        acontecimentos: gs.acontecimentos.filter((a) => !a.transmissao || a.transmissao === nome),
      };
      return { nome, g };
    });
}

function resumirPessoa(gs: GravacaoDaSala, nome: string, transmissoes: TransmissaoDaSala[]): ResumoDaPessoa {
  const pessoa = gs.pessoas.find((p) => p.nome === nome);
  const pcs = gs.pcAmostras.filter((p) => p.pessoa === nome);
  const paginas = gs.pagina.filter((p) => p.pessoa === nome);
  const assistindo = gs.recepcao.filter((r) => r.espectador === nome);
  const transmitindo = gs.envio.filter((e) => e.transmissor === nome);
  // A mesma fluidez da tabela "Por espectador" de cada transmissão, ponderada pelos segundos de cada trecho.
  const comMedida = transmissoes.flatMap(({ a }) =>
    a.trechos.flatMap((t) => t.recepcao.porEspectador.filter((e) => e.nome === nome && e.fluidez != null).map((e) => ({ f: e.fluidez, n: t.segundos }))),
  );
  const placa = pessoa?.ambiente?.pc?.placa?.nome ?? null;
  return {
    nome,
    app: pessoa?.ambiente?.app ?? '?',
    placa,
    segundos: new Set(paginas.map((p) => p.t)).size,
    transmitiu: new Set(transmitindo.map((e) => e.t)).size,
    assistiu: new Set(assistindo.map((r) => r.t)).size,
    assistiuQuem: [...new Set(assistindo.map((r) => r.transmissor))],
    fluidezAssistindo: comMedida.some((x) => x.n > 0) ? Math.round((comMedida.reduce((s, x) => s + x.f! * x.n, 0) / comMedida.reduce((s, x) => s + x.n, 0)) * 10) / 10 : null,
    congelamentosAssistindo: assistindo.reduce((s, r) => s + r.congelamentos, 0),
    msDecodificacao: media(assistindo.map((r) => r.msDecodificacao)),
    cpuApp: media(pcs.map((p) => p.cpuApp)),
    cpuPc: media(pcs.map((p) => p.cpuPc)),
    cpuPcMax: maximo(pcs.map((p) => p.cpuPc)),
    placa3d: media(pcs.map((p) => p.placa3dTotal)),
    placa3dMax: maximo(pcs.map((p) => p.placa3dTotal)),
    placaVideo: media(pcs.map((p) => p.placaVideoTotal)),
    placaVideoMax: maximo(pcs.map((p) => p.placaVideoTotal)),
    janelaVisivelPct: paginas.length ? Math.round((paginas.filter((p) => p.janelaVisivel).length / paginas.length) * 100) : null,
    tarefasLongas: paginas.reduce((s, p) => s + p.tarefasLongas, 0),
    msTarefaMaior: maximo(paginas.map((p) => p.msTarefaMaior)) ?? 0,
  };
}

/** O que só aparece olhando a sala inteira. */
function diagnosticarSala(gs: GravacaoDaSala, transmissoes: TransmissaoDaSala[], pessoas: ResumoDaPessoa[]): Diagnostico[] {
  const lista: Diagnostico[] = [];

  // Transmitir e assistir ao mesmo tempo: o mesmo PC codifica a própria imagem e decodifica a do outro.
  for (const { nome, a } of transmissoes) {
    const validos = a.trechos.filter((t) => t.segundos > 0);
    const assistindo = validos.filter((t) => (t.trecho.assistindo ?? 0) > 0);
    const sozinho = validos.filter((t) => !t.trecho.assistindo);
    if (!assistindo.length || !sozinho.length) continue;
    const codSo = mediana(sozinho.map((t) => t.envio.msCodificacao));
    const codJunto = mediana(assistindo.map((t) => t.envio.msCodificacao));
    const flSo = media(sozinho.map((t) => t.recepcao.fluidez));
    const flJunto = media(assistindo.map((t) => t.recepcao.fluidez));
    const piorou = (flSo != null && flJunto != null && flSo - flJunto >= 3) || (codSo != null && codJunto != null && codJunto > codSo * 1.3 + 1);
    lista.push({
      gravidade: piorou ? 'media' : 'ok',
      codigo: 'transmite-e-assiste',
      titulo: piorou
        ? `A transmissão de ${nome} piorou enquanto ${nome} também assistia alguém`
        : `Assistir alguém ao mesmo tempo não atrapalhou a transmissão de ${nome}`,
      detalhe:
        'Quem transmite e assiste ao mesmo tempo codifica a própria imagem e decodifica a do outro no mesmo PC (e na mesma placa de vídeo, junto com o jogo). Comparação dos trechos com e sem assistir.',
      evidencias: [
        `Sem assistir: codificação ${fmt(codSo, ' ms')}/quadro, fluidez de quem assistia ${fmt(flSo, '%')} (${sozinho.length} trechos)`,
        `Assistindo: codificação ${fmt(codJunto, ' ms')}/quadro, fluidez de quem assistia ${fmt(flJunto, '%')} (${assistindo.length} trechos)`,
      ],
      paraOApp: piorou ? 'Avaliar baixar a qualidade da própria transmissão (ou a de recepção) enquanto a pessoa também assiste alguém.' : undefined,
    });
  }

  // O PC de quem assiste: a imagem chega bem, mas o PC não dá conta de mostrar
  for (const p of pessoas) {
    if (!p.assistiu || p.fluidezAssistindo == null || p.fluidezAssistindo >= 97) continue;
    const cheio = (p.cpuPcMax ?? 0) >= 90 || (p.placa3dMax ?? 0) >= 95 || (p.msDecodificacao ?? 0) > 8;
    if (!cheio) continue;
    lista.push({
      gravidade: 'media',
      codigo: 'pc-de-quem-assiste',
      titulo: `O PC de ${p.nome} estava cheio enquanto assistia (fluidez ${fmt(p.fluidezAssistindo, '%')})`,
      detalhe: 'Quem assiste também precisa de processador e placa de vídeo para decodificar e desenhar o vídeo; se estiver jogando ao mesmo tempo, o jogo disputa os dois.',
      evidencias: [
        `Processador do PC: média ${fmt(p.cpuPc, '%')}, máximo ${fmt(p.cpuPcMax, '%')}`,
        `Placa 3D: média ${fmt(p.placa3d, '%')}, máximo ${fmt(p.placa3dMax, '%')}; decodificação ${fmt(p.msDecodificacao, ' ms')}/quadro`,
        `Assistiu: ${p.assistiuQuem.join(', ')}; congelamentos: ${p.congelamentosAssistindo}`,
      ],
      paraVoce: `${p.nome} pode limitar o fps do jogo para sobrar placa para o vídeo.`,
    });
  }

  if (!transmissoes.length) {
    lista.push({
      gravidade: 'media',
      codigo: 'sem-transmissao',
      titulo: 'Ninguém transmitiu para alguém durante a gravação',
      detalhe: 'A gravação só tem o que medir quando alguém transmite e outra pessoa assiste.',
      evidencias: [`Pessoas com medidas: ${gs.pessoas.map((p) => p.nome).join(', ') || 'nenhuma'}`],
      paraVoce: 'Grave de novo com pelo menos uma pessoa transmitindo e outra assistindo.',
    });
  }
  const ordem = { alta: 0, media: 1, baixa: 2, ok: 3 };
  return lista.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
}

const NOME_DO_RESULTADO = { otimo: 'ótima', bom: 'boa', atencao: 'com engasgos', ruim: 'ruim' } as const;

export function analisarSala(gs: GravacaoDaSala): AnaliseDaSala {
  const transmissoes = transmissoesDaSala(gs).map(({ nome, g }) => ({ nome, g, a: analisar(g) }));
  const pessoas = gs.pessoas.map((p) => resumirPessoa(gs, p.nome, transmissoes));
  const diagnosticos = diagnosticarSala(gs, transmissoes, pessoas);
  if (!transmissoes.length) return { transmissoes, pessoas, diagnosticos, resumo: { titulo: 'Ninguém transmitiu para alguém durante a gravação', texto: '' } };
  const ordem = ['otimo', 'bom', 'atencao', 'ruim'] as const;
  const pior = (a: Analise) => {
    const validos = a.trechos.filter((t) => t.segundos > 0);
    return validos.reduce((p, t) => (ordem.indexOf(t.resultado) > ordem.indexOf(p) ? t.resultado : p), 'otimo' as (typeof ordem)[number]);
  };
  const frases = transmissoes.map(({ nome, a }) => {
    const quem = [...new Set(a.trechos.flatMap((t) => t.recepcao.porEspectador.map((e) => e.nome)))];
    const resultado = a.trechos.some((t) => t.segundos > 0) ? NOME_DO_RESULTADO[pior(a)] : 'sem dados suficientes';
    const gargalo = a.diagnosticos.find((d) => d.gravidade === 'alta' || d.gravidade === 'media');
    return `${nome} → ${quem.join(', ') || '?'}: ${resultado}${gargalo && pior(a) !== 'otimo' ? ` (${gargalo.titulo.charAt(0).toLowerCase()}${gargalo.titulo.slice(1)})` : ''}`;
  });
  const problemas = transmissoes.filter(({ a }) => ['atencao', 'ruim'].includes(pior(a)));
  return {
    transmissoes,
    pessoas,
    diagnosticos,
    resumo: {
      titulo: problemas.length
        ? `${problemas.length === transmissoes.length ? 'Todas as transmissões' : `${problemas.length} de ${transmissoes.length} transmissões`} tiveram trechos com problema`
        : `${transmissoes.length === 1 ? 'A transmissão foi boa' : 'As transmissões foram boas'} para todos que assistiram`,
      texto: frases.join('; ') + '.',
    },
  };
}
