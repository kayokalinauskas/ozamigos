import { describe, expect, it } from 'vitest';
import { contarFaixas } from './amostradores';
import { analisar, fluidez, percentilDasFaixas } from './analise';
import { relatorioParaIa } from './relatorioIa';
import { FORMATO, type AmostraEnvio, type AmostraRecepcao, type Gravacao, type Trecho } from './tipos';

/** Um trecho de 30 s com n espectadores: ms de codificação e o intervalo entre quadros na tela. */
function trecho(indice: number, inicio: number, espectadores: number, msCodificacao: number, intervalo: number, capturaFps = 60) {
  const t: Trecho = { indice, nome: '1080p · 60 fps', inicio, fim: inicio + 30, qualidade: 'maxima', espectadores, simulados: espectadores, aquecimento: false, descartarAte: inicio + 8 };
  const envio: AmostraEnvio[] = [];
  const recepcao: AmostraRecepcao[] = [];
  for (let s = inicio + 1; s <= inicio + 30; s++) {
    for (let e = 1; e <= espectadores; e++) {
      const fps = Math.min(60, 1000 / intervalo);
      envio.push({ t: s, espectador: `simulado ${e}`, simulado: true, largura: 1920, altura: 1080, fpsCodificados: fps, fpsEnviados: fps, mbps: 8, alvoMbps: 8, msCodificacao, qp: 24, quadrosChave: 0, limite: msCodificacao > 14 ? 'cpu' : 'none', msFilaDeEnvio: 1, nacks: 0, plis: 0, retransmitidosKbps: 0, rttMs: 1, bandaMbps: 20, rede: 'host', codec: 'H264', codificador: 'ExternalEncoder', codificadorDaPlaca: true });
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
    app: 'app 1.2.10', navegador: 'teste', pc: null, tela: '1920x1080 @1', qualidadeDaPessoa: 'maxima', fonte: 'Um aplicativo, com som · "Path of Exile"',
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
    const a = analisar(gravacao(trecho(0, 0, 1, 5, 16.7), trecho(1, 30, 3, 6, 16.7), trecho(2, 60, 7, 16, 25)));
    expect(a.diagnosticos[0].codigo).toBe('codificador-saturado');
    expect(a.trechos.map((t) => t.resultado)).toEqual(['otimo', 'otimo', 'ruim']);
    expect(a.recomendacao.titulo).toContain('até 3 pessoas');
    expect(a.principal.gargalo).toBe('codificador-saturado');
  });

  it('aponta a captura quando o Windows entrega menos quadros que a qualidade pede', () => {
    const a = analisar(gravacao(trecho(0, 0, 1, 4, 47.6, 21)));
    expect(a.diagnosticos.some((d) => d.codigo === 'captura-lenta')).toBe(true);
    expect(a.trechos[0].conteudoFps).toBe(21); // um jogo a 21 fps não é cobrado por 60
  });
});

describe('relatório para IA', () => {
  it('traz o contexto, os diagnósticos, o glossário e as séries em CSV', () => {
    const g = gravacao(trecho(0, 0, 1, 5, 16.7));
    const md = relatorioParaIa(g, analisar(g));
    for (const secao of ['## 1. Resumo', '## 2. Diagnósticos', '## 5. Como esta versão do Ozamigos transmite', '## 7. Glossário', '## 9. Séries']) {
      expect(md).toContain(secao);
    }
    expect(md).toContain('t,trecho,espectador,altura,fps_codif');
    expect(md).toContain(FORMATO);
  });
});
