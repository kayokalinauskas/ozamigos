// O caminho principal do app, com navegadores de verdade: entrar, transmitir, assistir, falar e sair.
// Cada pessoa é um contexto separado do navegador (como dois PCs), com microfone falso e um "jogo" desenhado.
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

/** Roda na página antes do app: o jogo falso no lugar da captura de tela e um analisador na saída de som. */
function prepararPagina() {
  // Microfone sem porta: o bipe do microfone falso não é voz, e a sensibilidade automática o seguraria.
  localStorage.setItem('ozamigos-voz', JSON.stringify({ sensibilidadeAutomatica: false, limiarDb: -100 }));

  // Escuta a voz que vai para a caixa de som: o que sai do limitador também passa por um analisador.
  const analisadores: AnalyserNode[] = [];
  (window as unknown as { __analisadores: AnalyserNode[] }).__analisadores = analisadores;
  const ligar = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown;
  AudioNode.prototype.connect = function (this: AudioNode, destino: unknown, ...resto: unknown[]) {
    // Só o limitador, o fim da cadeia da voz (os sons de aviso do app também vão para a saída).
    if (destino instanceof AudioDestinationNode && this instanceof WaveShaperNode) {
      const a = this.context.createAnalyser();
      ligar.call(this, a);
      analisadores.push(a);
    }
    return ligar.call(this, destino, ...resto);
  } as typeof AudioNode.prototype.connect;

  // Uma trava de tela falsa, que só anota se está segura (a de verdade depende do navegador e da bateria).
  const tela = { segura: false };
  (window as unknown as { __tela: typeof tela }).__tela = tela;
  Object.defineProperty(navigator, 'wakeLock', {
    value: {
      request: async () => {
        tela.segura = true;
        const ouvintes: (() => void)[] = [];
        return {
          get released() {
            return !tela.segura;
          },
          release: async () => {
            tela.segura = false;
            ouvintes.forEach((ouvinte) => ouvinte());
          },
          addEventListener: (_tipo: string, ouvinte: () => void) => ouvintes.push(ouvinte),
        };
      },
    },
  });

  // Guarda as ofertas que chegam, para conferir como a transmissão foi montada.
  const ofertas: string[] = [];
  (window as unknown as { __ofertas: string[] }).__ofertas = ofertas;
  const aplicar = RTCPeerConnection.prototype.setRemoteDescription;
  RTCPeerConnection.prototype.setRemoteDescription = function (this: RTCPeerConnection, descricao?: RTCSessionDescriptionInit) {
    if (descricao?.type === 'offer' && descricao.sdp) ofertas.push(descricao.sdp);
    return aplicar.call(this, descricao as RTCSessionDescriptionInit);
  } as typeof RTCPeerConnection.prototype.setRemoteDescription;

  navigator.mediaDevices.getDisplayMedia = async () => {
    const tela = document.createElement('canvas');
    tela.width = 640;
    tela.height = 360;
    const g = tela.getContext('2d')!;
    let quadro = 0;
    setInterval(() => {
      g.fillStyle = `hsl(${(quadro++ * 6) % 360} 70% 45%)`;
      g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#fff';
      g.fillRect((quadro * 8) % 640, 150, 60, 60);
    }, 1000 / 30);
    return tela.captureStream(30);
  };
}

async function entrarNaSala(browser: Browser, sala: string, nome: string, senha = 'teste', opcoes: BrowserContextOptions = {}): Promise<Page> {
  const contexto = await browser.newContext(opcoes);
  const pagina = await contexto.newPage();
  await pagina.addInitScript(prepararPagina);
  await pagina.goto(`/?sala=${sala}`);
  await pagina.getByLabel('Seu nome').fill(nome);
  await pagina.getByLabel('Senha do grupo').fill(senha);
  await pagina.getByRole('button', { name: 'Entrar na sala' }).click();
  return pagina;
}

const novaSala = () => `e2e${Math.random().toString(36).slice(2, 10)}`;

/** O volume mais alto (RMS) que chega à caixa de som da página em `ms` milissegundos. */
const volumeNaSaida = (pagina: Page, ms = 1500) =>
  pagina.evaluate(async (ms) => {
    const analisadores = (window as unknown as { __analisadores: AnalyserNode[] }).__analisadores;
    const amostras = new Float32Array(2048);
    let maior = 0;
    for (const fim = Date.now() + ms; Date.now() < fim; await new Promise((r) => setTimeout(r, 50))) {
      for (const a of analisadores) {
        a.getFloatTimeDomainData(amostras);
        let soma = 0;
        for (const x of amostras) soma += x * x;
        maior = Math.max(maior, Math.sqrt(soma / amostras.length));
      }
    }
    return maior;
  }, ms);

test('senha errada não entra e explica o motivo', async ({ browser }) => {
  const pagina = await entrarNaSala(browser, novaSala(), 'Intruso', 'chute');

  await expect(pagina.getByRole('alert')).toContainText('Senha errada');
  await expect(pagina.getByRole('button', { name: 'Sair da sala' })).toHaveCount(0);
});

test('a transmissão de uma pessoa chega em movimento para quem assiste', async ({ browser }) => {
  const sala = novaSala();
  const ana = await entrarNaSala(browser, sala, 'Ana');
  const beto = await entrarNaSala(browser, sala, 'Beto');

  await ana.getByRole('button', { name: 'Transmitir' }).click();
  await ana.getByRole('menuitem', { name: /A tela inteira/ }).click();
  const assistir = beto.getByRole('button', { name: 'Assistir Ana' });
  await expect(beto.getByRole('button', { name: /Assistir Ana|Parar de assistir Ana/ })).toBeVisible();
  if (await assistir.isVisible()) await assistir.click();

  // Um vídeo com imagem e quadros novos chegando (não uma imagem parada).
  await expect
    .poll(
      () =>
        beto.evaluate(async () => {
          const video = [...document.querySelectorAll('video')].find((v) => v.videoWidth > 0);
          if (!video) return 0;
          let quadros = 0;
          const contar = () => {
            quadros++;
            video.requestVideoFrameCallback(contar);
          };
          video.requestVideoFrameCallback(contar);
          await new Promise((r) => setTimeout(r, 1000));
          return quadros;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(10);

  // O som da transmissão vem num MediaStream separado do vídeo, para o navegador de quem assiste não segurar a imagem
  // esperando o som; o <video> recebe os dois juntos mesmo assim.
  const montagem = await beto.evaluate(() => {
    const oferta = (window as unknown as { __ofertas: string[] }).__ofertas.find((sdp) => sdp.includes('m=video')) ?? '';
    const msid = (tipo: string) => oferta.split('\r\nm=').find((secao) => secao.startsWith(tipo))?.match(/a=msid:(\S+)/)?.[1] ?? '-';
    const video = [...document.querySelectorAll('video')].find((v) => v.videoWidth > 0);
    const faixas = (video?.srcObject as MediaStream | null)?.getTracks().map((faixa) => faixa.kind).sort();
    return { streamDoVideo: msid('video'), streamDoSom: msid('audio'), faixas };
  });
  expect(montagem.streamDoVideo).not.toBe('-');
  expect(montagem.streamDoSom).not.toBe(montagem.streamDoVideo);
  expect(montagem.faixas).toEqual(['audio', 'video']);
});

test('a voz chega, o microfone desligado silencia e quem sai some da sala', async ({ browser }) => {
  const sala = novaSala();
  const ana = await entrarNaSala(browser, sala, 'Ana');
  const beto = await entrarNaSala(browser, sala, 'Beto');

  await expect.poll(() => volumeNaSaida(beto), { timeout: 30_000 }).toBeGreaterThan(0.01); // o bipe da Ana

  await ana.getByRole('button', { name: 'Desligar o microfone' }).click();
  await beto.waitForTimeout(1000); // o que já estava a caminho termina de chegar
  expect(await volumeNaSaida(beto)).toBeLessThan(0.001);

  await expect(beto.getByLabel('Sala e pessoas')).toContainText('Ana');
  await ana.getByRole('button', { name: 'Sair da sala' }).click();
  await expect(beto.getByLabel('Sala e pessoas')).not.toContainText('Ana');
});

test('a mensagem do chat chega, conta como nova para quem está com o chat fechado, e quem chega depois não vê a antiga', async ({ browser }) => {
  const sala = novaSala();
  const ana = await entrarNaSala(browser, sala, 'Ana');
  const beto = await entrarNaSala(browser, sala, 'Beto');
  await expect(ana.getByLabel('Sala e pessoas')).toContainText('Beto');

  await ana.getByRole('button', { name: 'Chat' }).click();
  await ana.getByLabel('Mensagem para a sala').fill('bora jogar?');
  await ana.getByLabel('Mensagem para a sala').press('Enter');

  await expect(ana.getByLabel('Chat da sala')).toContainText('bora jogar?'); // voltou do servidor: chegou
  await expect(beto.getByRole('button', { name: 'Chat, 1 mensagem nova' })).toBeVisible();
  await beto.getByRole('button', { name: /^Chat/ }).click();
  await expect(beto.getByLabel('Chat da sala')).toContainText('Ana');
  await expect(beto.getByLabel('Chat da sala')).toContainText('bora jogar?');

  const caio = await entrarNaSala(browser, sala, 'Caio');
  await caio.getByRole('button', { name: 'Chat' }).click();
  await expect(caio.getByLabel('Chat da sala')).toContainText('Nenhuma mensagem ainda');
});

test('no celular, nada passa da largura da tela (sem rolagem de lado), com o chat fechado ou aberto', async ({ browser }) => {
  const celular = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
  const pagina = await entrarNaSala(browser, novaSala(), 'Kayo', 'teste', celular);
  await expect(pagina.getByRole('button', { name: 'Sair da sala' })).toBeVisible();

  const larguras = () => pagina.evaluate(() => ({ pagina: document.documentElement.scrollWidth, tela: innerWidth }));
  expect(await larguras()).toEqual({ pagina: 375, tela: 375 });

  await pagina.getByRole('button', { name: 'Chat' }).click();
  await expect(pagina.getByLabel('Chat da sala')).toBeVisible();
  expect(await larguras()).toEqual({ pagina: 375, tela: 375 });
});

test('com mais alguém na sala a tela não apaga, e sozinho volta a poder apagar', async ({ browser }) => {
  const sala = novaSala();
  const telaSegura = (pagina: Page) => pagina.evaluate(() => (window as unknown as { __tela: { segura: boolean } }).__tela.segura);
  const ana = await entrarNaSala(browser, sala, 'Ana');
  await expect(ana.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
  expect(await telaSegura(ana)).toBe(false); // sozinha: nada a manter

  const beto = await entrarNaSala(browser, sala, 'Beto');
  await expect.poll(() => telaSegura(ana)).toBe(true);
  await expect.poll(() => telaSegura(beto)).toBe(true);

  await beto.getByRole('button', { name: 'Sair da sala' }).click();
  await expect.poll(() => telaSegura(ana)).toBe(false);
});
