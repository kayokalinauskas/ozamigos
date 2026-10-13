// O relatório para colar numa IA (ChatGPT, Claude, Gemini…) e pedir correções no código. É Markdown com
// tudo que a IA precisa e não teria como adivinhar: como o Ozamigos transmite, o que cada número significa,
// as regras que geraram cada conclusão e os dados de cada segundo em CSV.

import { QUALIDADES } from '../qualidade';
import { NOMES_DOS_GARGALOS, fmt, type Analise, type ResumoDoTrecho } from './analise';
import { FAIXAS, type Gravacao } from './tipos';
import { SEGUNDOS_DESCARTADOS } from './gravacao';

const LINHAS_MAXIMAS = 900; // por tabela de CSV: acima disso, junta segundos vizinhos (média)

const celula = (v: unknown) => (v == null || v === '' ? '—' : String(v).replace(/\|/g, '/').replace(/\n/g, ' '));

function tabela(cabecalho: string[], linhas: unknown[][]): string {
  return [
    `| ${cabecalho.join(' | ')} |`,
    `| ${cabecalho.map(() => '---').join(' | ')} |`,
    ...linhas.map((l) => `| ${l.map(celula).join(' | ')} |`),
  ].join('\n');
}

const csvValor = (v: unknown) => {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const texto = String(v);
  return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
};

function csv(cabecalho: string[], linhas: unknown[][]): string {
  return ['```csv', cabecalho.join(','), ...linhas.map((l) => l.map(csvValor).join(',')), '```'].join('\n');
}

/**
 * Junta segundos vizinhos (por chave, ex.: espectador) quando há linhas demais.
 * Números viram média; texto fica o mais comum; contadores (somar) são somados.
 */
function reduzir<T extends { t: number }>(linhas: T[], chave: (l: T) => string, somar: (keyof T)[] = []): { passo: number; linhas: T[] } {
  if (linhas.length <= LINHAS_MAXIMAS) return { passo: 1, linhas };
  const passo = Math.ceil(linhas.length / LINHAS_MAXIMAS);
  const grupos = new Map<string, T[]>();
  for (const l of linhas) {
    const k = `${Math.floor(l.t / passo)}|${chave(l)}`;
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const resultado: T[] = [];
  for (const grupo of grupos.values()) {
    const base: Record<string, unknown> = { ...grupo[0], t: Math.floor(grupo[0].t / passo) * passo };
    for (const campo of Object.keys(grupo[0]) as (keyof T)[]) {
      if (campo === 't') continue;
      const nums = grupo.map((l) => l[campo]).filter((v): v is T[keyof T] & number => typeof v === 'number');
      if (nums.length) {
        const total = nums.reduce((a, b) => a + b, 0);
        base[campo as string] = somar.includes(campo) ? total : Math.round((total / nums.length) * 10) / 10;
      }
    }
    resultado.push(base as T);
  }
  return { passo, linhas: resultado.sort((a, b) => a.t - b.t) };
}

const NOME_DA_GRAVIDADE = { alta: 'ALTA', media: 'MÉDIA', baixa: 'BAIXA', ok: 'OK' };

function linhaDoTrecho(t: ResumoDoTrecho) {
  return `${t.trecho.indice + 1}. ${t.trecho.nome}`;
}

export function relatorioParaIa(g: Gravacao, a: Analise): string {
  const validos = a.trechos.filter((t) => t.segundos > 0 && !t.trecho.aquecimento);
  const partes: string[] = [];
  const p = (...linhas: string[]) => partes.push(...linhas);

  p(
    '# Ozamigos — relatório de desempenho da transmissão',
    '',
    `<!-- formato: ${g.formato} · gerado em ${new Date().toISOString()} -->`,
    '',
    '> **Para a IA que vai ler isto.** O Ozamigos é um app (Electron + React + WebRTC) que transmite a tela de um jogo de um PC',
    '> para os amigos, direto de um PC para o outro (malha P2P, sem servidor de mídia). Este arquivo é um teste de desempenho de',
    '> quem transmite. Os números vêm do `getStats()` do WebRTC, do `requestVideoFrameCallback` (ritmo real na tela) e dos',
    '> contadores do Windows (processador e motores da placa de vídeo). O que é estimativa está marcado como estimado.',
    '>',
    '> **Tarefa sugerida:** (1) confirme ou conteste os diagnósticos da seção 2 usando as evidências e as séries da seção 9;',
    '> (2) proponha mudanças concretas no código do Ozamigos, citando arquivo e constante (as pistas estão em "Onde mexer" e na',
    '> seção 5); (3) diga qual número deste relatório deve melhorar e quanto, para validar a mudança com um teste novo.',
    '> Os trechos são comparáveis entre si: mesma fonte de imagem, só muda a qualidade ou o número de espectadores.',
    '',
  );

  // 1. Resumo
  p('## 1. Resumo', '');
  p(`**${a.recomendacao.titulo}.** ${a.recomendacao.texto}`, '');
  p(
    tabela(
      ['Medida', 'Valor'],
      [
        ['Modo', g.modo === 'simulado' ? `simulado (espectadores no próprio PC), roteiro ${g.roteiro}` : 'com amigos de verdade assistindo'],
        ['Duração', `${g.duracao} s${g.interrompido ? ' (interrompido antes do fim)' : ''}`],
        ['Qualidade escolhida pela pessoa', `${g.qualidadeDaPessoa} (${QUALIDADES[g.qualidadeDaPessoa].rotulo})`],
        ['Fluidez na qualidade da pessoa', fmt(a.principal.fluidez, '% dos quadros no tempo')],
        ['Pior 1% dos intervalos entre quadros', fmt(a.principal.p99Ms, ' ms')],
        [g.modo === 'simulado' ? 'Atraso estimado (sem internet no caminho)' : 'Atraso estimado', fmt(a.principal.atraso, ' ms', 0)],
        ['Gargalo principal', `${NOMES_DOS_GARGALOS[a.principal.gargalo] ?? a.principal.gargalo} (\`${a.principal.gargalo}\`)`],
      ],
    ),
    '',
  );
  p(
    tabela(
      ['Gravidade', 'Código', 'Conclusão'],
      a.diagnosticos.map((d) => [NOME_DA_GRAVIDADE[d.gravidade], `\`${d.codigo}\``, d.titulo]),
    ),
    '',
  );

  // 2. Diagnósticos
  p('## 2. Diagnósticos (com as evidências)', '');
  for (const d of a.diagnosticos) {
    p(`### [${NOME_DA_GRAVIDADE[d.gravidade]}] ${d.titulo} (\`${d.codigo}\`)`, '', d.detalhe, '', '**Evidências:**', ...d.evidencias.map((e) => `- ${e}`), '');
    if (d.paraVoce) p(`**Para quem transmite:** ${d.paraVoce}`, '');
    if (d.paraOApp) p(`**Para o app:** ${d.paraOApp}`, '');
    if (d.ondeNoCodigo?.length) p(`**Onde mexer:** ${d.ondeNoCodigo.map((c) => `\`${c}\``).join('; ')}`, '');
  }

  // 3. Trechos
  p(
    '## 3. Trechos',
    '',
    `Médias de cada trecho, sem os primeiros ${SEGUNDOS_DESCARTADOS} s (o WebRTC começa com pouca banda e sobe). "esp." = espectadores ao mesmo tempo. Resultado: ótimo / bom / atenção / ruim (regras na seção 6).`,
    '',
    '**Imagem e fluidez (quem assiste)**',
    '',
    tabela(
      ['Trecho', 'Qualidade', 'Esp.', 'Seg.', 'Captura fps', 'Codif. fps', 'Decod. fps', 'Tela fps', 'Fluidez %', 'p99 ms', 'Pior ms', 'Engasgos', 'Congel.', 'Resultado'],
      validos.map((t) => [
        linhaDoTrecho(t),
        t.trecho.qualidade,
        t.trecho.espectadores,
        t.segundos,
        fmt(t.captura.fps),
        fmt(t.envio.fpsCodificados),
        fmt(t.recepcao.fpsDecodificados),
        fmt(t.recepcao.fpsExibidos),
        fmt(t.recepcao.fluidez),
        fmt(t.recepcao.p99Ms),
        fmt(t.recepcao.piorMs),
        t.recepcao.engasgos,
        `${t.recepcao.congelamentos} (${t.recepcao.msCongelado} ms)`,
        t.resultado,
      ]),
    ),
    '',
    '**Codificador e rede (quem transmite, média por espectador)**',
    '',
    tabela(
      ['Trecho', 'Esp.', 'Altura', 'Mbps', 'Alvo Mbps', 'ms/quadro', 'ms máx', 'QP', 'Limite (% do tempo)', 'Mud. resol.', 'Q.-chave/min', 'PLI/min', 'Fila ms', 'RTT ms', 'Banda Mbps', 'Codificador'],
      validos.map((t) => [
        linhaDoTrecho(t),
        t.trecho.espectadores,
        t.envio.alturaMaisComum,
        fmt(t.envio.mbps, '', 2),
        fmt(t.envio.alvoMbps, '', 2),
        fmt(t.envio.msCodificacao),
        fmt(t.envio.msCodificacaoMax),
        fmt(t.envio.qp),
        Object.entries(t.envio.limites)
          .map(([k, v]) => `${k} ${fmt(v)}`)
          .join(', '),
        t.envio.mudancasDeResolucao,
        fmt(t.envio.quadrosChavePorMin),
        fmt(t.envio.plisPorMin),
        fmt(t.envio.msFilaDeEnvio),
        fmt(t.envio.rttMs, '', 0),
        fmt(t.envio.bandaMbps, '', 2),
        `${t.envio.codificador ?? '?'}${t.envio.codificadorDaPlaca === true ? ' (placa)' : t.envio.codificadorDaPlaca === false ? ' (software)' : ''}`,
      ]),
    ),
    '',
    '**Recepção (quem assiste)**',
    '',
    tabela(
      ['Trecho', 'Esp.', 'Decod. ms', 'Buffer ms', 'Desvio intervalo ms', 'Perda %', 'Jitter ms', 'Descartados', 'Recebido→tela ms', 'Captura→tela ms (medido)', 'Decodificador'],
      validos.map((t) => [
        linhaDoTrecho(t),
        t.trecho.espectadores,
        fmt(t.recepcao.msDecodificacao),
        fmt(t.recepcao.msBuffer),
        fmt(t.recepcao.intervaloDesvioMs),
        fmt(t.recepcao.perdaPct, '', 2),
        fmt(t.recepcao.jitterMs),
        t.recepcao.descartados,
        fmt(t.recepcao.msRecebidoAteTela, '', 0),
        fmt(t.recepcao.msCapturaAteTela, '', 0),
        t.recepcao.decodificador ?? '?',
      ]),
    ),
    '',
    '**Atraso estimado (ms): codificação + fila de envio + rede (RTT/2) + buffer + decodificação**',
    '',
    tabela(
      ['Trecho', 'Esp.', 'Codificação', 'Fila', 'Rede', 'Buffer', 'Decodificação', 'Total estimado', 'Medido captura→tela'],
      validos.map((t) => [
        linhaDoTrecho(t),
        t.trecho.espectadores,
        fmt(t.atraso.codificacao),
        fmt(t.atraso.fila),
        fmt(t.atraso.rede),
        fmt(t.atraso.buffer),
        fmt(t.atraso.decodificacao),
        fmt(t.atraso.total, '', 0),
        fmt(t.atraso.medido, '', 0),
      ]),
    ),
    '',
    '**PC de quem transmite e a interface**',
    '',
    tabela(
      ['Trecho', 'Esp.', 'CPU app %', 'CPU app máx', 'CPU PC %', 'Placa 3D %', 'Placa 3D máx', 'Motor de vídeo %', 'Motor de vídeo máx', 'Placa 3D do jogo/outros %', 'Memória placa MB', 'Tarefas longas', 'Maior tarefa ms', 'Engasgos c/ tarefa longa'],
      validos.map((t) => [
        linhaDoTrecho(t),
        t.trecho.espectadores,
        fmt(t.pc.cpuApp),
        fmt(t.pc.cpuAppMax),
        fmt(t.pc.cpuPc),
        fmt(t.pc.placa3dTotal),
        fmt(t.pc.placa3dTotalMax),
        fmt(t.pc.placaVideoTotal),
        fmt(t.pc.placaVideoTotalMax),
        fmt(t.pc.placa3dOutros),
        fmt(t.pc.memoriaPlacaMB, '', 0),
        t.pagina.tarefasLongas,
        t.pagina.msTarefaMaior,
        `${t.pagina.engasgosJuntoComTarefaLonga} de ${t.pagina.segundosComEngasgo} s`,
      ]),
    ),
    '',
  );
  const porEspectador = validos.filter((t) => t.recepcao.porEspectador.length > 1 || g.modo === 'amigos');
  if (porEspectador.length) {
    p(
      '**Por espectador**',
      '',
      tabela(
        ['Trecho', 'Espectador', 'Tela fps', 'Fluidez %', 'Congelamentos', 'Perda %', 'RTT ms'],
        porEspectador.flatMap((t) =>
          t.recepcao.porEspectador.map((e) => [linhaDoTrecho(t), e.nome, fmt(e.fpsExibidos), fmt(e.fluidez), e.congelamentos, fmt(e.perdaPct, '', 2), fmt(e.rttMs, '', 0)]),
        ),
      ),
      '',
    );
  }

  // 4. Ambiente
  const pc = g.pc;
  p(
    '## 4. Ambiente',
    '',
    tabela(
      ['Item', 'Valor'],
      [
        ['Ozamigos', g.app],
        ['Navegador', g.navegador],
        ['Sistema', pc?.sistema ?? '?'],
        ['Processador', pc ? `${pc.processador} (${pc.nucleos} núcleos lógicos)` : '?'],
        ['Memória', pc ? `${pc.memoriaGB} GB` : '?'],
        ['Placa de vídeo', pc?.placa ? `${pc.placa.nome ?? '?'} · driver ${pc.placa.driver ?? '?'}` : '?'],
        ['Telas', pc?.telas.map((t) => `${t.tamanho} ${t.hz} Hz escala ${t.escala}${t.principal ? ' (principal)' : ''}`).join('; ') ?? g.tela],
        ['Electron / Chromium', pc ? `${pc.electron} / ${pc.chrome}` : '?'],
        ['Contadores do Windows', pc?.contadoresDoWindows ? 'sim (processador do PC e motores da placa)' : 'não (só no app para Windows)'],
        ['O que foi transmitido', g.fonte],
        ['Início', g.inicio],
      ],
    ),
    '',
  );
  if (g.espectadoresReais.length) {
    p(
      '**Amigos que assistiram**',
      '',
      tabela(
        ['Nome', 'Ozamigos', 'Tela', 'Núcleos', 'Navegador'],
        g.espectadoresReais.map((e) => [e.nome, e.ambiente?.app, e.ambiente?.tela, e.ambiente?.nucleos, e.ambiente?.navegador]),
      ),
      '',
    );
  }

  // 5. Configuração
  p(
    '## 5. Como esta versão do Ozamigos transmite',
    '',
    '- Cada pessoa assistindo ganha uma `RTCPeerConnection` só dela, com uma codificação própria da mesma captura (`web/src/cliente.ts`, `enviarOferta` → `montarEnvio`). 7 pessoas = 7 codificações simultâneas na placa de quem transmite.',
    '- A captura (`getDisplayMedia` no navegador, `desktopCapturer` no app) já sai no tamanho e no fps da qualidade (`tamanhoDaCaptura`), e o codificador não reduz a imagem (`scaleResolutionDownBy: 1`).',
    '- As qualidades mudam ao vivo com `setParameters` (`aplicarQualidade`), sem renegociar.',
    '- O app (Electron) desliga o descarte de quadros do WebRTC: `force-fieldtrials=WebRTC-FrameDropper/Disabled/` (`desktop/main.js`), porque o codificador da placa passava do alvo em cenas cheias e o WebRTC descartava quadros.',
    '- Quem assiste segura uns quadros antes de mostrar (`jitterBufferTarget` = `FOLGA_DE_REDE`), contra soluços do Wi-Fi.',
    '- A sinalização passa por um servidor Spring Boot (WebSocket); o vídeo não passa por ele. Só STUN, sem TURN.',
    '',
    '**Ajustes (lidos do código desta versão):**',
    '',
    '```json',
    JSON.stringify(g.ajustes, null, 2),
    '```',
    '',
    '**Qualidades (`web/src/qualidade.ts`, QUALIDADES):**',
    '',
    '```json',
    JSON.stringify(g.qualidades, null, 2),
    '```',
    '',
  );

  // 6. Protocolo
  p('## 6. Como o teste foi feito', '');
  if (g.modo === 'simulado') {
    p(
      '- **Modo simulado:** os espectadores são pares de `RTCPeerConnection` no mesmo PC e na mesma página de quem transmite, ligados direto (sem servidor e sem internet), com a mesma configuração de envio e de recepção dos amigos de verdade. Cada um recebe, decodifica e mostra o vídeo num `<video>` na tela do teste.',
      '- **Limites do simulado:** não há perda nem atraso de rede; a decodificação dos simulados acontece no PC de quem transmite (soma carga que amigos reais não somam); travadas desta página atingem os simulados.',
      `- **Roteiro:** ${g.trechos.map((t) => `${t.nome} × ${t.espectadores}${t.aquecimento ? ' (aquecimento, fora das conclusões)' : ''} (${t.fim - t.inicio} s)`).join(' → ')}.`,
      '- Quem já estava assistindo de verdade continua assistindo durante o teste e entra nas medidas de envio.',
    );
  } else {
    p(
      '- **Modo com os amigos:** a transmissão de verdade. Quem transmite mede o envio de cada conexão; cada amigo manda, a cada segundo, pelo canal de dados `medidas` da própria conexão, como a imagem chega no PC dele (mesmas medidas do modo simulado).',
      '- Um trecho novo começa a cada mudança de qualidade ou de quantas pessoas assistem.',
    );
  }
  p(
    `- Os primeiros ${SEGUNDOS_DESCARTADOS} s de cada trecho ficam fora das médias (subida da estimativa de banda do WebRTC). As séries da seção 9 têm todos os segundos.`,
    '- **Fluidez:** % dos intervalos entre quadros exibidos (requestVideoFrameCallback, `expectedDisplayTime`) até 1,5× o intervalo esperado. O esperado vem do fps do conteúdo = menor entre o fps da qualidade e o fps da captura (um jogo a 45 fps não é cobrado por 60). Contado por faixas de intervalo.',
    '- **Engasgo:** intervalo acima de 2× o esperado. **Congelamento:** o `freezeCount` do WebRTC (intervalo > 3× a média ou > 150 ms).',
    '- **Resultado do trecho:** ruim se fluidez < 90% ou fps na tela < 80% do conteúdo ou mais de 2 congelamentos; atenção se fluidez < 97%, fps < 93%, algum limite do codificador > 20% do tempo ou algum congelamento; bom se fluidez < 99% ou fps < 97%; senão ótimo.',
    '- **Uso da placa de vídeo:** contadores "GPU Engine" do Windows (os do Gerenciador de Tarefas). "Motor de vídeo" é o motor de codificação/decodificação mais ocupado (na AMD aparece como "Video Codec Engine", na NVIDIA como "VideoEncode"/"VideoDecode"). "Do jogo/outros" = processos que não são do Ozamigos.',
    '- **CPU app:** soma dos processos do Ozamigos em % do processador inteiro (todos os núcleos = 100%).',
    '',
  );

  // 7. Glossário
  p(
    '## 7. Glossário das colunas das séries',
    '',
    tabela(
      ['Coluna', 'O que é', 'De onde vem', 'Referência'],
      [
        ['t', 'segundos desde o início do teste', '—', '—'],
        ['fps_codif', 'quadros codificados por segundo', 'outbound-rtp framesEncoded', '= fps da qualidade'],
        ['mbps / alvo_mbps', 'bitrate enviado / pedido pelo controle de banda', 'bytesSent, targetBitrate', 'ver QUALIDADES'],
        ['ms_codif', 'tempo médio do codificador por quadro', 'totalEncodeTime / framesEncoded', '< 50% do intervalo entre quadros (8 ms a 60 fps)'],
        ['qp', 'quantização média (H.264)', 'qpSum / framesEncoded', '~18–28 nítido; > 32 borrado'],
        ['limite', 'o que está segurando o codificador', 'qualityLimitationReason', 'none'],
        ['ms_fila', 'espera média do pacote no pacer', 'totalPacketSendDelay / packetsSent', '< 5 ms'],
        ['plis / nacks', 'pedidos de quadro-chave / de reenvio de quem assiste', 'pliCount, nackCount', '~0 em rede boa'],
        ['rtt_ms', 'ida e volta', 'candidate-pair currentRoundTripTime', '< 60 ms mesma cidade'],
        ['fps_receb / fps_decod / fps_tela', 'quadros recebidos / decodificados / mostrados na tela', 'framesReceived, framesDecoded, requestVideoFrameCallback', 'iguais ao fps do conteúdo'],
        ['ms_decod', 'decodificação por quadro', 'totalDecodeTime / framesDecoded', '< 5 ms com a placa'],
        ['ms_buffer', 'espera no jitter buffer', 'jitterBufferDelay / jitterBufferEmittedCount', '≈ jitterBufferTarget'],
        ['int_medio / int_desvio', 'intervalo entre quadros na saída do decodificador e o desvio padrão', 'totalInterFrameDelay, totalSquaredInterFrameDelay', 'desvio < 4 ms = regular'],
        ['ritmo_p99 / ritmo_max', 'intervalo entre quadros na tela: percentil 99 e o maior do segundo', 'requestVideoFrameCallback expectedDisplayTime', '≤ 1,5× o esperado'],
        ['receb_tela', 'último pacote do quadro chegou → quadro na tela', 'VideoFrameCallbackMetadata.receiveTime', '—'],
        ['captura_tela', 'captura → quadro na tela (só quando o navegador informa)', 'VideoFrameCallbackMetadata.captureTime', 'é o atraso real ponta a ponta'],
        ['congel / ms_congel', 'congelamentos e duração', 'freezeCount, totalFreezesDuration', '0'],
        ['perda_pct', 'pacotes perdidos', 'packetsLost / (packetsLost + packetsReceived)', '< 0,5%'],
        ['tela_visivel', '1 = a página estava visível (o ritmo na tela só é medido assim)', 'document.visibilityState', '1'],
        ['cpu_app / cpu_pc', 'processador do Ozamigos / do PC inteiro (%)', 'app.getAppMetrics, contador Processor', '—'],
        ['placa3d_total / placa_video_total', 'motor 3D / motor de vídeo da placa, todos os processos (%)', 'GPU Engine Utilization Percentage', '< 90%'],
        ['placa3d_app / placa_video_app', 'o mesmo, só os processos do Ozamigos', 'idem, por pid', '—'],
        ['tarefas_longas / ms_tarefa_maior', 'travadas da página de quem transmite (> 50 ms)', 'PerformanceObserver longtask', '0'],
        ['captura_fps', 'quadros que o Windows entrega ao navegador', 'media-source framesPerSecond', '= fps da qualidade'],
      ],
    ),
    '',
    `Faixas dos intervalos (ms, limite de cima): ${FAIXAS.map((f) => (Number.isFinite(f) ? f : '∞')).join(', ')}.`,
    '',
  );

  // 8. Acontecimentos
  p('## 8. Acontecimentos', '', tabela(['t (s)', 'Tipo', 'O que aconteceu'], g.acontecimentos.map((e) => [e.t, e.tipo, e.texto])), '');

  // 9. Séries
  p('## 9. Séries de cada segundo', '');
  const trechoDe = (t: number) => g.trechos.findLast((tr) => t >= tr.inicio)?.indice ?? -1;
  const envio = reduzir(g.envio, (l) => l.espectador, ['quadrosChave', 'plis', 'nacks']);
  p(
    `**Envio** (uma linha por espectador por ${envio.passo === 1 ? 'segundo' : `${envio.passo} s, médias`}; trecho = número da seção 3):`,
    '',
    csv(
      ['t', 'trecho', 'espectador', 'altura', 'fps_codif', 'fps_enviados', 'mbps', 'alvo_mbps', 'ms_codif', 'qp', 'q_chave', 'limite', 'ms_fila', 'plis', 'nacks', 'retrans_kbps', 'rtt_ms', 'banda_mbps', 'rede'],
      envio.linhas.map((l) => [
        l.t,
        trechoDe(l.t) + 1,
        l.espectador,
        l.altura,
        l.fpsCodificados,
        l.fpsEnviados,
        l.mbps,
        l.alvoMbps,
        l.msCodificacao,
        l.qp,
        l.quadrosChave,
        l.limite,
        l.msFilaDeEnvio,
        l.plis,
        l.nacks,
        l.retransmitidosKbps,
        l.rttMs,
        l.bandaMbps,
        l.rede,
      ]),
    ),
    '',
  );
  const recepcao = reduzir(
    g.recepcao.map((r) => ({ ...r, ritmoP99: r.ritmo?.p99Ms ?? null, ritmoMax: r.ritmo?.maxMs ?? null, recebTela: r.ritmo?.msRecebidoAteTela ?? null, capturaTela: r.ritmo?.msCapturaAteTela ?? null })),
    (l) => l.espectador,
    ['congelamentos', 'msCongelado', 'descartados', 'pacotesPerdidos', 'tarefasLongas'],
  );
  p(
    `**Recepção** (uma linha por espectador por ${recepcao.passo === 1 ? 'segundo' : `${recepcao.passo} s, médias`}):`,
    '',
    csv(
      ['t', 'trecho', 'espectador', 'altura', 'fps_receb', 'fps_decod', 'fps_tela', 'mbps', 'ms_decod', 'ms_buffer', 'int_medio', 'int_desvio', 'ritmo_p99', 'ritmo_max', 'receb_tela', 'captura_tela', 'congel', 'ms_congel', 'descartados', 'perda_pct', 'jitter_ms', 'rtt_ms', 'tela_visivel', 'tarefas_longas'],
      recepcao.linhas.map((l) => [
        l.t,
        trechoDe(l.t) + 1,
        l.espectador,
        l.altura,
        l.fpsRecebidos,
        l.fpsDecodificados,
        l.fpsExibidos,
        l.mbps,
        l.msDecodificacao,
        l.msBuffer,
        l.intervaloMedioMs,
        l.intervaloDesvioMs,
        l.ritmoP99,
        l.ritmoMax,
        l.recebTela,
        l.capturaTela,
        l.congelamentos,
        l.msCongelado,
        l.descartados,
        l.perdaPct,
        l.jitterMs,
        l.rttMs,
        l.janelaVisivel,
        l.tarefasLongas,
      ]),
    ),
    '',
  );
  const porSegundo = new Map<number, Record<string, unknown>>();
  const linha = (t: number) => porSegundo.get(t) ?? porSegundo.set(t, { t }).get(t)!;
  for (const c of g.captura) Object.assign(linha(c.t), { capturaFps: c.fps, capturaAltura: c.altura });
  for (const q of g.pcAmostras)
    Object.assign(linha(q.t), {
      cpuApp: q.cpuApp,
      cpuPc: q.cpuPc,
      placa3d: q.placa3dTotal,
      placaVideo: q.placaVideoTotal,
      placa3dApp: q.placa3dApp,
      placaVideoApp: q.placaVideoApp,
      placa3dOutros: q.placa3dOutros,
      memPlaca: q.memoriaPlacaMB,
      memApp: q.memoriaAppMB,
    });
  for (const q of g.pagina) Object.assign(linha(q.t), { tarefas: q.tarefasLongas, tarefaMaior: q.msTarefaMaior, visivel: q.janelaVisivel });
  const pcLinhas = reduzir(
    [...porSegundo.values()].sort((x, y) => (x.t as number) - (y.t as number)) as ({ t: number } & Record<string, unknown>)[],
    () => '',
    ['tarefas'],
  );
  p(
    `**PC de quem transmite, captura e interface** (${pcLinhas.passo === 1 ? 'por segundo' : `a cada ${pcLinhas.passo} s, médias`}):`,
    '',
    csv(
      ['t', 'trecho', 'captura_fps', 'captura_altura', 'cpu_app', 'cpu_pc', 'placa3d_total', 'placa_video_total', 'placa3d_app', 'placa_video_app', 'placa3d_outros', 'mem_placa_mb', 'mem_app_mb', 'tarefas_longas', 'ms_tarefa_maior', 'tela_visivel'],
      pcLinhas.linhas.map((l) => [
        l.t,
        trechoDe(l.t) + 1,
        l.capturaFps,
        l.capturaAltura,
        l.cpuApp,
        l.cpuPc,
        l.placa3d,
        l.placaVideo,
        l.placa3dApp,
        l.placaVideoApp,
        l.placa3dOutros,
        l.memPlaca,
        l.memApp,
        l.tarefas,
        l.tarefaMaior,
        l.visivel,
      ]),
    ),
    '',
    '_Fim do relatório. O arquivo JSON salvo junto tem os mesmos dados sem arredondar nem juntar segundos, mais as faixas de intervalo de cada segundo._',
    '',
  );
  return partes.join('\n');
}
