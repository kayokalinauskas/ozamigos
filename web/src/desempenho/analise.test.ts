import { describe, expect, it } from 'vitest';
import { contarFaixas } from './amostradores';
import { analisar, fluidez, percentilDasFaixas } from './analise';
import { analisarSala } from './analiseDaSala';
import { relatorioDaSalaParaIa, relatorioParaIa } from './relatorioIa';
import { FORMATO, FORMATO_DA_SALA, type AmostraEnvio, type AmostraRecepcao, type Gravacao, type GravacaoDaSala, type Trecho } from './tipos';

/** Um trecho de 30 s com n espectadores: ms de codificação e o intervalo entre quadros na tela. */
function trecho(indice: number, inicio: number, espectadores: number, msCodificacao: number, intervalo: number, capturaFps = 30) {
  const t: Trecho = { indice, nome: '1080p · 30 fps', inicio, fim: inicio + 30, qualidade: 'nitida', espectadores, simulados: espectadores, aquecimento: false, descartarAte: inicio + 8 };
  const envio: AmostraEnvio[] = [];
  const recepcao: AmostraRecepcao[] = [];
  for (let s = inicio + 1; s <= inicio + 30; s++) {
    for (let e = 1; e <= espectadores; e++) {
      const fps = Math.min(30, 1000 / intervalo);
      envio.push({ t: s, espectador: `simulado ${e}`, simulado: true, largura: 1920, altura: 1080, fpsCodificados: fps, fpsEnviados: fps, mbps: 8, alvoMbps: 8, msCodificacao, qp: 24, quadrosChave: 0, limite: msCodificacao > 28 ? 'cpu' : 'none', msFilaDeEnvio: 1, nacks: 0, plis: 0, retransmitidosKbps: 0, rttMs: 1, bandaMbps: 20, rede: 'host', codec: 'H264', codificador: 'ExternalEncoder', codificadorDaPlaca: true });
      const intervalos = Array.from({ length: Math.round(fps) }, () => intervalo);
      recepcao.push({ t: s, espectador: `simulado ${e}`, simulado: true, largura: 1920, altura: 1080, fpsRecebidos: fps, fpsDecodificados: fps, fpsExibidos: fps, mbps: 8, msDecodificacao: 2, msBuffer: 50, intervaloMedioMs: intervalo, intervaloDesvioMs: 1, congelamentos: 0, msCongelado: 0, descartados: 0, pacotesPerdidos: 0, perdaPct: 0, jitterMs: 1, rttMs: 1, rede: 'host', decodificador: 'ExternalDecoder', decodificadorDaPlaca: true, ritmo: { quadros: intervalos.length, mediaMs: intervalo, p95Ms: intervalo, p99Ms: intervalo, maxMs: intervalo, faixas: contarFaixas(intervalos), msRecebidoAteTela: 55, msCapturaAteTela: 70 }, janelaVisivel: true, tarefasLongas: 0, msTarefaMaior: 0 });
    }
  }
  const captura = Array.from({ length: 30 }, (_, i) => ({ t: inicio + 1 + i, fps: capturaFps, largura: 1920, altura: 1080 }));
  return { t, envio, recepcao, captura };
}

function gravacao(...partes: ReturnType<typeof trecho>[]): Gravacao {
  return {
    formato: FORMATO, modo: 'simulado', roteiro: 'completo', inicio: '2026-10-13T20:00:00.000Z', duracao: 30 * partes.length, interrompido: false,
    app: 'app 1.2.10', navegador: 'teste', pc: null, tela: '1920x1080 @1', qualidadeDaPessoa: 'nitida', fonte: 'Um aplicativo, com som · "Path of Exile"',
    ajustes: { folgaDeRedeMs: 200 }, qualidades: {}, trechos: partes.map((p) => p.t), espectadoresReais: [],
    envio: partes.flatMap((p) => p.envio), captura: partes.flatMap((p) => p.captura), recepcao: partes.flatMap((p) => p.recepcao),
    pcAmostras: [], pagina: [], acontecimentos: [],
  };
}

describe('fluidez', () => {
  it('conta como no tempo até 1,5x o intervalo esperado', () => {
    const faixas = contarFaixas([...Array(98).fill(16.7), 40, 80]); // 98 no tempo, 2 engasgos
    expect(fluidez(faixas, 60)).toBe(98);
    expect(fluidez(faixas, 30)).toBe(99); // a 30 fps, 40 ms ainda está no tempo
    expect(percentilDasFaixas(faixas, 0.5)).toBeLessThanOrEqual(18);
  });
});

describe('análise', () => {
  it('aponta o codificador quando ele não cabe no intervalo entre quadros, e recomenda o limite de pessoas', () => {
    const a = analisar(gravacao(trecho(0, 0, 1, 10, 33.3), trecho(1, 30, 3, 12, 33.3), trecho(2, 60, 7, 32, 55)));
    expect(a.diagnosticos[0].codigo).toBe('codificador-saturado');
    expect(a.trechos.map((t) => t.resultado)).toEqual(['otimo', 'otimo', 'ruim']);
    expect(a.recomendacao.titulo).toContain('até 3 pessoas');
    expect(a.principal.gargalo).toBe('codificador-saturado');
  });

  it('aponta a captura quando o Windows entrega menos quadros que a qualidade pede', () => {
    const a = analisar(gravacao(trecho(0, 0, 1, 4, 47.6, 21)));
    expect(a.diagnosticos.some((d) => d.codigo === 'captura-lenta')).toBe(true);
    expect(a.trechos[0].conteudoFps).toBe(21); // um jogo a 21 fps não é cobrado por 30
  });

  it('aponta a imagem esperando além da folga e outro programa usando o codificador da placa', () => {
    const parte = trecho(0, 0, 1, 4, 33.3);
    for (const r of parte.recepcao) Object.assign(r, { msBuffer: 600, msBufferSom: 590, folgaMs: 250 });
    const g = gravacao(parte);
    g.pcAmostras = Array.from({ length: 30 }, (_, i) => ({
      t: i + 1, cpuApp: 8, cpuPorProcesso: {}, memoriaAppMB: 900, cpuPc: 50, placa3dTotal: 80, placaVideoTotal: 81,
      placa3dApp: 6, placaVideoApp: 9, placa3dOutros: 74, motores: null, memoriaPlacaMB: 8000,
    }));
    const a = analisar(g);
    const atraso = a.diagnosticos.find((d) => d.codigo === 'atraso-no-buffer');
    expect(atraso?.gravidade).toBe('alta');
    expect(atraso?.evidencias.join(' ')).toContain('buffer do som: 590');
    expect(a.diagnosticos.some((d) => d.codigo === 'codificador-disputado')).toBe(true);
  });
});

describe('relatório para IA', () => {
  it('traz o contexto, os diagnósticos, o glossário e as séries em CSV', () => {
    const g = gravacao(trecho(0, 0, 1, 5, 33.3));
    const md = relatorioParaIa(g, analisar(g));
    for (const secao of ['## 1. Resumo', '## 2. Diagnósticos', '## 5. Como esta versão do Ozamigos transmite', '## 7. Glossário', '## 9. Séries']) {
      expect(md).toContain(secao);
    }
    expect(md).toContain('t,trecho,espectador,altura,fps_codif');
    expect(md).toContain(FORMATO);
  });
});

describe('gravação da sala', () => {
  it('separa a transmissão de cada pessoa quando as duas transmitem e assistem ao mesmo tempo', () => {
    const kayo = trecho(0, 0, 1, 5, 33.3);
    const duda = trecho(0, 0, 1, 6, 33.3);
    const gs: GravacaoDaSala = {
      formato: FORMATO_DA_SALA,
      sala: 'abc123',
      gravadoPor: 'Kayo',
      inicio: '2026-10-13T20:00:00.000Z',
      duracao: 30,
      terminou: true,
      pessoas: [
        { nome: 'Kayo', ambiente: null, fontes: ['jogo do Kayo'] },
        { nome: 'Duda', ambiente: null, fontes: ['jogo da Duda'] },
      ],
      papeis: [
        { t: 1, pessoa: 'Kayo', transmite: true, qualidade: 'nitida', espectadores: ['Duda'], assiste: ['Duda'] },
        { t: 1, pessoa: 'Duda', transmite: true, qualidade: 'nitida', espectadores: ['Kayo'], assiste: ['Kayo'] },
      ],
      trechos: { Kayo: [{ ...kayo.t, assistindo: 1 }], Duda: [{ ...duda.t, assistindo: 1 }] },
      envio: [
        ...kayo.envio.map((e) => ({ ...e, espectador: 'Duda', transmissor: 'Kayo' })),
        ...duda.envio.map((e) => ({ ...e, espectador: 'Kayo', transmissor: 'Duda' })),
      ],
      captura: [...kayo.captura.map((c) => ({ ...c, pessoa: 'Kayo' })), ...duda.captura.map((c) => ({ ...c, pessoa: 'Duda' }))],
      recepcao: [
        ...kayo.recepcao.map((r) => ({ ...r, espectador: 'Duda', transmissor: 'Kayo' })),
        ...duda.recepcao.map((r) => ({ ...r, espectador: 'Kayo', transmissor: 'Duda' })),
      ],
      pcAmostras: [],
      pagina: [],
      acontecimentos: [],
      ajustes: {},
      qualidades: {},
    };

    const a = analisarSala(gs);

    expect(a.transmissoes.map((t) => t.nome)).toEqual(['Kayo', 'Duda']);
    expect(a.transmissoes[0].g.recepcao.every((r) => r.espectador === 'Duda')).toBe(true);
    expect(a.transmissoes[0].a.trechos[0].resultado).toBe('otimo');
    expect(a.pessoas.find((p) => p.nome === 'Duda')!.assistiuQuem).toEqual(['Kayo']);
    const md = relatorioDaSalaParaIa(gs, a);
    for (const secao of ['## 1. A sala', '## 2. Transmissão de Kayo', '## 3. Transmissão de Duda', '## 4. O PC e a página de cada pessoa', '## 7. Glossário']) {
      expect(md).toContain(secao);
    }
  });
});
