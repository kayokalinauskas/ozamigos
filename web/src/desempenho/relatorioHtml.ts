// O relatório para gente: uma página HTML que abre sozinha (CSS e gráficos SVG dentro dela, sem script).
// É o que aparece no fim do teste e o que "Salvar relatório" grava. Os dados completos vão junto, em JSON.

import { QUALIDADES } from '../qualidade';
import { NOMES_DOS_GARGALOS, fmt, juntarFaixas, type Analise, type Diagnostico, type ResumoDoTrecho } from './analise';
import { FAIXAS, type Gravacao } from './tipos';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const C = { lima: '#b6f24a', azul: '#5fb4ff', roxo: '#b38cff', medio: '#ffc145', bom: '#3ddc84', ruim: '#ff5470', grade: '#1f261c', t3: '#747f69', t2: '#a9b59c', texto: '#eef5e4' };

const RESULTADOS = {
  otimo: ['bom', 'Ótimo'],
  bom: ['bom', 'Bom'],
  atencao: ['medio', 'Atenção'],
  ruim: ['ruim', 'Engasga'],
} as const;

const ICONES: Record<Diagnostico['gravidade'], [string, string]> = {
  alta: ['!', C.ruim],
  media: ['~', C.medio],
  baixa: ['i', C.azul],
  ok: ['✓', C.bom],
};

const texto = (x: number, y: number, t: unknown, o: { cor?: string; tam?: number; ancora?: string; peso?: number } = {}) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${o.cor ?? C.t3}" font-size="${o.tam ?? 11}" text-anchor="${o.ancora ?? 'start'}" font-weight="${o.peso ?? 400}">${esc(t)}</text>`;

const minSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const nomeCurto = (t: ResumoDoTrecho) => `${t.trecho.nome} · ${t.trecho.espectadores}`;

// ===== Gráficos =====

function linhaDoTempo(g: Gravacao): string {
  const L = 1240;
  const A = 260;
  const m = { e: 40, d: 10, t: 30, b: 26 };
  const total = Math.max(1, g.duracao);
  const x = (t: number) => m.e + ((L - m.e - m.d) * t) / total;
  const maxFps = Math.max(30, ...Object.values(QUALIDADES).map((q) => q.fps)) + 10;
  const y = (v: number) => m.t + (A - m.t - m.b) * (1 - Math.min(v, maxFps) / maxFps);
  let s = '';
  for (const v of [0, 30, 60]) s += `<line x1="${m.e}" x2="${L - m.d}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grade}"/>${texto(m.e - 8, y(v) + 4, v, { ancora: 'end' })}`;
  g.trechos.forEach((tr, i) => {
    const ruim = false;
    s += `<rect x="${x(tr.inicio)}" y="${m.t - 22}" width="${Math.max(0, x(tr.fim) - x(tr.inicio) - 2)}" height="${A - m.b - m.t + 22}" fill="${i % 2 ? 'rgba(255,255,255,.025)' : 'transparent'}" rx="6"/>`;
    if (x(tr.fim) - x(tr.inicio) > 60) s += texto(x(tr.inicio) + 6, m.t - 8, `${tr.nome} · ${tr.espectadores}`, { cor: ruim ? C.ruim : C.t2, peso: 600, tam: 10.5 });
  });
  // fps na tela: média dos espectadores em cada segundo (sem tela, o decodificado)
  const porSegundo = new Map<number, number[]>();
  const congelou = new Set<number>();
  for (const r of g.recepcao) {
    const fps = r.fpsExibidos ?? r.fpsDecodificados;
    porSegundo.set(r.t, [...(porSegundo.get(r.t) ?? []), fps]);
    if (r.congelamentos > 0) congelou.add(r.t);
  }
  const exibidos = [...porSegundo.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => [t, v.reduce((a, b) => a + b, 0) / v.length] as const);
  const captura = g.captura.filter((c) => c.fps != null).map((c) => [c.t, c.fps!] as const);
  if (captura.length)
    s += `<polyline points="${captura.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${C.azul}" stroke-width="1.5" stroke-dasharray="3 3" opacity=".85"/>`;
  if (exibidos.length)
    s += `<polyline points="${exibidos.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${C.lima}" stroke-width="2" stroke-linejoin="round"/>`;
  for (const [t, v] of exibidos) if (congelou.has(t)) s += `<circle cx="${x(t)}" cy="${y(v)}" r="3.5" fill="${C.ruim}"><title>${t} s: congelou</title></circle>`;
  const marcas = [0, ...Array.from({ length: Math.floor(total / 60) }, (_, i) => (i + 1) * 60).filter((t) => total - t > 20), total];
  for (const t of marcas) s += texto(x(t), A - 6, minSec(t), { ancora: t === total ? 'end' : t ? 'middle' : 'start' });
  return `<svg viewBox="0 0 ${L} ${A}" role="img" aria-label="fps ao longo do teste">${s}</svg>`;
}

function histograma(trechos: ResumoDoTrecho[], g: Gravacao): string {
  const L = 600;
  const A = 230;
  const m = { e: 40, d: 10, t: 10, b: 26 };
  const series = trechos.map((t, i) => {
    const faixas = juntarFaixas(g.recepcao.filter((r) => r.t > t.trecho.descartarAte && r.t <= t.trecho.fim));
    const total = faixas.reduce((a, b) => a + b, 0) || 1;
    return { cor: i === 0 ? C.lima : C.ruim, nome: nomeCurto(t), pct: faixas.map((n) => (n / total) * 100) };
  });
  const maximo = Math.max(10, ...series.flatMap((s) => s.pct));
  const topo = Math.ceil(maximo / 20) * 20;
  const w = (L - m.e - m.d) / FAIXAS.length;
  const y = (v: number) => m.t + (A - m.t - m.b) * (1 - v / topo);
  let s = '';
  for (const v of [0, topo / 2, topo]) s += `<line x1="${m.e}" x2="${L - m.d}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grade}"/>${texto(m.e - 6, y(v) + 4, `${v}%`, { ancora: 'end' })}`;
  FAIXAS.forEach((limite, i) => {
    const largura = (w - 6) / series.length;
    series.forEach((serie, k) => {
      const v = serie.pct[i];
      s += `<rect x="${m.e + i * w + 3 + k * largura}" y="${y(v)}" width="${Math.max(1, largura - 2)}" height="${y(0) - y(v)}" rx="2" fill="${serie.cor}"><title>${esc(serie.nome)}: ${fmt(v, '%')}</title></rect>`;
    });
    const rot = Number.isFinite(limite) ? `≤${limite}` : `>${FAIXAS[i - 1]}`;
    if (i % 2 === 0 || FAIXAS.length < 10) s += texto(m.e + i * w + w / 2, A - 6, rot, { ancora: 'middle', tam: 10 });
  });
  const legenda = series.map((serie) => `<span><i style="background:${serie.cor}"></i>${esc(serie.nome)}</span>`).join('');
  return `<div class="legenda">${legenda}</div><svg viewBox="0 0 ${L} ${A}" role="img" aria-label="intervalo entre quadros">${s}</svg>`;
}

function carga(trechos: ResumoDoTrecho[]): string {
  const L = 600;
  const A = 230;
  const m = { e: 44, d: 20, t: 14, b: 26 };
  const pontos = trechos.filter((t) => t.envio.msCodificacao != null).sort((a, b) => a.trecho.espectadores - b.trecho.espectadores);
  const maxEsp = Math.max(8, ...pontos.map((p) => p.trecho.espectadores));
  const orcamento = 1000 / (pontos[0]?.conteudoFps ?? 60);
  const topo = Math.max(20, Math.ceil(Math.max(orcamento, ...pontos.map((p) => p.envio.msCodificacao!)) / 5) * 5 + 5);
  const x = (n: number) => m.e + 10 + ((L - m.e - m.d - 20) * (n - 1)) / (maxEsp - 1);
  const y = (v: number) => m.t + (A - m.t - m.b) * (1 - v / topo);
  let s = '';
  for (let v = 0; v <= topo; v += 5) s += `<line x1="${m.e}" x2="${L - m.d}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grade}"/>${texto(m.e - 6, y(v) + 4, `${v} ms`, { ancora: 'end' })}`;
  s += `<line x1="${m.e}" x2="${L - m.d}" y1="${y(orcamento)}" y2="${y(orcamento)}" stroke="${C.ruim}" stroke-dasharray="5 4"/>${texto(L - m.d, y(orcamento) - 6, `intervalo entre quadros · ${fmt(orcamento, ' ms')}`, { cor: C.ruim, ancora: 'end' })}`;
  s += `<polyline points="${pontos.map((p) => `${x(p.trecho.espectadores)},${y(p.envio.msCodificacao!)}`).join(' ')}" fill="none" stroke="${C.roxo}" stroke-width="2.5"/>`;
  for (const p of pontos) {
    const ruim = p.resultado === 'ruim' || p.resultado === 'atencao';
    s += `<circle cx="${x(p.trecho.espectadores)}" cy="${y(p.envio.msCodificacao!)}" r="5" fill="${ruim ? C.ruim : C.roxo}"><title>${p.trecho.espectadores} esp.: ${fmt(p.envio.msCodificacao, ' ms')}</title></circle>`;
    s += texto(x(p.trecho.espectadores) + 8, y(p.envio.msCodificacao!) - 8, fmt(p.envio.msCodificacao, ' ms'), { cor: C.texto, peso: 600 });
  }
  for (let n = 1; n <= maxEsp; n++) s += texto(x(n), A - 6, n, { ancora: 'middle' });
  return `<svg viewBox="0 0 ${L} ${A}" role="img" aria-label="codificação por espectadores">${s}</svg>`;
}

function atrasos(trechos: ResumoDoTrecho[]): string {
  const L = 1240;
  const linhaAltura = 30;
  const A = trechos.length * linhaAltura + 30;
  const m = { e: 170, d: 70, t: 4, b: 22 };
  const maximo = Math.max(100, ...trechos.map((t) => t.atraso.total));
  const topo = Math.ceil(maximo / 50) * 50;
  const x = (v: number) => ((L - m.e - m.d) * v) / topo;
  const cores = [C.roxo, C.azul, C.t2, C.medio, C.bom];
  let s = '';
  for (let v = 0; v <= topo; v += 50) s += `<line x1="${m.e + x(v)}" x2="${m.e + x(v)}" y1="${m.t}" y2="${A - m.b}" stroke="${C.grade}"/>${texto(m.e + x(v), A - 4, `${v} ms`, { ancora: 'middle' })}`;
  trechos.forEach((t, i) => {
    const yy = m.t + i * linhaAltura + 6;
    let acumulado = 0;
    const ruim = t.resultado === 'ruim';
    s += texto(m.e - 12, yy + 13, nomeCurto(t), { cor: ruim ? C.ruim : C.t2, ancora: 'end', peso: 600 });
    const partes = [t.atraso.codificacao, t.atraso.fila, t.atraso.rede, t.atraso.buffer, t.atraso.decodificacao];
    partes.forEach((p, k) => {
      if (p <= 0) return;
      s += `<rect x="${m.e + x(acumulado) + (acumulado ? 1 : 0)}" y="${yy}" width="${Math.max(1, x(p) - 1)}" height="${linhaAltura - 12}" fill="${cores[k]}" rx="3"/>`;
      acumulado += p;
    });
    s += texto(m.e + x(acumulado) + 8, yy + 13, `${Math.round(t.atraso.total)} ms${t.atraso.medido != null ? ` (medido ${t.atraso.medido})` : ''}`, { cor: C.texto, peso: 600 });
  });
  return `<svg viewBox="0 0 ${L} ${A}" role="img" aria-label="atraso por trecho">${s}</svg>`;
}

/** O nome da janela transmitida, quando o navegador informa um nome de verdade (não um id). */
function nomeDaFonte(fonte: string): string {
  const rotulo = /"([^"]*)"/.exec(fonte)?.[1]?.trim() ?? '';
  const ehId = !rotulo || /^(window|screen|web-contents-media-stream):/i.test(rotulo) || /^[0-9a-f-]{20,}$/i.test(rotulo);
  return ehId ? 'o jogo' : rotulo;
}

// ===== Página =====

const CSS = `
:root { --fundo:#0b0e0a; --painel:#11150f; --painel-2:#171c15; --painel-3:#1f261c; --borda:#2a3326; --texto:#eef5e4; --texto-2:#a9b59c; --texto-3:#747f69; --destaque:#b6f24a; --bom:#3ddc84; --medio:#ffc145; --ruim:#ff5470; --azul:#5fb4ff; --roxo:#b38cff; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--fundo); color: var(--texto); font: 14px/1.45 'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif; -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums; }
h1, h2, h3 { font-family: 'Sora Variable', Sora, 'Segoe UI', sans-serif; letter-spacing: -0.02em; margin: 0; font-weight: 600; }
.pagina { max-width: 1280px; margin: 0 auto; padding: 40px 24px 64px; display: grid; gap: 28px; }
.rotulo { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--texto-3); }
.cartao { background: var(--painel); border: 1px solid var(--borda); border-radius: 12px; }
.pilula { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.pilula.bom { background: rgb(61 220 132 / .12); color: var(--bom); } .pilula.medio { background: rgb(255 193 69 / .12); color: var(--medio); }
.pilula.ruim { background: rgb(255 84 112 / .12); color: var(--ruim); } .pilula.neutra { background: var(--painel-3); color: var(--texto-2); }
.cabeca h1 { font-size: 28px; margin: 6px 0 12px; } .chips { display: flex; flex-wrap: wrap; gap: 8px; }
.veredito { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 16px; }
.principal { padding: 24px 26px; background: radial-gradient(120% 140% at 0% 0%, rgb(182 242 74 / .14), transparent 55%), var(--painel); border-color: rgb(182 242 74 / .35); }
.principal h2 { font-size: 23px; line-height: 1.3; margin: 10px 0; } .principal p { margin: 0; color: var(--texto-2); }
.numero { padding: 20px 22px; display: flex; flex-direction: column; } .numero .valor { font: 600 36px 'Sora Variable', Sora, sans-serif; letter-spacing: -.03em; margin: 8px 0 4px; }
.numero .valor small { font-size: 16px; color: var(--texto-2); font-weight: 500; margin-left: 4px; } .numero p { margin: 0 0 12px; color: var(--texto-2); font-size: 13px; }
.numero .pilula { margin-top: auto; align-self: flex-start; } .duplo { display: grid; gap: 16px; } .duplo .numero { padding: 16px 20px; } .duplo .valor { font-size: 24px; margin: 4px 0 0; }
.secao h2 { font-size: 19px; margin-bottom: 4px; } .secao > p { margin: 0 0 16px; color: var(--texto-3); font-size: 13px; }
.achados { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.achado { padding: 18px 20px; display: grid; grid-template-columns: 34px 1fr; gap: 4px 14px; align-content: start; }
.achado > * { grid-column: 2; min-width: 0; }
.achado .icone { grid-column: 1; grid-row: 1 / span 6; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; font: 700 15px Sora, sans-serif; }
.achado h3 { font-size: 15px; } .achado p { margin: 2px 0 0; color: var(--texto-2); font-size: 13px; }
.achado ul { margin: 8px 0 0; padding-left: 16px; color: var(--texto-3); font-size: 12px; }
.achado .faca { margin-top: 10px; font-size: 12.5px; display: grid; grid-template-columns: auto 1fr; gap: 8px; } .achado .faca b { color: var(--destaque); white-space: nowrap; } .achado .faca.dev b { color: var(--azul); }
.tabela { overflow-x: auto; } table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: right; font-weight: 600; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--texto-3); padding: 14px 12px 10px; border-bottom: 1px solid var(--borda); white-space: nowrap; }
td { text-align: right; padding: 12px; border-bottom: 1px solid var(--painel-3); white-space: nowrap; } th:first-child, td:first-child { text-align: left; }
td small { color: var(--texto-3); } .ruim-t { color: var(--ruim); } .medio-t { color: var(--medio); }
.graficos { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .grafico { padding: 18px 20px 14px; } .grafico.largo { grid-column: span 2; }
.grafico header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 6px; } .grafico h3 { font-size: 15px; } .grafico header p { margin: 0; color: var(--texto-3); font-size: 12px; }
.legenda { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--texto-2); margin: 4px 0; } .legenda i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; margin-right: 6px; }
.grafico svg { display: block; width: 100%; height: auto; } svg text { font-family: 'Inter Variable', Inter, 'Segoe UI', sans-serif; }
.eventos { padding: 8px 0; } .eventos li { display: grid; grid-template-columns: 56px 110px 1fr; gap: 8px; padding: 6px 18px; font-size: 13px; border-bottom: 1px solid var(--painel-3); }
.eventos ol { list-style: none; margin: 0; padding: 0; } .eventos time, .eventos span { color: var(--texto-3); }
.rodape { color: var(--texto-3); font-size: 12px; }
@media (max-width: 900px) { .veredito, .achados, .graficos { grid-template-columns: 1fr; } .grafico.largo { grid-column: auto; } }
`;

function cartaoDeAchado(d: Diagnostico): string {
  const [icone, cor] = ICONES[d.gravidade];
  return `<div class="cartao achado">
    <span class="icone" style="background:${cor}22;color:${cor}">${icone}</span>
    <h3>${esc(d.titulo)}</h3>
    <p>${esc(d.detalhe)}</p>
    <ul>${d.evidencias
      .slice(0, 4)
      .map((e) => `<li>${esc(e)}</li>`)
      .join('')}${d.evidencias.length > 4 ? `<li>… e mais ${d.evidencias.length - 4}</li>` : ''}</ul>
    ${d.paraVoce ? `<div class="faca"><b>Para você</b><span>${esc(d.paraVoce)}</span></div>` : ''}
    ${d.paraOApp ? `<div class="faca dev"><b>Para o app</b><span>${esc(d.paraOApp)}</span></div>` : ''}
  </div>`;
}

/** quem: na gravação da sala, quem transmitiu (o relatório é de uma das transmissões). */
export function relatorioHtml(g: Gravacao, a: Analise, quem?: string): string {
  const validos = a.trechos.filter((t) => t.segundos > 0 && !t.trecho.aquecimento);
  const pc = g.pc;
  const chips = [
    pc?.sistema,
    pc ? `${pc.processador}` : null,
    pc?.placa?.nome ? `${pc.placa.nome}${pc.placa.driver ? ` · driver ${pc.placa.driver}` : ''}` : null,
    pc?.telas.find((t) => t.principal) ? `Tela ${pc.telas.find((t) => t.principal)!.tamanho} · ${pc.telas.find((t) => t.principal)!.hz} Hz` : g.tela,
    g.app.startsWith('app ') ? `Ozamigos ${g.app.slice(4)}` : 'Ozamigos no navegador',
  ].filter(Boolean);
  const quando = new Date(g.inicio);
  const dataTexto = quando.toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fl = a.principal.fluidez;
  const nivelFl = fl == null ? 'neutra' : fl >= 99 ? 'bom' : fl >= 97 ? 'bom' : fl >= 90 ? 'medio' : 'ruim';
  const textoFl = fl == null ? 'Sem medida' : fl >= 99 ? 'Excelente' : fl >= 97 ? 'Boa' : fl >= 90 ? 'Com engasgos' : 'Ruim';
  const achados = [...a.diagnosticos.filter((d) => d.gravidade !== 'ok' && d.codigo !== 'limites-do-simulado'), ...a.diagnosticos.filter((d) => d.gravidade === 'ok')].slice(0, 8);
  const escala = validos.filter((t) => t.trecho.qualidade === g.qualidadeDaPessoa);
  const comparacao = (() => {
    const lista = [...escala].sort((x, y) => x.trecho.espectadores - y.trecho.espectadores);
    if (lista.length >= 2) return [lista[0], lista[lista.length - 1]];
    return validos.slice(0, 1);
  })();
  const temEscala = new Set(escala.map((t) => t.trecho.espectadores)).size >= 2;
  const classe = (v: number | null, bom: number, ruim: number, maiorMelhor = true) =>
    v == null ? '' : maiorMelhor ? (v < ruim ? 'ruim-t' : v < bom ? 'medio-t' : '') : v > ruim ? 'ruim-t' : v > bom ? 'medio-t' : '';

  const linhas = validos
    .map((t) => {
      const [nivel, rot] = RESULTADOS[t.resultado];
      const tela = t.recepcao.fpsExibidos ?? t.recepcao.fpsDecodificados;
      return `<tr>
      <td><b>${esc(t.trecho.nome)}</b></td><td>${t.trecho.espectadores}${t.trecho.simulados && t.trecho.simulados !== t.trecho.espectadores ? ` <small>(${t.trecho.simulados} sim.)</small>` : ''}</td>
      <td>${fmt(t.captura.fps, '', 0)}</td>
      <td class="${classe(tela, t.conteudoFps * 0.93, t.conteudoFps * 0.8)}">${fmt(tela, '', 0)} <small>/ ${Math.round(t.conteudoFps)}</small></td>
      <td class="${classe(t.recepcao.fluidez, 97, 90)}">${fmt(t.recepcao.fluidez, '%')}</td>
      <td>${fmt(t.recepcao.p99Ms, ' ms', 0)}</td>
      <td>${fmt(t.atraso.total, ' ms', 0)}</td>
      <td>${fmt(t.envio.mbps, ' Mbps')}</td>
      <td class="${classe(t.envio.msCodificacao, 1000 / t.conteudoFps / 2, (1000 / t.conteudoFps) * 0.8, false)}">${fmt(t.envio.msCodificacao, ' ms')}</td>
      <td>${fmt(t.pc.cpuApp, '%', 0)}</td><td>${fmt(t.pc.placa3dTotal, '%', 0)}</td><td>${fmt(t.pc.placaVideoTotal, '%', 0)}</td>
      <td>${t.recepcao.congelamentos}</td>
      <td><span class="pilula ${nivel}">${rot}</span></td></tr>`;
    })
    .join('');

  const eventos = g.acontecimentos
    .filter((e) => e.tipo !== 'tarefa-longa' || g.acontecimentos.filter((x) => x.tipo === 'tarefa-longa').length < 15)
    .slice(0, 80)
    .map((e) => `<li><time>${minSec(e.t)}</time><span>${esc(e.tipo)}</span>${esc(e.texto)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${quem ? `Transmissão de ${esc(quem)}` : 'Relatório de desempenho'} · Ozamigos</title><style>${CSS}</style></head>
<body><div class="pagina">
<div class="cabeca">
  <span class="rotulo">Relatório de desempenho · ${esc(dataTexto)} · ${minSec(g.duracao)} · ${g.modo === 'simulado' ? 'espectadores simulados' : 'gravação da sala'}${g.interrompido ? ' · interrompido' : ''}</span>
  <h1>${quem ? `${esc(quem)} transmitindo` : 'Seu PC transmitindo'} ${esc(nomeDaFonte(g.fonte))}</h1>
  <div class="chips">${chips.map((c) => `<span class="pilula neutra">${esc(c)}</span>`).join('')}</div>
</div>

<div class="veredito">
  <div class="cartao principal"><span class="rotulo" style="color:var(--destaque)">Recomendação</span><h2>${esc(a.recomendacao.titulo)}</h2><p>${esc(a.recomendacao.texto)}</p></div>
  <div class="cartao numero"><span class="rotulo">${g.modo === 'sala' ? 'Fluidez para quem assistiu' : 'Fluidez na sua qualidade'}</span><div class="valor">${fmt(fl)}<small>%</small></div><p>dos quadros exibidos no tempo; pior 1% em ${fmt(a.principal.p99Ms, ' ms', 0)}</p><span class="pilula ${nivelFl}">${textoFl}</span></div>
  <div class="duplo">
    <div class="cartao numero"><span class="rotulo">Atraso estimado</span><div class="valor">${fmt(a.principal.atraso, '', 0)}<small>ms</small></div></div>
    <div class="cartao numero"><span class="rotulo">Gargalo</span><div class="valor" style="font-size:20px;margin-top:8px">${esc(NOMES_DOS_GARGALOS[a.principal.gargalo] ?? a.principal.gargalo)}</div></div>
  </div>
</div>

<div class="secao"><h2>O que encontramos</h2><p>Em ordem de impacto. “Para você” é o que dá para mudar agora; “Para o app” vira melhoria no Ozamigos. O relatório para IA traz as regras e os dados de cada segundo.</p>
  <div class="achados">${achados.map(cartaoDeAchado).join('')}</div></div>

<div class="secao"><h2>Trecho por trecho</h2><p>Médias de cada trecho, sem os primeiros segundos (o WebRTC ainda está subindo a banda).</p>
<div class="cartao tabela"><table><thead><tr><th>Trecho</th><th>Espectadores</th><th>Captura</th><th>Fps na tela</th><th>Fluidez</th><th>Pior 1%</th><th>Atraso</th><th>Bitrate</th><th>Codificação</th><th>CPU app</th><th>Placa 3D</th><th>Motor vídeo</th><th>Congel.</th><th>Resultado</th></tr></thead>
<tbody>${linhas || '<tr><td colspan="14">Nenhum trecho com dados suficientes.</td></tr>'}</tbody></table></div></div>

<div class="secao"><h2>Gráficos</h2><p>Passe o mouse nos pontos e nas barras para ver os valores.</p>
<div class="graficos">
  <div class="cartao grafico largo"><header><h3>Fps na tela ao longo do teste</h3><p>faixas = trechos; pontos vermelhos = congelamentos</p></header>
    <div class="legenda"><span><i style="background:${C.lima}"></i>fps na tela (média dos espectadores)</span><span><i style="background:${C.azul}"></i>fps da captura</span><span><i style="background:${C.ruim}"></i>congelou</span></div>${linhaDoTempo(g)}</div>
  <div class="cartao grafico${temEscala ? '' : ' largo'}"><header><h3>Intervalo entre quadros na tela</h3><p>quanto mais concentrado à esquerda, mais fluido (ms)</p></header>${histograma(comparacao, g)}</div>
  ${temEscala ? `<div class="cartao grafico"><header><h3>Codificação por quadro × espectadores</h3><p>${esc(QUALIDADES[g.qualidadeDaPessoa].rotulo)}; acima da linha, o fps não cabe</p></header>${carga(escala)}</div>` : ''}
  <div class="cartao grafico largo"><header><h3>Onde está o atraso, por trecho</h3><p>estimado${g.modo === 'simulado' ? ', sem internet no caminho' : ''}</p></header>
    <div class="legenda"><span><i style="background:${C.roxo}"></i>codificação</span><span><i style="background:${C.azul}"></i>fila de envio</span><span><i style="background:${C.t2}"></i>rede (metade da ida e volta)</span><span><i style="background:${C.medio}"></i>buffer de quem assiste</span><span><i style="background:${C.bom}"></i>decodificação</span></div>${atrasos(validos)}</div>
</div></div>

<div class="secao"><h2>Acontecimentos</h2><div class="cartao eventos"><ol>${eventos}</ol></div></div>

<p class="rodape">${g.modo === 'simulado' ? 'Os espectadores simulados estão neste PC: o teste não usa a internet. Para medir a conexão com os amigos, grave a sala (Ctrl+Shift+G).' : 'Gravado na sala, com os amigos de verdade; cada PC mandou as próprias medidas para quem gravou.'} Dados completos: o arquivo JSON e o relatório para IA salvos junto.</p>
</div>
<script type="application/json" id="dados">${JSON.stringify(g).replace(/</g, '\\u003c')}</script>
</body></html>`;
}
