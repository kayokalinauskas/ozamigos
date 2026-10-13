import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bot, Copy, Download, FileJson, FileText, MonitorUp, RotateCcw, SkipForward, Square, Users, X, Zap } from 'lucide-react';
import { cliente } from '../cliente';
import { analisar, fmt, type ResumoDoTrecho } from '../desempenho/analise';
import { teste, type EstadoDoTeste } from '../desempenho/gravacao';
import { relatorioHtml } from '../desempenho/relatorioHtml';
import { relatorioParaIa } from '../desempenho/relatorioIa';
import type { Gravacao, Modo, Roteiro } from '../desempenho/tipos';
import { noApp, pintarBarraDaJanela } from '../ponte';
import { QUALIDADES } from '../qualidade';
import { useCliente } from '../useCliente';

// Esta tela (e o código do teste) só é baixada quando alguém abre o teste: veja o lazy() em Sala.tsx.
function useTeste() {
  return useSyncExternalStore(teste.inscrever, teste.ler);
}

const minSec = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function baixar(nome: string, conteudo: string, tipo: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** Tela cheia sobre a sala: começar o teste, acompanhar ao vivo e ver o relatório. */
export function TesteDesempenho({ aoFechar }: { aoFechar: () => void }) {
  const estado = useTeste();

  useEffect(() => {
    pintarBarraDaJanela('--fundo');
  }, []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (estado.fase === 'parado' || estado.fase === 'pronto')) aoFechar();
    };
    addEventListener('keydown', tecla);
    return () => removeEventListener('keydown', tecla);
  }, [estado.fase, aoFechar]);

  return (
    <div className="teste" role="dialog" aria-modal="true" aria-label="Teste de desempenho">
      {estado.fase === 'parado' && <Inicio estado={estado} aoFechar={aoFechar} />}
      {(estado.fase === 'gravando' || estado.fase === 'encerrando') && <AoVivo estado={estado} />}
      {estado.fase === 'pronto' && estado.gravacao && <Relatorio gravacao={estado.gravacao} aoFechar={aoFechar} />}
    </div>
  );
}

// ===== Começo =====

function Inicio({ estado, aoFechar }: { estado: EstadoDoTeste; aoFechar: () => void }) {
  const { minhaTela, plateias, meuId, qualidade } = useCliente();
  const [modo, setModo] = useState<Modo>('simulado');
  const [roteiro, setRoteiro] = useState<Roteiro>('completo');
  const assistindo = meuId ? (plateias[meuId]?.length ?? 0) : 0;
  const podeComecar = minhaTela !== null && (modo === 'simulado' || assistindo > 0);

  return (
    <div className="teste-inicio">
      <header className="teste-topo">
        <h1>Teste de desempenho</h1>
        <button type="button" className="botao-icone" aria-label="Fechar" onClick={aoFechar}>
          <X size={20} />
        </button>
      </header>
      <p className="teste-intro">
        Grava tudo o que acontece com a imagem do seu jogo, da captura até a tela de quem assiste, e no fim mostra onde está o gargalo. O
        relatório sai em duas versões: uma para você ler e outra para colar numa IA e pedir melhorias no app.
      </p>

      <div className="teste-modos" role="radiogroup" aria-label="Como testar">
        <button type="button" role="radio" aria-checked={modo === 'simulado'} className="teste-modo" onClick={() => setModo('simulado')}>
          <Zap size={22} />
          <b>Espectadores simulados</b>
          <span>
            O Ozamigos cria espectadores no seu próprio PC e passa sozinho pelas 4 qualidades e por 1, 3 e 7 pessoas assistindo. Mede o seu
            PC (captura, codificação, exibição), sem a internet.
          </span>
        </button>
        <button type="button" role="radio" aria-checked={modo === 'amigos'} className="teste-modo" onClick={() => setModo('amigos')}>
          <Users size={22} />
          <b>Com os amigos assistindo</b>
          <span>
            Grava a transmissão de verdade. Cada amigo manda como a imagem chega no PC dele: fps, engasgos, perdas e atraso da internet.
            {assistindo > 0 ? ` Agora: ${assistindo} ${assistindo === 1 ? 'pessoa assistindo' : 'pessoas assistindo'}.` : ' Agora ninguém está assistindo.'}
          </span>
        </button>
      </div>

      {modo === 'simulado' && (
        <div className="teste-roteiros" role="radiogroup" aria-label="Duração">
          <label>
            <input type="radio" name="roteiro" checked={roteiro === 'completo'} onChange={() => setRoteiro('completo')} />
            Completo · ~4 min <span>4 qualidades com 1 espectador, depois 3 e 7 na sua ({QUALIDADES[qualidade].rotulo})</span>
          </label>
          <label>
            <input type="radio" name="roteiro" checked={roteiro === 'rapido'} onChange={() => setRoteiro('rapido')} />
            Rápido · ~1 min <span>só a sua qualidade, com 1 e com 7 espectadores</span>
          </label>
        </div>
      )}

      <ul className="teste-dicas">
        <li>Deixe o jogo rodando como você joga de verdade, e a janela do Ozamigos visível (em outro monitor ou ao lado do jogo): escondida, o navegador não desenha o vídeo e o ritmo na tela não é medido.</li>
        {modo === 'simulado' && <li>Quem estiver assistindo agora vê as trocas de qualidade do teste. No fim, a sua qualidade volta.</li>}
        {modo === 'amigos' && <li>Os amigos veem um aviso enquanto o teste grava. Pare quando quiser: os trechos se dividem sozinhos a cada troca de qualidade ou de quem assiste.</li>}
        {!noApp && <li>No navegador, o uso do processador e da placa de vídeo não é medido: para isso, use o app para Windows.</li>}
      </ul>

      {estado.erro && <p className="ajuda-erro">{estado.erro}</p>}
      <div className="teste-acoes">
        {!minhaTela ? (
          <button type="button" className="botao botao-primario botao-grande" onClick={() => void cliente.transmitir('escolher')}>
            <MonitorUp size={18} /> Primeiro, escolha o jogo para transmitir
          </button>
        ) : (
          <button type="button" className="botao botao-primario botao-grande" disabled={!podeComecar} onClick={() => void teste.iniciar(modo, roteiro)}>
            {modo === 'simulado' ? 'Começar o teste' : 'Começar a gravar'}
          </button>
        )}
        {modo === 'amigos' && minhaTela && assistindo === 0 && <span className="ajuda">Espere alguém clicar em Assistir.</span>}
      </div>
    </div>
  );
}

// ===== Ao vivo =====

function Video({ stream, rotulo }: { stream: MediaStream; rotulo: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay muted playsInline aria-label={rotulo} />;
}

function Minigrafico({ valores, cor }: { valores: number[]; cor: string }) {
  if (valores.length < 2) return <svg className="minigrafico" />;
  const L = 120;
  const A = 22;
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const faixa = max - min || 1;
  const pontos = valores.map((v, i) => [(i * L) / (valores.length - 1), A - 2 - ((A - 4) * (v - min)) / faixa]);
  const linha = pontos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className="minigrafico" viewBox={`0 0 ${L} ${A}`} aria-hidden="true">
      <path d={`M${linha.replace(/ /g, 'L')}L${L},${A}L0,${A}Z`} fill={cor} opacity=".12" />
      <polyline points={linha} fill="none" stroke={cor} strokeWidth="1.5" />
    </svg>
  );
}

function GraficoDoRitmo({ alvoFps }: { alvoFps: number }) {
  const { porQuadro, valores } = teste.ritmoAoVivo();
  const L = 1000;
  const A = 150;
  const m = { e: 58, d: 8, t: 8, b: 20 };
  const alvo = 1000 / alvoFps;
  const topo = Math.max(alvo * 3, 50);
  const y = (v: number) => m.t + (A - m.t - m.b) * (1 - Math.min(v, topo) / topo);
  const n = Math.max(porQuadro ? 600 : 60, valores.length);
  const x = (i: number) => m.e + ((L - m.e - m.d) * (i + n - valores.length)) / n;
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="grafico-ritmo" role="img" aria-label="Intervalo entre quadros">
      {[0, alvo, alvo * 2, topo].map((v) => (
        <g key={v}>
          <line x1={m.e} x2={L - m.d} y1={y(v)} y2={y(v)} stroke={v === alvo ? '#747f69' : '#1f261c'} strokeDasharray={v === alvo ? '4 4' : undefined} />
          <text x={m.e - 8} y={y(v) + 4} fill="#747f69" fontSize="11" textAnchor="end">
            {Math.round(v)} ms
          </text>
        </g>
      ))}
      {porQuadro ? (
        <polyline points={valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} fill="none" stroke="#b6f24a" strokeWidth="1.4" />
      ) : (
        valores.map((v, i) => <rect key={i} x={x(i)} y={y(v)} width={(L - m.e - m.d) / n - 3} height={y(0) - y(v)} rx="2" fill={v > alvo * 2 ? '#ff5470' : '#b6f24a'} />)
      )}
      {porQuadro && valores.map((v, i) => (v > alvo * 2 ? <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="#ff5470" /> : null))}
      <text x={m.e} y={A - 4} fill="#747f69" fontSize="11">
        {porQuadro ? '−10 s' : '−60 s'}
      </text>
      <text x={L - m.d} y={A - 4} fill="#747f69" fontSize="11" textAnchor="end">
        agora
      </text>
    </svg>
  );
}

function AoVivo({ estado }: { estado: EstadoDoTeste }) {
  const { qualidade, minhaTela } = useCliente();
  const r: ResumoDoTrecho | null = estado.resumo;
  const simulado = estado.modo === 'simulado';
  const etapa = estado.etapas[estado.etapaAtual];
  const decorrido = etapa ? Math.min(1, (estado.segundos - estado.etapas.slice(0, estado.etapaAtual).reduce((s, e) => s + e.segundos, 0)) / etapa.segundos) : 0;
  const media = (lista: (number | null)[]) => {
    const v = lista.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const { envio, recepcao, captura, pc } = estado.agora;
  const codificadorDaPlaca = envio.find((e) => e.codificadorDaPlaca != null)?.codificadorDaPlaca;
  const limite = envio.find((e) => e.limite && e.limite !== 'none')?.limite ?? 'none';
  const atraso = r?.atraso;
  const partesDoAtraso = atraso
    ? [
        ['Codificação', atraso.codificacao, 'var(--roxo)'],
        ['Fila', atraso.fila, 'var(--azul)'],
        ['Rede', atraso.rede, 'var(--texto-2)'],
        ['Buffer', atraso.buffer, 'var(--medio)'],
        ['Decodificação', atraso.decodificacao, 'var(--bom)'],
      ].filter(([, v]) => (v as number) > 0.5 || simulado === false)
    : [];
  const fluidez = r?.recepcao.fluidez ?? null;
  const telaFps = media(recepcao.map((x) => x.fpsExibidos));
  const gargalo =
    captura?.fps != null && captura.fps < QUALIDADES[qualidade].fps * 0.85
      ? ['medio', 'captura abaixo do alvo']
      : limite !== 'none'
        ? ['ruim', `limite: ${limite === 'cpu' ? 'processador/placa' : limite === 'bandwidth' ? 'banda' : limite}`]
        : ['bom', 'sem gargalo'];

  return (
    <div className="teste-ao-vivo">
      <header className="teste-topo">
        <h1>Teste de desempenho</h1>
        <span className="gravando">
          <span className="ponto" /> {estado.fase === 'encerrando' ? 'GERANDO O RELATÓRIO…' : `GRAVANDO · ${minSec(estado.segundos)}`}
        </span>
        <span className="pilula neutra">
          {simulado ? 'Espectadores simulados' : 'Com os amigos'} · {QUALIDADES[qualidade].rotulo}
        </span>
        <div className="teste-topo-acoes">
          {simulado && (
            <button type="button" className="botao botao-secundario" onClick={() => teste.pularEtapa()} disabled={estado.fase !== 'gravando'}>
              <SkipForward size={16} /> Pular etapa
            </button>
          )}
          <button type="button" className="botao botao-primario" onClick={() => void teste.parar()} disabled={estado.fase !== 'gravando'}>
            <Square size={14} /> Parar e ver relatório
          </button>
        </div>
      </header>

      {simulado && (
        <ol className="teste-etapas">
          {estado.etapas.map((e, i) => {
            const nota = estado.notas[i];
            const situacao = i < estado.etapaAtual ? 'feita' : i === estado.etapaAtual ? 'atual' : 'futura';
            return (
              <li key={i} className={`teste-etapa ${situacao}`} aria-current={situacao === 'atual' ? 'step' : undefined}>
                <b>{e.nome}</b>
                <small>
                  {e.aquecimento ? `${e.segundos} s` : `${e.espectadores} ${e.espectadores === 1 ? 'espectador' : 'espectadores'} · ${e.segundos} s`}
                </small>
                {situacao === 'feita' && (
                  <span className={`nota pilula ${nota == null || nota < 0 ? 'bom' : nota >= 97 ? 'bom' : nota >= 90 ? 'medio' : 'ruim'}`}>
                    {nota == null || nota < 0 ? '✓' : `${fmt(nota)}%`}
                  </span>
                )}
                {situacao === 'atual' && <span className="barra" style={{ width: `${decorrido * 100}%` }} />}
              </li>
            );
          })}
        </ol>
      )}

      <div className="teste-corpo">
        <div className="teste-esquerda">
          {simulado ? (
            <div className="teste-video">
              {estado.simulados[0] ? <Video stream={estado.simulados[0]} rotulo="O que o espectador simulado 1 vê" /> : <div className="teste-video-vazio">Conectando o espectador simulado…</div>}
              <div className="teste-video-hud">
                <span>O que o espectador vê</span>
                {recepcao[0]?.altura && (
                  <span>
                    {recepcao[0].largura}×{recepcao[0].altura} · {Math.round(recepcao[0].fpsExibidos ?? recepcao[0].fpsDecodificados)} fps
                  </span>
                )}
                {envio[0]?.codec && (
                  <span style={{ color: codificadorDaPlaca === false ? 'var(--ruim)' : codificadorDaPlaca ? 'var(--bom)' : undefined }}>
                    {envio[0].codec}
                    {codificadorDaPlaca === false ? ' · software' : codificadorDaPlaca ? ' · placa de vídeo' : ''}
                  </span>
                )}
              </div>
              {estado.simulados.length > 1 && (
                <div className="teste-miniaturas" aria-label="Os outros espectadores simulados">
                  {estado.simulados.slice(1).map((s, i) => (
                    <Video key={s.id} stream={s} rotulo={`Espectador simulado ${i + 2}`} />
                  ))}
                </div>
              )}
              <div className="teste-video-quem">
                <b>
                  {estado.simulados.length} {estado.simulados.length === 1 ? 'espectador simulado' : 'espectadores simulados'}
                </b>{' '}
                · conexões locais, ninguém da sala vê este teste
              </div>
            </div>
          ) : (
            <>
            {minhaTela && (
              <div className="teste-video">
                <Video stream={minhaTela} rotulo="O que você está transmitindo" />
                <div className="teste-video-hud">
                  <span>O que você está transmitindo</span>
                </div>
              </div>
            )}
            <div className="cartao-teste teste-amigos">
              <h2>Amigos assistindo</h2>
              {recepcao.length === 0 ? (
                <p className="ajuda">Esperando as medidas dos amigos… (chegam a cada segundo, depois que a conexão abre o canal de medidas)</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Amigo</th>
                      <th>Imagem</th>
                      <th>Na tela</th>
                      <th>Pior quadro</th>
                      <th>Perda</th>
                      <th>Ida e volta</th>
                      <th>Congelou</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recepcao.map((x) => (
                      <tr key={x.espectador}>
                        <td>{x.espectador}</td>
                        <td>{x.altura ? `${x.altura}p` : '?'}</td>
                        <td>{x.fpsExibidos != null ? `${Math.round(x.fpsExibidos)} fps` : 'janela escondida'}</td>
                        <td>{x.ritmo ? `${Math.round(x.ritmo.maxMs)} ms` : '—'}</td>
                        <td>{fmt(x.perdaPct, '%', 2)}</td>
                        <td>{fmt(x.rttMs, ' ms', 0)}</td>
                        <td>{x.congelamentos > 0 ? `${x.msCongelado} ms` : 'não'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            </>
          )}
          <div className="cartao-teste teste-ritmo">
            <header>
              <h2>Ritmo dos quadros</h2>
              <p>
                {simulado
                  ? 'Intervalo entre cada quadro mostrado na tela, últimos 10 s. Reto = fluido; picos = engasgos que dá para sentir.'
                  : 'O pior intervalo entre quadros de cada segundo, entre todos os amigos, último minuto.'}
              </p>
            </header>
            <GraficoDoRitmo alvoFps={r?.conteudoFps ?? QUALIDADES[qualidade].fps} />
          </div>
        </div>

        <div className="teste-direita">
          <div className="teste-kpis">
            <div className="cartao-teste kpi">
              <span className="rotulo">Fluidez {estado.estabilizando && <em className="estabilizando">estabilizando…</em>}</span>
              <div className="valor">
                {fluidez != null ? fmt(fluidez) : '—'}
                <small>% no tempo</small>
              </div>
              <p>
                pior 1% dos quadros: <b>{fmt(r?.recepcao.p99Ms ?? null, ' ms', 0)}</b>
              </p>
            </div>
            <div className="cartao-teste kpi">
              <span className="rotulo">Atraso estimado</span>
              <div className="valor">
                {atraso?.total ? Math.round(atraso.total) : '—'}
                <small>ms</small>
              </div>
              <p>{simulado ? 'do jogo até a tela, sem a internet' : 'do jogo até a tela do amigo'}</p>
            </div>
          </div>

          <div className="cartao-teste bloco">
            <h3>
              Caminho de cada quadro <span className={`pilula ${gargalo[0]}`}>{gargalo[1]}</span>
            </h3>
            <div className="funil">
              <div>
                <small>Captura</small>
                <b>{captura?.fps != null ? Math.round(captura.fps) : '—'}</b>
                <small>fps</small>
              </div>
              <div>
                <small>Codificados</small>
                <b>{envio.length ? Math.round(media(envio.map((e) => e.fpsCodificados)) ?? 0) : '—'}</b>
                <small>fps</small>
              </div>
              <div>
                <small>Decodificados</small>
                <b>{recepcao.length ? Math.round(media(recepcao.map((x) => x.fpsDecodificados)) ?? 0) : '—'}</b>
                <small>fps</small>
              </div>
              <div>
                <small>Na tela</small>
                <b className="destaque">{telaFps != null ? Math.round(telaFps) : '—'}</b>
                <small>fps</small>
              </div>
            </div>
          </div>

          <div className="cartao-teste bloco">
            <h3>Onde o atraso está</h3>
            <div className="atraso-barra">
              {partesDoAtraso.map(([nome, v, cor]) => (
                <span key={nome as string} style={{ flex: Math.max(0.5, v as number), background: cor as string }} />
              ))}
            </div>
            <div className="atraso-itens">
              {partesDoAtraso.map(([nome, v, cor]) => (
                <div key={nome as string}>
                  <i style={{ background: cor as string }} />
                  {nome}
                  <b>{fmt(v as number, ' ms', 0)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="cartao-teste bloco">
            <h3>Codificador e PC</h3>
            <dl className="linhas">
              <dt>Bitrate</dt>
              <dd>
                {fmt(media(envio.map((e) => e.mbps)), '', 1)} de {fmt(QUALIDADES[qualidade].bitrate / 1e6, ' Mbps', 1)} por espectador
              </dd>
              <Minigrafico valores={estado.series.mbps} cor="#b6f24a" />
              <dt>Codificação</dt>
              <dd>
                {fmt(media(envio.map((e) => e.msCodificacao)), ' ms')} por quadro
                {envio[0]?.codificador ? ` · ${envio[0].codificador}` : ''}
              </dd>
              <Minigrafico valores={estado.series.codificacao} cor="#b38cff" />
              <dt>Nitidez (QP)</dt>
              <dd>{fmt(media(envio.map((e) => e.qp)))}</dd>
              <Minigrafico valores={estado.series.qp} cor="#5fb4ff" />
              <dt>Processador</dt>
              <dd>{pc ? `${fmt(pc.cpuApp, '%', 0)} (Ozamigos) · ${fmt(pc.cpuPc, '%', 0)} (PC)` : 'só no app para Windows'}</dd>
              <Minigrafico valores={estado.series.cpu} cor="#ffc145" />
              <dt>Placa de vídeo</dt>
              <dd>{pc?.placa3dTotal != null ? `3D ${fmt(pc.placa3dTotal, '%', 0)} · vídeo ${fmt(pc.placaVideoTotal, '%', 0)}` : 'só no app para Windows'}</dd>
              <Minigrafico valores={estado.series.placa} cor="#3ddc84" />
              <dt>Limite</dt>
              <dd>{limite === 'none' ? 'nenhum' : limite}</dd>
              <span />
            </dl>
          </div>

          <div className="cartao-teste eventos">
            <h3>Acontecimentos</h3>
            <ol>
              {estado.acontecimentos.slice(0, 8).map((e, i) => (
                <li key={`${e.t}-${i}`}>
                  <time>{minSec(e.t)}</time>
                  <span className={`ponto ${e.tipo}`} />
                  <span>{e.texto}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Relatório =====

function Relatorio({ gravacao, aoFechar }: { gravacao: Gravacao; aoFechar: () => void }) {
  const analise = useMemo(() => analisar(gravacao), [gravacao]);
  const html = useMemo(() => relatorioHtml(gravacao, analise), [gravacao, analise]);
  const md = useMemo(() => relatorioParaIa(gravacao, analise), [gravacao, analise]);
  const nome = `ozamigos-desempenho-${gravacao.inicio.slice(0, 16).replace(/[T:]/g, '-')}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(md);
      cliente.avisar('Relatório para IA copiado. Cole numa conversa com a IA e peça para analisar e propor melhorias.');
    } catch {
      cliente.avisar('Não foi possível copiar; use "Salvar para IA".', 'erro');
    }
  }

  return (
    <div className="teste-relatorio">
      <header className="teste-topo">
        <h1>Relatório de desempenho</h1>
        <div className="teste-topo-acoes">
          <button type="button" className="botao botao-primario" onClick={() => void copiar()} title="O relatório completo em texto, com o contexto do app, as regras e os dados de cada segundo">
            <Bot size={16} /> Copiar para IA
          </button>
          <button type="button" className="botao botao-secundario" onClick={() => baixar(`${nome}-para-ia.md`, md, 'text/markdown')}>
            <FileText size={16} /> Salvar para IA
          </button>
          <button type="button" className="botao botao-secundario" onClick={() => baixar(`${nome}.html`, html, 'text/html')}>
            <Download size={16} /> Salvar relatório
          </button>
          <button type="button" className="botao botao-secundario" onClick={() => baixar(`${nome}.json`, JSON.stringify(gravacao, null, 1), 'application/json')}>
            <FileJson size={16} /> Dados (JSON)
          </button>
          <button type="button" className="botao botao-fantasma" onClick={() => teste.limpar()}>
            <RotateCcw size={16} /> Novo teste
          </button>
          <button type="button" className="botao-icone" aria-label="Fechar" onClick={aoFechar}>
            <X size={20} />
          </button>
        </div>
      </header>
      <iframe className="teste-pagina" title="Relatório de desempenho" sandbox="" srcDoc={html} />
      <p className="teste-copiar-dica">
        <Copy size={14} aria-hidden="true" /> Para melhorar o app: “Copiar para IA” e cole numa conversa com a IA (ChatGPT, Claude, Gemini), pedindo para
        analisar e propor mudanças no código. O texto já explica como o Ozamigos funciona e o que cada número significa.
      </p>
    </div>
  );
}
