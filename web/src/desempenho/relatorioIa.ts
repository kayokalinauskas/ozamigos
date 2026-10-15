// O relatório para colar numa IA (ChatGPT, Claude, Gemini…) e pedir correções no código. É Markdown com
// tudo que a IA precisa e não teria como adivinhar: como o Ozamigos transmite, o que cada número significa,
// as regras que geraram cada conclusão e os dados de cada segundo em CSV.

import { QUALIDADES } from '../qualidade';
import { NOMES_DOS_GARGALOS, fmt, type Analise, type ResumoDoTrecho } from './analise';
import type { AnaliseDaSala } from './analiseDaSala';
import { FAIXAS, SEGUNDOS_DESCARTADOS, type AmostraRecepcao, type Gravacao, type GravacaoDaSala } from './tipos';

// Por tabela de CSV: acima disso, junta segundos vizinhos. No relatório da sala, o total de linhas de todas as
// tabelas é dividido por elas (LINHAS_DA_SALA), para o arquivo inteiro caber na conversa com uma IA.
const LINHAS_MAXIMAS = 900;
const LINHAS_DA_SALA = 1500;
const ACONTECIMENTOS_MAXIMOS = 150;
const PIORES_SEGUNDOS = 15;

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
 * Junta segundos vizinhos (por chave, ex.: espectador) quando há mais linhas que o limite.
 * Números viram média; contadores (somar) são somados; picos (maximos) ficam com o maior, para a média não
 * esconder um engasgo. Texto fica o do primeiro segundo do grupo.
 */
function reduzir<T extends { t: number }>(
  linhas: T[],
  chave: (l: T) => string,
  somar: (keyof T)[] = [],
  limite = LINHAS_MAXIMAS,
  maximos: (keyof T)[] = [],
): { passo: number; linhas: T[] } {
  if (linhas.length <= limite) return { passo: 1, linhas };
  const passo = Math.ceil(linhas.length / limite); // juntando `passo` segundos, sobram ~linhas/passo linhas
  const grupos = new Map<string, T[]>();
  for (const l of linhas) {
    const k = `${Math.floor(l.t / passo)}|${chave(l)}`;
    const grupo = grupos.get(k);
    if (grupo) grupo.push(l);
    else grupos.set(k, [l]);
  }
  const resultado: T[] = [];
  for (const grupo of grupos.values()) {
    const base: Record<string, unknown> = { ...grupo[0], t: Math.floor(grupo[0].t / passo) * passo };
    for (const campo of Object.keys(grupo[0]) as (keyof T)[]) {
      if (campo === 't') continue;
      const nums = grupo.map((l) => l[campo]).filter((v): v is T[keyof T] & number => typeof v === 'number');
      if (nums.length) {
        const total = nums.reduce((a, b) => a + b, 0);
        base[campo as string] = somar.includes(campo) ? total : maximos.includes(campo) ? Math.max(...nums) : Math.round((total / nums.length) * 10) / 10;
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

type Empurrar = (...linhas: string[]) => void;
/** sub: o nível dos títulos de dentro; regras e trechos: o número da seção (no relatório da sala, muda). */
type Contexto = { sub: string; regras: string; trechos: string; linhas: number };

const PARA_A_IA_FIM = '_Fim do relatório. O arquivo JSON salvo junto tem os mesmos dados sem arredondar nem juntar segundos, mais as faixas de intervalo de cada segundo._';

function resumo(p: Empurrar, g: Gravacao, a: Analise, titulo: string) {
  p(titulo, '');
  p(`**${a.recomendacao.titulo}.** ${a.recomendacao.texto}`, '');
  p(
    tabela(
      ['Medida', 'Valor'],
      [
        ['Modo', g.modo === 'simulado' ? `simulado (espectadores no próprio PC), roteiro ${g.roteiro}` : 'gravação da sala, com amigos de verdade assistindo'],
        ['Duração', `${g.duracao} s${g.interrompido ? ' (interrompido antes do fim)' : ''}`],
        [g.modo === 'sala' ? 'Qualidade (a mais usada)' : 'Qualidade', `${g.qualidadeDaPessoa} (${QUALIDADES[g.qualidadeDaPessoa].rotulo})`],
        [g.modo === 'sala' ? 'Fluidez (primeiro trecho nessa qualidade)' : 'Fluidez na qualidade da pessoa', fmt(a.principal.fluidez, '% dos quadros no tempo')],
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
}

function diagnosticos(p: Empurrar, a: Analise, titulo: string, c: Contexto) {
  p(titulo, '');
  for (const d of a.diagnosticos) {
    p(`${c.sub} [${NOME_DA_GRAVIDADE[d.gravidade]}] ${d.titulo} (\`${d.codigo}\`)`, '', d.detalhe, '', '**Evidências:**', ...d.evidencias.map((e) => `- ${e}`), '');
    if (d.paraVoce) p(`**Para quem transmite:** ${d.paraVoce}`, '');
    if (d.paraOApp) p(`**Para o app:** ${d.paraOApp}`, '');
    if (d.ondeNoCodigo?.length) p(`**Onde mexer:** ${d.ondeNoCodigo.map((c) => `\`${c}\``).join('; ')}`, '');
  }
}

function trechos(p: Empurrar, g: Gravacao, a: Analise, titulo: string, c: Contexto) {
  const validos = a.trechos.filter((t) => t.segundos > 0 && !t.trecho.aquecimento);
  p(
    titulo,
    '',
    `Médias de cada trecho, sem os primeiros ${SEGUNDOS_DESCARTADOS} s (o WebRTC começa com pouca banda e sobe). "esp." = espectadores ao mesmo tempo. Resultado: ótimo / bom / atenção / ruim (regras na seção ${c.regras}).`,
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
      ['Trecho', 'Esp.', 'Decod. ms', 'Buffer ms', 'Buffer som ms', 'Folga ms', 'Desvio intervalo ms', 'Perda %', 'Jitter ms', 'Descartados', 'Recebido→tela ms', 'Captura→tela ms (medido)', 'Decodificador'],
      validos.map((t) => [
        linhaDoTrecho(t),
        t.trecho.espectadores,
        fmt(t.recepcao.msDecodificacao),
        fmt(t.recepcao.msBuffer),
        fmt(t.recepcao.msBufferSom),
        fmt(t.recepcao.folgaMs, '', 0),
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
  const porEspectador = validos.filter((t) => t.recepcao.porEspectador.length > 1 || g.modo === 'sala');
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
}

function ambiente(p: Empurrar, g: Gravacao, titulo: string) {
  const pc = g.pc;
  p(
    titulo,
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
        ['Nome', 'Ozamigos', 'Tela', 'Núcleos', 'Processador', 'Placa de vídeo', 'Navegador'],
        g.espectadoresReais.map((e) => [
          e.nome,
          e.ambiente?.app,
          e.ambiente?.tela,
          e.ambiente?.nucleos,
          e.ambiente?.pc?.processador,
          e.ambiente?.pc?.placa ? `${e.ambiente.pc.placa.nome ?? '?'} · driver ${e.ambiente.pc.placa.driver ?? '?'}` : null,
          e.ambiente?.navegador,
        ]),
      ),
      '',
    );
  }
}

function configuracao(p: Empurrar, g: Gravacao, titulo: string) {
  p(
    titulo,
    '',
    '- Cada pessoa assistindo ganha uma `RTCPeerConnection` só dela, com uma codificação própria da mesma captura (`enviarOferta` em `web/src/cliente.ts` → `montarEnvio` em `web/src/conexao/captura.ts`). 7 pessoas = 7 codificações simultâneas na placa de quem transmite.',
    '- A captura (`getDisplayMedia` no navegador, `desktopCapturer` no app) já sai no tamanho e no fps da qualidade (`tamanhoDaCaptura`), e o codificador não reduz a imagem (`scaleResolutionDownBy: 1`).',
    '- A qualidade é uma só (720p · 30 fps, sem escolha desde 14/10/2026). Quando falta processador ou banda, o próprio WebRTC baixa o fps e a nitidez de cada conexão, sem mexer na resolução (`degradationPreference: maintain-resolution`, desde 14/10/2026; antes era `balanced`), por pessoa assistindo. O som da transmissão vai num MediaStream separado do vídeo: a imagem não espera o som.',
    '- O app (Electron) desliga o descarte de quadros do WebRTC: `force-fieldtrials=WebRTC-FrameDropper/Disabled/` (`desktop/main.js`), porque o codificador da placa passava do alvo em cenas cheias e o WebRTC descartava quadros.',
    '- Quem assiste segura uns quadros antes de mostrar (`jitterBufferTarget`), contra soluços do Wi-Fi. A folga é adaptativa por conexão (`web/src/folga.ts`): começa em 100 ms, fica entre 80 e 250 ms, sobe com o jitter e a cada congelamento e desce devagar com a rede calma. Ela vale só para o vídeo; o som da transmissão fica com o ajuste automático do WebRTC (antes, a folga também no som fazia a imagem esperar ~200 ms a mais pelo sincronismo).',
    '- A voz da sala anda numa conexão separada por par de pessoas (`web/src/voz/`), sem essa folga: ela não aparece nestas medidas.',
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
}

function protocolo(p: Empurrar, g: Gravacao, titulo: string) {
  p(titulo, '');
  if (g.modo === 'simulado') {
    p(
      '- **Modo simulado:** os espectadores são pares de `RTCPeerConnection` no mesmo PC e na mesma página de quem transmite, ligados direto (sem servidor e sem internet), com a mesma configuração de envio e de recepção dos amigos de verdade. Cada um recebe, decodifica e mostra o vídeo num `<video>` na tela do teste.',
      '- **Limites do simulado:** não há perda nem atraso de rede; a decodificação dos simulados acontece no PC de quem transmite (soma carga que amigos reais não somam); travadas desta página atingem os simulados.',
      `- **Roteiro:** ${g.trechos.map((t) => `${t.nome} × ${t.espectadores}${t.aquecimento ? ' (aquecimento, fora das conclusões)' : ''} (${t.fim - t.inicio} s)`).join(' → ')}.`,
      '- Quem já estava assistindo de verdade continua assistindo durante o teste e entra nas medidas de envio.',
    );
  } else {
    p(
      '- **Gravação da sala:** alguém da sala apertou Ctrl+Shift+G. A partir daí, cada PC da sala mede a cada segundo o que transmite (uma linha de envio por pessoa assistindo, `getStats` de cada `RTCPeerConnection` de envio) e o que assiste (uma linha de recepção por transmissão, com o ritmo na tela) e manda pelo WebSocket do servidor de sinalização só para quem grava (mensagem `medidas`; sem gravação, o servidor descarta). Ninguém precisa aceitar nada; a sala mostra o selo "Gravando estatísticas" (`web/src/desempenho/coletor.ts`, `gravadorDaSala.ts`).',
      '- Quem grava carimba o segundo `t` na chegada de cada pacote: entre PCs diferentes, o mesmo `t` pode estar até ~1 s fora.',
      '- Se a conexão de alguém com o servidor cai (ou o servidor reinicia, por exemplo num deploy), essa pessoa para de mandar medidas por alguns segundos e, ao voltar, o Ozamigos refaz todas as conexões de vídeo dela (`voltei` em `web/src/cliente.ts`): os acontecimentos marcam isso, e um trecho novo começa.',
      '- Cada transmissão é analisada à parte (uma seção por pessoa que transmitiu). Um trecho novo começa quando muda a qualidade de quem transmite, quantas pessoas assistem, ou quantas transmissões essa pessoa assiste ao mesmo tempo (assistir também decodifica vídeo no mesmo PC).',
      '- Quem assiste pode estar jogando com a janela do Ozamigos escondida: nesses segundos não há ritmo na tela (`tela_visivel` = 0, `ritmo_*` vazios) e valem as medidas até a decodificação.',
      '- Não é um teste controlado: o jogo, a cena e a rede mudam ao longo da gravação. Compare trechos com cuidado.',
    );
  }
  p(
    `- Os primeiros ${SEGUNDOS_DESCARTADOS} s de cada trecho ficam fora das médias (subida da estimativa de banda do WebRTC). As séries de cada segundo (CSV) têm todos os segundos.`,
    '- **Fluidez:** % dos intervalos entre quadros exibidos (requestVideoFrameCallback, `expectedDisplayTime`) até 1,5× o intervalo esperado. O esperado vem do fps do conteúdo = menor entre o fps da qualidade e o fps da captura (um jogo a 45 fps não é cobrado por 60). Contado por faixas de intervalo.',
    '- **Engasgo:** intervalo acima de 2× o esperado. **Congelamento:** o `freezeCount` do WebRTC (intervalo > 3× a média ou > 150 ms).',
    '- **Resultado do trecho:** ruim se fluidez < 90% ou fps na tela < 80% do conteúdo ou mais de 2 congelamentos; atenção se fluidez < 97%, fps < 93%, algum limite do codificador > 20% do tempo ou algum congelamento; bom se fluidez < 99% ou fps < 97%; senão ótimo.',
    '- **Uso da placa de vídeo:** contadores "GPU Engine" do Windows (os do Gerenciador de Tarefas). "Motor de vídeo" é o motor de codificação/decodificação mais ocupado (na AMD aparece como "Video Codec Engine", na NVIDIA como "VideoEncode"/"VideoDecode"). "Do jogo/outros" = processos que não são do Ozamigos.',
    '- **CPU app:** soma dos processos do Ozamigos em % do processador inteiro (todos os núcleos = 100%).',
    '',
  );
}

function glossario(p: Empurrar, titulo: string) {
  p(
    titulo,
    '',
    tabela(
      ['Coluna', 'O que é', 'De onde vem', 'Referência'],
      [
        ['t', 'segundos desde o início do teste (ou da gravação da sala)', '—', '—'],
        ['espectador / pessoa', 'quem assistia / de quem é a linha (na gravação da sala, os nomes da sala)', '—', '—'],
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
        ['ms_buffer_som', 'o mesmo para o som da transmissão (vazio sem som); a imagem espera o som para saírem juntos', 'inbound-rtp de áudio: jitterBufferDelay / jitterBufferEmittedCount', 'perto de ms_buffer ou abaixo'],
        ['folga_ms', 'a folga pedida no receptor de vídeo', 'RTCRtpReceiver.jitterBufferTarget (folga.ts)', '80–250'],
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
}

function acontecimentos(p: Empurrar, g: Gravacao, titulo: string) {
  let lista = g.acontecimentos;
  const nota: string[] = [];
  if (lista.length > ACONTECIMENTOS_MAXIMOS) {
    // Os repetitivos (um congelamento, uma travada) ficam com os primeiros de cada tipo; o resto vai inteiro.
    const porTipo = new Map<string, number>();
    for (const e of lista) porTipo.set(e.tipo, (porTipo.get(e.tipo) ?? 0) + 1);
    const repetitivos = [...porTipo.entries()].filter(([, n]) => n > 30).map(([tipo]) => tipo);
    const vistos = new Map<string, number>();
    lista = lista.filter((e) => {
      if (!repetitivos.includes(e.tipo)) return true;
      const n = (vistos.get(e.tipo) ?? 0) + 1;
      vistos.set(e.tipo, n);
      return n <= 30;
    });
    lista = lista.slice(0, ACONTECIMENTOS_MAXIMOS);
    nota.push(
      `_${g.acontecimentos.length} acontecimentos no total (${[...porTipo.entries()].map(([tipo, n]) => `${tipo}: ${n}`).join(', ')}); aqui, os primeiros 30 de cada tipo repetitivo. O JSON tem todos._`,
      '',
    );
  }
  p(titulo, '', ...nota, tabela(['t (s)', 'Tipo', 'O que aconteceu'], lista.map((e) => [e.t, e.tipo, e.texto])), '');
}

/**
 * Os segundos em que quem assistia sentiu mais (congelou, o pior intervalo entre quadros, menos fps), sem média,
 * com o que acontecia no mesmo segundo em quem transmitia: é onde se acha a causa.
 */
function pioresSegundos(p: Empurrar, g: Gravacao) {
  const gravidade = (r: AmostraRecepcao) => r.msCongelado * 10 + (r.ritmo?.maxMs ?? r.intervaloDesvioMs ?? 0) + r.descartados * 5;
  const piores = [...g.recepcao]
    .filter((r) => r.congelamentos > 0 || (r.ritmo?.maxMs ?? 0) > 50 || r.descartados > 0)
    .sort((a, b) => gravidade(b) - gravidade(a))
    .slice(0, PIORES_SEGUNDOS)
    .sort((a, b) => a.t - b.t);
  if (!piores.length) return;
  const trechoDe = (t: number) => g.trechos.findLast((tr) => t >= tr.inicio)?.indice ?? -1;
  // Na gravação da sala, cada PC chega com até ~1 s de diferença: vale o segundo mais próximo.
  const perto = <T extends { t: number }>(lista: T[], t: number, filtro: (x: T) => boolean = () => true) => {
    let melhor: T | undefined;
    for (const x of lista) if (Math.abs(x.t - t) <= 1 && filtro(x) && (!melhor || Math.abs(x.t - t) < Math.abs(melhor.t - t))) melhor = x;
    return melhor;
  };
  p(
    `**Os piores segundos** (até ${PIORES_SEGUNDOS}, sem média; colunas \`tx_\` = quem transmitia no mesmo segundo, \`pc_\` = o PC de quem transmitia):`,
    '',
    csv(
      ['t', 'trecho', 'espectador', 'fps_tela', 'ritmo_max', 'congel_ms', 'descartados', 'perda_pct', 'ms_decod', 'ms_buffer', 'tela_visivel', 'tarefas_longas', 'tx_fps_codif', 'tx_ms_codif', 'tx_limite', 'tx_q_chave', 'tx_plis', 'tx_rtt_ms', 'captura_fps', 'pc_cpu', 'pc_placa3d', 'pc_motor_video', 'pc_tarefas_longas'],
      piores.map((r) => {
        const e = perto(g.envio, r.t, (x) => x.espectador === r.espectador);
        const c = perto(g.captura, r.t);
        const q = perto(g.pcAmostras, r.t);
        const pg = perto(g.pagina, r.t);
        return [
          r.t,
          trechoDe(r.t) + 1,
          r.espectador,
          r.fpsExibidos,
          r.ritmo?.maxMs,
          r.msCongelado,
          r.descartados,
          r.perdaPct,
          r.msDecodificacao,
          r.msBuffer,
          r.janelaVisivel,
          r.tarefasLongas,
          e?.fpsCodificados,
          e?.msCodificacao,
          e?.limite,
          e?.quadrosChave,
          e?.plis,
          e?.rttMs,
          c?.fps,
          q?.cpuPc,
          q?.placa3dTotal,
          q?.placaVideoTotal,
          pg?.tarefasLongas,
        ];
      }),
    ),
    '',
  );
}

function series(p: Empurrar, g: Gravacao, titulo: string, c: Contexto) {
  p(titulo, '');
  const trechoDe = (t: number) => g.trechos.findLast((tr) => t >= tr.inicio)?.indice ?? -1;
  pioresSegundos(p, g);
  const envio = reduzir(g.envio, (l) => l.espectador, ['quadrosChave', 'plis', 'nacks'], c.linhas, ['msCodificacao']);
  p(
    `**Envio** (uma linha por espectador por ${envio.passo === 1 ? 'segundo' : `${envio.passo} s, médias`}; trecho = número da tabela de trechos, seção ${c.trechos}):`,
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
    g.recepcao.map((r) => ({ ...r, msBufferSom: r.msBufferSom ?? null, folgaMs: r.folgaMs ?? null, ritmoP99: r.ritmo?.p99Ms ?? null, ritmoMax: r.ritmo?.maxMs ?? null, recebTela: r.ritmo?.msRecebidoAteTela ?? null, capturaTela: r.ritmo?.msCapturaAteTela ?? null })),
    (l) => l.espectador,
    ['congelamentos', 'msCongelado', 'descartados', 'pacotesPerdidos', 'tarefasLongas'],
    c.linhas,
    ['ritmoP99', 'ritmoMax', 'msTarefaMaior'],
  );
  p(
    `**Recepção** (uma linha por espectador por ${recepcao.passo === 1 ? 'segundo' : `${recepcao.passo} s, médias`}):`,
    '',
    csv(
      ['t', 'trecho', 'espectador', 'altura', 'fps_receb', 'fps_decod', 'fps_tela', 'mbps', 'ms_decod', 'ms_buffer', 'ms_buffer_som', 'folga_ms', 'int_medio', 'int_desvio', 'ritmo_p99', 'ritmo_max', 'receb_tela', 'captura_tela', 'congel', 'ms_congel', 'descartados', 'perda_pct', 'jitter_ms', 'rtt_ms', 'tela_visivel', 'tarefas_longas'],
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
        l.msBufferSom,
        l.folgaMs,
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
    c.linhas,
    ['tarefaMaior', 'cpuApp'],
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
  );
}

export function relatorioParaIa(g: Gravacao, a: Analise): string {
  const partes: string[] = [];
  const p = (...linhas: string[]) => partes.push(...linhas);
  const c: Contexto = { sub: '###', regras: '6', trechos: '3', linhas: LINHAS_MAXIMAS };

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

  resumo(p, g, a, '## 1. Resumo');
  diagnosticos(p, a, '## 2. Diagnósticos (com as evidências)', c);
  trechos(p, g, a, '## 3. Trechos', c);
  ambiente(p, g, '## 4. Ambiente');
  configuracao(p, g, '## 5. Como esta versão do Ozamigos transmite');
  protocolo(p, g, '## 6. Como o teste foi feito');
  glossario(p, '## 7. Glossário das colunas das séries');
  acontecimentos(p, g, '## 8. Acontecimentos');
  series(p, g, '## 9. Séries de cada segundo', c);
  p(PARA_A_IA_FIM, '');
  return partes.join('\n');
}

const NOME_DO_RESULTADO = { otimo: 'ótimo', bom: 'bom', atencao: 'atenção', ruim: 'ruim' } as const;
const ORDEM_DOS_RESULTADOS = ['otimo', 'bom', 'atencao', 'ruim'] as const;

/**
 * O relatório da gravação da sala (Ctrl+Shift+G): a sala inteira na seção 1, uma seção por transmissão (com os
 * mesmos blocos do relatório do teste) e, no fim, o PC de cada pessoa, a configuração, as regras e o glossário.
 */
export function relatorioDaSalaParaIa(gs: GravacaoDaSala, as: AnaliseDaSala): string {
  const partes: string[] = [];
  const p = (...linhas: string[]) => partes.push(...linhas);
  const n = as.transmissoes.length;
  const secPc = n + 2;
  const secConfig = n + 3;
  const secRegras = n + 4;
  const secGlossario = n + 5;
  // As seções de configuração e de regras só leem estes campos.
  const daSala = { modo: 'sala', trechos: [], ajustes: gs.ajustes, qualidades: gs.qualidades } as unknown as Gravacao;
  // 3 tabelas de CSV por transmissão, mais a dos PCs: todas dividem o mesmo orçamento.
  const linhas = Math.max(60, Math.floor(LINHAS_DA_SALA / (3 * n + 1)));

  p(
    '# Ozamigos — estatísticas da sala',
    '',
    `<!-- formato: ${gs.formato} · ${gs.terminou ? 'gravação completa' : 'salvamento automático no meio da gravação'} · gerado em ${new Date().toISOString()} -->`,
    '',
    '> **Para a IA que vai ler isto.** O Ozamigos é um app (Electron + React + WebRTC) que transmite a tela de jogos entre amigos,',
    '> direto de um PC para o outro (malha P2P, sem servidor de mídia). Numa sala, várias pessoas podem transmitir e assistir ao mesmo',
    '> tempo. Este arquivo é a gravação das estatísticas de uma sala de verdade: cada PC mandou, a cada segundo, o que transmitia e o',
    '> que assistia. Os números vêm do `getStats()` do WebRTC, do `requestVideoFrameCallback` (ritmo real na tela) e dos contadores do',
    '> Windows (processador e motores da placa de vídeo). O que é estimativa está marcado como estimado.',
    '>',
    `> **Tarefa sugerida:** (1) em cada transmissão (seções 2${n > 1 ? ` a ${n + 1}` : ''}), confirme ou conteste os diagnósticos usando as`,
    '> evidências e as séries; (2) use a seção 1 para separar o que é de quem transmite, da internet ou do PC de quem assiste;',
    `> (3) proponha mudanças concretas no código do Ozamigos, citando arquivo e constante (pistas em "Onde mexer" e na seção ${secConfig});`,
    '> (4) diga qual número deste relatório deve melhorar e quanto, para validar a mudança numa gravação nova.',
    '',
  );

  // 1. A sala
  p('## 1. A sala', '', `**${as.resumo.titulo}.** ${as.resumo.texto}`, '');
  p(
    tabela(
      ['Medida', 'Valor'],
      [
        ['Sala', gs.sala],
        ['Gravado por', gs.gravadoPor],
        ['Início', gs.inicio],
        ['Duração', `${gs.duracao} s${gs.terminou ? '' : ' (salvamento automático: a gravação ainda não tinha terminado)'}`],
        ['Pessoas com medidas', gs.pessoas.map((x) => x.nome).join(', ')],
      ],
    ),
    '',
    '**Transmissões**',
    '',
    tabela(
      ['Quem transmite', 'Quem assistiu', 'Qualidades', 'Seg. analisados', 'Fluidez %', 'Pior trecho', 'Gargalo principal', 'Seção'],
      as.transmissoes.map(({ nome, a }, i) => {
        const validos = a.trechos.filter((t) => t.segundos > 0);
        const pior = validos.reduce(
          (x, t) => (ORDEM_DOS_RESULTADOS.indexOf(t.resultado) > ORDEM_DOS_RESULTADOS.indexOf(x) ? t.resultado : x),
          'otimo' as (typeof ORDEM_DOS_RESULTADOS)[number],
        );
        const comFluidez = validos.filter((t) => t.recepcao.fluidez != null);
        const pesos = comFluidez.reduce((s, t) => s + t.segundos, 0);
        const fluidezMedia = pesos ? comFluidez.reduce((s, t) => s + t.recepcao.fluidez! * t.segundos, 0) / pesos : null;
        return [
          nome,
          [...new Set(a.trechos.flatMap((t) => t.recepcao.porEspectador.map((e) => e.nome)))].join(', '),
          [...new Set(a.trechos.map((t) => t.trecho.qualidade))].join(', '),
          validos.reduce((s, t) => s + t.segundos, 0),
          fmt(fluidezMedia),
          validos.length ? NOME_DO_RESULTADO[pior] : 'sem dados',
          `${NOMES_DOS_GARGALOS[a.principal.gargalo] ?? a.principal.gargalo} (\`${a.principal.gargalo}\`)`,
          i + 2,
        ];
      }),
    ),
    '',
    '**Pessoas** (o PC de cada uma durante toda a gravação; "assistindo" = tudo que a pessoa assistiu)',
    '',
    tabela(
      ['Pessoa', 'Ozamigos', 'Placa de vídeo', 'Transmitiu s', 'Assistiu s', 'Assistiu quem', 'Fluidez assistindo %', 'Congel. assistindo', 'Decod. ms', 'CPU app %', 'CPU PC % (máx)', 'Placa 3D % (máx)', 'Motor de vídeo % (máx)', 'Janela visível %', 'Tarefas longas (maior ms)'],
      as.pessoas.map((x) => [
        x.nome,
        x.app,
        x.placa,
        x.transmitiu,
        x.assistiu,
        x.assistiuQuem.join(', '),
        fmt(x.fluidezAssistindo),
        x.congelamentosAssistindo,
        fmt(x.msDecodificacao),
        fmt(x.cpuApp),
        `${fmt(x.cpuPc)} (${fmt(x.cpuPcMax)})`,
        `${fmt(x.placa3d)} (${fmt(x.placa3dMax)})`,
        `${fmt(x.placaVideo)} (${fmt(x.placaVideoMax)})`,
        fmt(x.janelaVisivelPct, '', 0),
        `${x.tarefasLongas} (${x.msTarefaMaior})`,
      ]),
    ),
    '',
  );
  if (as.diagnosticos.length) {
    diagnosticos(p, { diagnosticos: as.diagnosticos } as Analise, '### Diagnósticos da sala inteira', { sub: '####', regras: String(secRegras), trechos: '', linhas });
  }
  p(
    '### Quem fazia o quê',
    '',
    'Uma linha a cada mudança (t em segundos desde o início da gravação).',
    '',
    tabela(
      ['t (s)', 'Pessoa', 'Transmite', 'Para quem', 'Assiste'],
      gs.papeis.slice(0, 200).map((x) => [x.t, x.pessoa, x.transmite ? `sim, ${x.qualidade}` : 'não', x.espectadores.join(', '), x.assiste.join(', ')]),
    ),
    '',
  );

  // 2..n+1. Cada transmissão, com os mesmos blocos do relatório do teste
  as.transmissoes.forEach(({ nome, g, a }, i) => {
    const s = i + 2;
    const c: Contexto = { sub: '####', regras: String(secRegras), trechos: `${s}.3`, linhas };
    const quem = g.espectadoresReais.map((e) => e.nome);
    p(`## ${s}. Transmissão de ${nome}`, '', `${nome} transmitiu ${g.fonte}. Quem assistiu: ${quem.join(', ') || 'ninguém'}.`, '');
    resumo(p, g, a, `### ${s}.1 Resumo`);
    diagnosticos(p, a, `### ${s}.2 Diagnósticos (com as evidências)`, c);
    trechos(p, g, a, `### ${s}.3 Trechos`, c);
    ambiente(p, g, `### ${s}.4 Ambiente de quem transmitiu e de quem assistiu`);
    acontecimentos(p, g, `### ${s}.5 Acontecimentos`);
    series(p, g, `### ${s}.6 Séries de cada segundo`, c);
  });

  // O PC de cada pessoa, segundo a segundo, com o que ela fazia
  const papelEm = (pessoa: string, t: number) => gs.papeis.findLast((x) => x.pessoa === pessoa && x.t <= t);
  const porChave = new Map<string, { t: number } & Record<string, unknown>>();
  const linha = (t: number, pessoa: string) => {
    const chave = `${t}|${pessoa}`;
    let atual = porChave.get(chave);
    if (!atual) {
      const papel = papelEm(pessoa, t);
      atual = { t, pessoa, transmite: papel?.transmite ? papel.qualidade : '', assiste: papel?.assiste.join(' ') ?? '' };
      porChave.set(chave, atual);
    }
    return atual;
  };
  for (const q of gs.pcAmostras) {
    Object.assign(linha(q.t, q.pessoa), {
      cpuApp: q.cpuApp,
      cpuPc: q.cpuPc,
      placa3d: q.placa3dTotal,
      placaVideo: q.placaVideoTotal,
      placa3dApp: q.placa3dApp,
      placaVideoApp: q.placaVideoApp,
      placa3dOutros: q.placa3dOutros,
      memPlaca: q.memoriaPlacaMB,
    });
  }
  for (const q of gs.pagina) Object.assign(linha(q.t, q.pessoa), { tarefas: q.tarefasLongas, tarefaMaior: q.msTarefaMaior, visivel: q.janelaVisivel });
  const pcs = reduzir(
    [...porChave.values()].sort((x, y) => x.t - y.t),
    (l) => String(l.pessoa),
    ['tarefas'],
    linhas,
    ['tarefaMaior'],
  );
  p(
    `## ${secPc}. O PC e a página de cada pessoa`,
    '',
    `Uma linha por pessoa por ${pcs.passo === 1 ? 'segundo' : `${pcs.passo} s (médias)`}. "transmite" = a qualidade, se transmitia; "assiste" = quem a pessoa assistia. Processador e placa de vídeo só no app para Windows (1.2.10 em diante).`,
    '',
    csv(
      ['t', 'pessoa', 'transmite', 'assiste', 'cpu_app', 'cpu_pc', 'placa3d_total', 'placa_video_total', 'placa3d_app', 'placa_video_app', 'placa3d_outros', 'mem_placa_mb', 'tarefas_longas', 'ms_tarefa_maior', 'tela_visivel'],
      pcs.linhas.map((l) => [l.t, l.pessoa, l.transmite, l.assiste, l.cpuApp, l.cpuPc, l.placa3d, l.placaVideo, l.placa3dApp, l.placaVideoApp, l.placa3dOutros, l.memPlaca, l.tarefas, l.tarefaMaior, l.visivel]),
    ),
    '',
  );

  configuracao(p, daSala, `## ${secConfig}. Como esta versão do Ozamigos transmite`);
  protocolo(p, daSala, `## ${secRegras}. Como a gravação foi feita (e as regras das conclusões)`);
  glossario(p, `## ${secGlossario}. Glossário das colunas das séries`);
  p(PARA_A_IA_FIM, '');
  return partes.join('\n');
}
