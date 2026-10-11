// ===== 1. Configuração e estado =====

// STUN: um servidor público que diz ao navegador qual é o seu endereço visto da internet.
const SERVIDORES_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

// O que cada opção de qualidade pede ao codificador de quem compartilha.
// Todas mudam ao vivo, sem refazer as conexões (setParameters).
// "preferencia" diz o que sacrificar quando faltar internet ou placa de vídeo:
// nas opções a 60 fps, a fluidez vale mais (baixa a resolução); nas a 30 fps, a nitidez pesa mais.
const QUALIDADES = {
  maxima: { altura: 1080, fps: 60, bitrate: 8_000_000, preferencia: 'maintain-framerate' },
  nitida: { altura: 1080, fps: 30, bitrate: 5_000_000, preferencia: 'balanced' },
  equilibrada: { altura: 720, fps: 60, bitrate: 5_000_000, preferencia: 'maintain-framerate' },
  leve: { altura: 720, fps: 30, bitrate: 3_000_000, preferencia: 'balanced' },
};

const estado = {
  ws: null,                  // conexão com o servidor de sinalização
  sala: null,                // código da sala
  meuId: null,               // id que o servidor me deu
  pessoas: new Map(),        // id -> nome das outras pessoas na sala
  compartilhando: new Set(), // ids de quem está compartilhando agora (inclusive eu)
  minhaTela: null,           // a MediaStream da minha tela, se eu estiver compartilhando
  // Com cada pessoa pode haver duas conexões, uma por sentido:
  // 'envio' leva a minha tela até ela; 'recebimento' traz a tela dela até mim.
  conexoes: new Map(),       // `${canal}:${id}` -> { pc, pendentes, canal, id }
  recusado: false,           // o servidor recusou a entrada (senha errada, sala cheia, código inválido)
};

const $ = (id) => document.getElementById(id);

// ===== 2. Código da sala e entrada =====

function codigoDaSala() {
  const daUrl = new URLSearchParams(location.search).get('sala');
  if (daUrl) return daUrl;
  // Sem código na URL: gera um aleatório e coloca na URL, para virar o link da sala.
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const aleatorios = crypto.getRandomValues(new Uint8Array(10));
  const codigo = Array.from(aleatorios, (n) => letras[n % letras.length]).join('');
  history.replaceState(null, '', `?sala=${codigo}`);
  return codigo;
}

// O navegador lembra o nome e a senha para a pessoa não digitar toda vez. Em aba anônima,
// ou com o armazenamento bloqueado, localStorage pode falhar: aí só não lembra.
function lembrado(chave) {
  try {
    return localStorage.getItem(chave) ?? '';
  } catch {
    return '';
  }
}

function lembrar(chave, valor) {
  try {
    if (valor) localStorage.setItem(chave, valor);
    else localStorage.removeItem(chave);
  } catch {
    // sem armazenamento: segue sem lembrar
  }
}

estado.sala = codigoDaSala();
$('codigo-sala').textContent = estado.sala;
$('link-sala').textContent = location.href;
$('nome').value = lembrado('ozamigos-nome');
$('senha').value = lembrado('ozamigos-senha');
$('entrada').onsubmit = (evento) => {
  evento.preventDefault(); // o formulário não recarrega a página: quem entra é o JavaScript
  entrar();
};
$('botao-copiar').onclick = () => navigator.clipboard.writeText(location.href);
$('botao-aplicativo').onclick = () => escolherFonte('aplicativo');
$('botao-tela').onclick = () => escolherFonte('tela');
$('botao-parar').onclick = () => pararDeCompartilhar(true);
$('qualidade').value = QUALIDADES[lembrado('ozamigos-qualidade')] ? lembrado('ozamigos-qualidade') : 'nitida';
$('qualidade').onchange = aplicarQualidade;

// ===== 3. Sinalização (WebSocket com o servidor Java) =====

function entrar() {
  $('botao-entrar').disabled = true; // dois cliques abririam duas conexões (uma "pessoa fantasma")
  estado.recusado = false;
  const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
  estado.ws = new WebSocket(`${protocolo}://${location.host}/sinal`);
  estado.ws.onopen = () =>
    enviar({ tipo: 'entrar', sala: estado.sala, senha: $('senha').value, nome: $('nome').value });
  estado.ws.onclose = () => {
    if (!estado.recusado) avisar('Conexão com o servidor perdida. Recarregue a página.');
  };

  // As mensagens são tratadas uma de cada vez, na ordem em que chegaram.
  let fila = Promise.resolve();
  estado.ws.onmessage = (evento) => {
    const msg = JSON.parse(evento.data);
    fila = fila.then(() => tratar(msg)).catch((erro) => console.error('Erro ao tratar', msg, erro));
  };
}

function enviar(msg) {
  estado.ws.send(JSON.stringify(msg));
}

// Um "estou aqui" a cada 30 s: sem isso, proxies e hospedagens gratuitas fecham a conexão parada.
setInterval(() => {
  if (estado.ws?.readyState === WebSocket.OPEN && estado.meuId) enviar({ tipo: 'ping' });
}, 30_000);

async function tratar(msg) {
  switch (msg.tipo) {
    case 'bem-vindo':
      estado.meuId = msg.id;
      msg.outros.forEach(({ id, nome }) => estado.pessoas.set(id, nome));
      msg.compartilhando.forEach((id) => estado.compartilhando.add(id));
      lembrar('ozamigos-nome', $('nome').value);
      lembrar('ozamigos-senha', $('senha').value);
      avisar('');
      $('entrada').hidden = true;
      $('sala').hidden = false;
      break;
    case 'entrou':
      estado.pessoas.set(msg.id, msg.nome);
      // Se eu estou compartilhando, quem chegou também precisa receber a minha tela.
      if (estado.minhaTela) await enviarOferta(msg.id);
      break;
    case 'saiu':
      estado.pessoas.delete(msg.id);
      estado.compartilhando.delete(msg.id);
      fecharConexao('envio', msg.id);
      fecharConexao('recebimento', msg.id);
      break;
    case 'pode-compartilhar':
      if (!estado.minhaTela) break; // parei antes de o servidor responder
      estado.compartilhando.add(estado.meuId);
      for (const id of estado.pessoas.keys()) await enviarOferta(id);
      break;
    case 'compartilhando':
      estado.compartilhando.add(msg.id);
      break;
    case 'parou':
      estado.compartilhando.delete(msg.id);
      fecharConexao('recebimento', msg.id);
      break;
    case 'oferta':
      await receberOferta(msg.de, msg.sdp);
      break;
    case 'resposta':
      await receberResposta(msg.de, msg.sdp);
      break;
    case 'candidato':
      // O canal vem do ponto de vista de quem mandou: o "envio" dele é o meu "recebimento".
      await receberCandidato(msg.de, msg.canal === 'envio' ? 'recebimento' : 'envio', msg.candidato);
      break;
    case 'erro':
      tratarErro(msg.motivo);
      break;
  }
  atualizarTela();
}

function tratarErro(motivo) {
  const textos = {
    'senha-errada': 'Senha errada. Confira com quem mandou o link.',
    'sala-cheia': 'A sala está cheia (máximo de 3 pessoas).',
  };
  avisar(textos[motivo] ?? `Erro: ${motivo}`);
  if (motivo === 'sala-cheia' || motivo === 'codigo-invalido') estado.recusado = true;
  if (motivo === 'senha-errada') {
    estado.recusado = true;
    lembrar('ozamigos-senha', ''); // esquece a senha antiga (ela pode ter mudado)
    $('senha').select();
    $('botao-entrar').disabled = false; // pode tentar de novo
  }
}

// ===== 4. Compartilhar a minha tela =====

// O que cada botão pede ao navegador. A escolha final (qual janela, qual monitor) é sempre
// da pessoa, no seletor do navegador: por segurança, a página não pode listar as janelas abertas.
const FONTES = {
  aplicativo: { displaySurface: 'window', monitorTypeSurfaces: 'exclude' },
  tela: { displaySurface: 'monitor', monitorTypeSurfaces: 'include' },
};

async function capturar(fonte) {
  try {
    // Precisa ser chamado direto no clique: o navegador exige um gesto do usuário.
    return await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: FONTES[fonte].displaySurface, // abre o seletor já na aba certa
        width: { max: 1920 },
        height: { max: 1080 },
        frameRate: { ideal: QUALIDADES[$('qualidade').value].fps, max: QUALIDADES[$('qualidade').value].fps },
      },
      audio: true,                                    // áudio, se a pessoa marcar a opção
      monitorTypeSurfaces: FONTES[fonte].monitorTypeSurfaces,
      selfBrowserSurface: 'exclude',                  // não oferecer a própria aba do Ozamigos Share
      systemAudio: 'include',
    });
  } catch {
    return null; // a pessoa cancelou o seletor
  }
}

async function escolherFonte(fonte) {
  const tela = await capturar(fonte);
  if (!tela) return;
  if (estado.minhaTela) {
    await trocarFonte(tela);
  } else {
    usarTela(tela);
    enviar({ tipo: 'comecei' });
  }
  atualizarTela();
}

function usarTela(tela) {
  estado.minhaTela = tela;
  const [video] = tela.getVideoTracks();
  video.contentHint = 'motion'; // jogo: priorizar movimento fluido em vez de nitidez de texto
  video.onended = () => pararDeCompartilhar(true); // botão "Parar compartilhamento" do Chrome
  videoDe(estado.meuId).srcObject = tela; // a prévia, sem som (o bloco "Sua tela" já nasce mudo)
}

// Troca o que está sendo compartilhado sem refazer as conexões:
// replaceTrack põe a trilha nova no lugar da antiga, dentro da conexão que já existe.
async function trocarFonte(nova) {
  const antiga = estado.minhaTela;
  usarTela(nova);
  const [video] = nova.getVideoTracks();
  const [audio] = nova.getAudioTracks();
  for (const { pc, canal } of estado.conexoes.values()) {
    if (canal !== 'envio') continue;
    for (const transceptor of pc.getTransceivers()) {
      const tipo = transceptor.receiver.track.kind;
      await transceptor.sender.replaceTrack(tipo === 'video' ? video : audio ?? null);
    }
  }
  antiga.getVideoTracks()[0].onended = null; // parar a antiga não pode encerrar o compartilhamento
  antiga.getTracks().forEach((trilha) => trilha.stop());
  await aplicarQualidade(); // a fonte nova pode ter outro tamanho
}

function pararDeCompartilhar(avisarServidor) {
  if (!estado.minhaTela) return;
  estado.minhaTela.getTracks().forEach((trilha) => trilha.stop());
  estado.minhaTela = null;
  for (const { canal, id } of [...estado.conexoes.values()]) {
    if (canal === 'envio') fecharConexao(canal, id);
  }
  removerBloco(estado.meuId);
  estado.compartilhando.delete(estado.meuId);
  if (avisarServidor) enviar({ tipo: 'parei' });
  atualizarTela();
}

// Os parâmetros do codificador para a qualidade escolhida. A escala é calculada pela altura
// real da captura: uma tela 1080p em "720p" é reduzida 1,5 vez; uma captura já pequena não é reduzida.
function codificacao() {
  const qualidade = QUALIDADES[$('qualidade').value];
  const alturaCapturada = estado.minhaTela?.getVideoTracks()[0].getSettings().height ?? 1080;
  return {
    maxBitrate: qualidade.bitrate,
    maxFramerate: qualidade.fps,
    scaleResolutionDownBy: Math.max(1, alturaCapturada / qualidade.altura),
  };
}

async function aplicarQualidade() {
  lembrar('ozamigos-qualidade', $('qualidade').value);
  // A captura acompanha o fps escolhido: a 30 fps, o navegador copia a tela metade das vezes.
  const [trilha] = estado.minhaTela?.getVideoTracks() ?? [];
  if (trilha) {
    const fps = QUALIDADES[$('qualidade').value].fps;
    try {
      await trilha.applyConstraints({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: fps, max: fps } });
    } catch (erro) {
      console.warn('Não foi possível mudar o fps da captura', erro);
    }
  }
  for (const { pc, canal } of estado.conexoes.values()) {
    if (canal !== 'envio') continue;
    const remetente = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!remetente) continue;
    const parametros = remetente.getParameters();
    if (!parametros.encodings?.length) continue; // ainda negociando: a oferta já sai com a qualidade nova
    Object.assign(parametros.encodings[0], codificacao());
    parametros.degradationPreference = QUALIDADES[$('qualidade').value].preferencia;
    try {
      await remetente.setParameters(parametros);
    } catch (erro) {
      console.warn('Não foi possível mudar a qualidade', erro);
    }
  }
}

// ===== 5. Conexões WebRTC =====

const chave = (canal, id) => `${canal}:${id}`;

function novaConexao(canal, idRemoto) {
  const pc = new RTCPeerConnection({ iceServers: SERVIDORES_ICE });
  const conexao = { pc, pendentes: [], canal, id: idRemoto };
  estado.conexoes.set(chave(canal, idRemoto), conexao);

  // Cada caminho de rede descoberto (candidato ICE) vai para o outro lado pelo servidor,
  // dizendo de qual das duas conexões ele é.
  pc.onicecandidate = (evento) => {
    if (evento.candidate) enviar({ tipo: 'candidato', para: idRemoto, canal, candidato: evento.candidate });
  };
  pc.onconnectionstatechange = () => {
    console.log(`Conexão de ${canal} com ${idRemoto}: ${pc.connectionState}`);
    if (pc.connectionState === 'failed') {
      avisar(`Não foi possível conectar direto com ${nomeDe(idRemoto)}. Algumas redes exigem um servidor TURN.`);
    }
  };
  return conexao;
}

function fecharConexao(canal, idRemoto) {
  const conexao = estado.conexoes.get(chave(canal, idRemoto));
  if (!conexao) return;
  conexao.pc.close();
  estado.conexoes.delete(chave(canal, idRemoto));
  if (canal === 'recebimento') removerBloco(idRemoto);
}

// Lado de quem compartilha: uma conexão de envio (e uma oferta) para cada pessoa.
async function enviarOferta(idEspectador) {
  fecharConexao('envio', idEspectador);
  const { pc } = novaConexao('envio', idEspectador);
  const [video] = estado.minhaTela.getVideoTracks();
  const transceptor = pc.addTransceiver(video, {
    direction: 'sendonly',
    streams: [estado.minhaTela],
    sendEncodings: [codificacao()],
  });
  preferirH264(transceptor);
  // Sempre cria o canal de áudio, mesmo sem áudio agora: assim a troca de fonte não precisa renegociar.
  const [audio] = estado.minhaTela.getAudioTracks();
  pc.addTransceiver(audio ?? 'audio', { direction: 'sendonly', streams: [estado.minhaTela] });
  await pc.setLocalDescription(await pc.createOffer());
  enviar({ tipo: 'oferta', para: idEspectador, sdp: pc.localDescription });
}

// H.264 é o codec que quase toda placa de vídeo codifica em hardware.
function preferirH264(transceptor) {
  if (!transceptor.setCodecPreferences) return;
  const codecs = RTCRtpReceiver.getCapabilities('video').codecs;
  const h264 = codecs.filter((c) => c.mimeType === 'video/H264');
  if (h264.length === 0) return;
  transceptor.setCodecPreferences([...h264, ...codecs.filter((c) => c.mimeType !== 'video/H264')]);
}

async function receberResposta(idEspectador, sdp) {
  const conexao = estado.conexoes.get(chave('envio', idEspectador));
  if (!conexao) return;
  await conexao.pc.setRemoteDescription(sdp);
  await aplicarCandidatosPendentes(conexao);
  // Se a rede ou o PC apertarem, o que sacrificar depende da qualidade escolhida (veja QUALIDADES).
  const remetente = conexao.pc.getSenders().find((s) => s.track?.kind === 'video');
  const parametros = remetente.getParameters();
  parametros.degradationPreference = QUALIDADES[$('qualidade').value].preferencia;
  try {
    await remetente.setParameters(parametros);
  } catch (erro) {
    console.warn('O navegador não aceitou degradationPreference', erro);
  }
}

// Lado de quem assiste: responde à oferta e mostra o vídeo no bloco de quem compartilha.
async function receberOferta(idCompartilhador, sdp) {
  fecharConexao('recebimento', idCompartilhador);
  const conexao = novaConexao('recebimento', idCompartilhador);
  const video = videoDe(idCompartilhador);
  conexao.pc.ontrack = (evento) => {
    video.srcObject = evento.streams[0];
  };
  await conexao.pc.setRemoteDescription(sdp);
  await aplicarCandidatosPendentes(conexao);
  await conexao.pc.setLocalDescription(await conexao.pc.createAnswer());
  enviar({ tipo: 'resposta', para: idCompartilhador, sdp: conexao.pc.localDescription });
}

// Um candidato pode chegar antes da oferta ou da resposta: guarda e aplica depois.
async function receberCandidato(idRemoto, canal, candidato) {
  const conexao = estado.conexoes.get(chave(canal, idRemoto));
  if (!conexao) return;
  if (conexao.pc.remoteDescription) {
    await conexao.pc.addIceCandidate(candidato);
  } else {
    conexao.pendentes.push(candidato);
  }
}

async function aplicarCandidatosPendentes(conexao) {
  for (const candidato of conexao.pendentes) await conexao.pc.addIceCandidate(candidato);
  conexao.pendentes = [];
}

// ===== 6. Tela =====

function nomeDe(id) {
  return id === estado.meuId ? 'você' : estado.pessoas.get(id) ?? 'Amigo';
}

// Um bloco por tela: a minha (prévia, sem som) e a de cada pessoa que está compartilhando.
function videoDe(id) {
  const existente = $(`bloco-${id}`);
  if (existente) return existente.querySelector('video');

  const minha = id === estado.meuId;
  const bloco = document.createElement('figure');
  bloco.id = `bloco-${id}`;
  bloco.className = minha ? 'bloco minha' : 'bloco';
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = minha; // não tocar o meu próprio áudio de volta

  const legenda = document.createElement('figcaption');
  const titulo = document.createElement('span');
  titulo.textContent = minha ? 'Sua tela' : `Tela de ${nomeDe(id)}`; // textContent: nome nunca vira HTML
  legenda.append(titulo);
  if (!minha) {
    const som = document.createElement('button');
    som.textContent = 'Silenciar';
    som.onclick = () => {
      video.muted = !video.muted;
      som.textContent = video.muted ? 'Ativar som' : 'Silenciar';
    };
    legenda.append(som);
  }
  const telaCheia = document.createElement('button');
  telaCheia.textContent = 'Tela cheia';
  telaCheia.onclick = () => video.requestFullscreen();
  legenda.append(telaCheia);

  bloco.append(video, legenda);
  if (minha) $('videos').prepend(bloco);
  else $('videos').append(bloco);
  return video;
}

function removerBloco(id) {
  $(`bloco-${id}`)?.remove();
}

function atualizarTela() {
  const total = estado.pessoas.size + 1;
  const nomes = ['você', ...estado.pessoas.values()].join(', ');
  $('pessoas').textContent = `${total} ${total === 1 ? 'pessoa' : 'pessoas'} na sala: ${nomes}`;
  const euCompartilho = estado.minhaTela !== null;
  const podeCapturar = Boolean(navigator.mediaDevices?.getDisplayMedia);
  for (const id of ['botao-aplicativo', 'botao-tela']) {
    $(id).disabled = !podeCapturar;
    $(id).title = podeCapturar ? '' : 'Para compartilhar, use Chrome ou Edge no computador, por HTTPS ou localhost';
  }
  $('botao-aplicativo').textContent = euCompartilho ? 'Trocar para um aplicativo' : 'Compartilhar um aplicativo';
  $('botao-tela').textContent = euCompartilho ? 'Trocar para a tela inteira' : 'Compartilhar a tela inteira';
  $('botao-parar').hidden = !euCompartilho;
  $('fonte').textContent = euCompartilho ? descreverFonte() : '';
}

function descreverFonte() {
  const { displaySurface } = estado.minhaTela.getVideoTracks()[0].getSettings();
  const nomes = { window: 'um aplicativo', monitor: 'a tela inteira', browser: 'uma aba do navegador' };
  const audio = estado.minhaTela.getAudioTracks().length > 0 ? 'com' : 'sem';
  const chromium = Boolean(navigator.userAgentData?.brands?.some((b) => b.brand === 'Chromium'));
  const aviso = chromium ? '' : ' Para o melhor desempenho ao compartilhar, use o Chrome ou o Edge (este app foi feito e medido neles).';
  return `Você está compartilhando ${nomes[displaySurface] ?? 'a sua tela'}, ${audio} áudio.${aviso}`;
}

function avisar(texto) {
  $('aviso').textContent = texto;
}

// ===== 7. Estatísticas: a prova dos 60 fps, e o porquê quando não chega lá =====

const anteriores = new Map(); // conexão + id do relatório -> { bytes, momento }

const MOTIVOS = {
  none: 'nenhum',
  cpu: 'PROCESSADOR/PLACA DE VÍDEO no limite (limite o fps do jogo ou baixe a qualidade)',
  bandwidth: 'INTERNET no limite (baixe a qualidade)',
  other: 'outro',
};

const REDES = { host: 'mesma rede', srflx: 'pela internet', prflx: 'pela internet', relay: 'por servidor TURN' };

function mbpsDesde(chaveDoRelatorio, bytes, momento) {
  const anterior = anteriores.get(chaveDoRelatorio);
  anteriores.set(chaveDoRelatorio, { bytes, momento });
  return anterior ? ((bytes - anterior.bytes) * 8) / ((momento - anterior.momento) * 1000) : 0;
}

setInterval(async () => {
  const linhas = [];
  for (const [chaveDaConexao, { pc, id, canal }] of estado.conexoes) {
    const relatorio = await pc.getStats();
    let rede = '';
    relatorio.forEach((r) => {
      // Chrome e Edge apontam o par de candidatos escolhido no relatório "transport"; o Firefox marca o par com selected.
      let par = null;
      if (r.type === 'transport' && r.selectedCandidatePairId) par = relatorio.get(r.selectedCandidatePairId);
      if (r.type === 'candidate-pair' && r.selected) par = r;
      if (!par) return;
      const remoto = relatorio.get(par.remoteCandidateId);
      rede = `rede: ${REDES[remoto?.candidateType] ?? '?'} · ida e volta ${Math.round((par.currentRoundTripTime ?? 0) * 1000)} ms`;
      if (canal === 'envio' && par.availableOutgoingBitrate) {
        rede += ` · banda estimada ${(par.availableOutgoingBitrate / 1e6).toFixed(1)} Mbps`;
      }
    });
    relatorio.forEach((r) => {
      if (r.kind !== 'video' || (r.type !== 'outbound-rtp' && r.type !== 'inbound-rtp')) return;
      const enviando = r.type === 'outbound-rtp';
      const mbps = mbpsDesde(`${chaveDaConexao}:${r.type}:${r.ssrc}`, enviando ? r.bytesSent : r.bytesReceived, r.timestamp);
      const codec = relatorio.get(r.codecId)?.mimeType ?? '?';
      let linha = `${enviando ? 'enviando para' : 'recebendo de'} ${nomeDe(id)}: ` +
        `${r.framesPerSecond ?? 0} fps · ${r.frameWidth ?? '?'}x${r.frameHeight ?? '?'} · ` +
        `${mbps.toFixed(1)} Mbps · ${codec}`;
      if (enviando) {
        // A captura vem antes do codificador: se ela já está baixa, o problema é o jogo/placa de vídeo, não a rede.
        const captura = relatorio.get(r.mediaSourceId)?.framesPerSecond;
        linha += `\n    captura: ${captura ?? '?'} fps · codificador: ${r.encoderImplementation ?? '?'}` +
          ` · limite: ${MOTIVOS[r.qualityLimitationReason] ?? r.qualityLimitationReason ?? '? (o Firefox não informa)'}`;
      } else {
        linha += ` · congelamentos: ${r.freezeCount ?? 0} · quadros perdidos: ${r.framesDropped ?? 0}`;
      }
      if (rede) linha += `\n    ${rede}`;
      linhas.push(linha);
    });
  }
  if (linhas.length === 0 && estado.minhaTela) {
    linhas.push('Ninguém está assistindo: as estatísticas aparecem quando outra pessoa entrar na sala.\n' +
      'Para testar sozinho, abra o link da sala em outro navegador ou no celular.');
  }
  $('estatisticas').textContent = linhas.join('\n');
}, 1000);
