// O caminho principal do app, com navegadores de verdade: entrar, transmitir, assistir, falar e sair.
// Cada pessoa é um contexto separado do navegador (como dois PCs), logada (conta.ts), com microfone falso e um "jogo"
// desenhado.
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { entrarNaSala as entrarComConta, novaSala, type Sala } from './conta';

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

  // Guarda as conexões criadas, para medir o que cada uma manda e recebe.
  const conexoes: RTCPeerConnection[] = [];
  (window as unknown as { __conexoes: RTCPeerConnection[] }).__conexoes = conexoes;
  const Original = RTCPeerConnection;
  window.RTCPeerConnection = class extends Original {
    constructor(...argumentos: ConstructorParameters<typeof RTCPeerConnection>) {
      super(...argumentos);
      conexoes.push(this);
    }
  };

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

/**
 * Uma pessoa logada, na sala (o servidor salvo do teste: conta.ts), com o jogo falso e os medidores na página; `extras`
 * rodam na página depois deles.
 */
const entrarNaSala = (browser: Browser, sala: Sala, nome: string, opcoes: BrowserContextOptions = {}, ...extras: (() => void)[]): Promise<Page> =>
  entrarComConta(browser, sala, nome, opcoes, [prepararPagina, ...extras]);

/** Os bytes de vídeo que saem (ou chegam) por cada conexão aberta da página: quantas conexões levam vídeo, e quanto. */
const video = (pagina: Page, sentido: 'outbound-rtp' | 'inbound-rtp') =>
  pagina.evaluate(async (sentido) => {
    let conexoes = 0;
    let bytes = 0;
    for (const pc of (window as unknown as { __conexoes: RTCPeerConnection[] }).__conexoes) {
      if (pc.connectionState === 'closed') continue;
      let destaConexao = 0;
      (await pc.getStats()).forEach((r) => {
        if (r.type === sentido && r.kind === 'video') destaConexao += sentido === 'outbound-rtp' ? r.bytesSent : r.bytesReceived;
      });
      if (destaConexao > 0) conexoes++;
      bytes += destaConexao;
    }
    return { conexoes, bytes };
  }, sentido);

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

test('chamar a atenção toca para o amigo mesmo com o som e os sons de aviso desligados, até 5 vezes por minuto', async ({ browser }) => {
  const sala = novaSala();
  const ana = await entrarNaSala(browser, sala, 'Ana');
  const beto = await entrarNaSala(browser, sala, 'Beto');
  await expect(ana.getByLabel('Sala e pessoas')).toContainText('Beto');

  // O Beto desligou o som do Ozamigos e os sons de aviso; anota as notas que tocam na página dele.
  await beto.getByRole('button', { name: 'Desligar o som e o microfone' }).click();
  await beto.evaluate(() => {
    localStorage.setItem('ozamigos-sons', 'nao');
    const notas: number[] = [];
    (window as unknown as { __notas: number[] }).__notas = notas;
    const comecar = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (this: OscillatorNode, ...argumentos: [number?]) {
      notas.push(this.frequency.value);
      return comecar.apply(this, argumentos);
    };
  });

  await ana.getByRole('button', { name: 'Beto: volume da voz e silenciar' }).click();
  await ana.getByRole('button', { name: 'Chamar Beto' }).click();
  await expect(beto.getByText('Ana está chamando você.')).toBeVisible();
  await expect.poll(() => beto.evaluate(() => (window as unknown as { __notas: number[] }).__notas)).toContain(1175);
  // O aviso já traz o botão (o do cartão de baixo, com o som desligado, tem o mesmo nome).
  await beto.locator('.avisos').getByRole('button', { name: 'Ligar o som' }).click();
  await expect(beto.getByRole('button', { name: 'Desligar o som e o microfone' })).toBeVisible();
  // Até 5 chamadas por minuto; depois, o botão conta o tempo.
  for (let i = 1; i < 5; i++) await ana.getByRole('button', { name: 'Chamar Beto' }).click();
  await expect(ana.getByRole('button', { name: /Chamar de novo em \d+ s/ })).toBeDisabled();
  for (const pagina of [ana, beto]) await pagina.context().close();
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

  // O print da transmissão vai para a bandeja do chat, no tamanho que chega, e só vai com o Enter.
  await beto.getByRole('figure', { name: 'Transmissão de Ana' }).hover();
  await beto.getByRole('button', { name: 'Mandar um print de Ana para o chat' }).click();
  await expect(beto.getByLabel('Imagens para mandar').getByRole('img', { name: 'Imagem para mandar' })).toBeVisible({ timeout: 15_000 });

  // O mesmo botão entra e sai da tela cheia (o X é parar de assistir, não sair dela).
  const emTelaCheia = () => beto.evaluate(() => document.fullscreenElement?.getAttribute('aria-label') ?? null);
  await beto.getByRole('figure', { name: 'Transmissão de Ana' }).hover();
  await beto.getByRole('button', { name: 'Tela cheia: Ana' }).click();
  await expect.poll(emTelaCheia).toBe('Transmissão de Ana');
  await beto.getByRole('button', { name: 'Sair da tela cheia: Ana' }).click();
  await expect.poll(emTelaCheia).toBeNull();
  await expect(beto.getByRole('button', { name: 'Tela cheia: Ana' })).toBeVisible();
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

test('a voz que fica parada em "conectando" (a ligação se perdeu) é refeita sozinha', async ({ browser }) => {
  const sala = novaSala();
  const ana = await entrarNaSala(browser, sala, 'Ana');
  // Quem chega liga: a primeira ligação de voz do Beto para a Ana some no caminho (como numa reconexão do servidor).
  const beto = await entrarNaSala(browser, sala, 'Beto', {}, () => {
    let perdeu = false;
    const mandar = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, dados: string) {
      if (!perdeu && typeof dados === 'string' && dados.includes('"tipo":"oferta"') && dados.includes('"canal":"voz"')) {
        perdeu = true;
        return;
      }
      return mandar.call(this, dados);
    } as typeof WebSocket.prototype.send;
  });

  // O vigia (20 s, mais o sorteio de até 5 s) liga de novo, e o bipe do microfone de cada um chega ao outro.
  await expect.poll(() => volumeNaSaida(ana), { timeout: 40_000, intervals: [2000] }).toBeGreaterThan(0.01);
  await expect.poll(() => volumeNaSaida(beto), { timeout: 10_000 }).toBeGreaterThan(0.01);
  for (const pagina of [ana, beto]) await pagina.context().close();
});

test('o vídeo de quem transmite só sai para quem clicou em Assistir, e para de sair quando a pessoa deixa de assistir', async ({ browser }) => {
  const sala = novaSala();
  const ana = await entrarNaSala(browser, sala, 'Ana');
  const beto = await entrarNaSala(browser, sala, 'Beto');
  const caio = await entrarNaSala(browser, sala, 'Caio');
  await expect(ana.getByLabel('Sala e pessoas')).toContainText('Caio');

  await ana.getByRole('button', { name: 'Transmitir' }).click();
  await ana.getByRole('menuitem', { name: /A tela inteira/ }).click();
  await expect(beto.getByRole('button', { name: 'Assistir Ana' })).toBeVisible();
  await ana.waitForTimeout(3000); // ao vivo, e ninguém clicou: nada de vídeo sai do PC da Ana
  expect(await video(ana, 'outbound-rtp')).toEqual({ conexoes: 0, bytes: 0 });

  await beto.getByRole('button', { name: 'Assistir Ana' }).click();
  await expect.poll(async () => (await video(beto, 'inbound-rtp')).bytes, { timeout: 30_000 }).toBeGreaterThan(50_000);
  expect((await video(ana, 'outbound-rtp')).conexoes).toBe(1); // uma conexão de vídeo, a do Beto
  expect(await video(caio, 'inbound-rtp')).toEqual({ conexoes: 0, bytes: 0 }); // o Caio não clicou

  await beto.getByRole('button', { name: 'Parar de assistir Ana' }).first().click();
  await expect.poll(async () => (await video(ana, 'outbound-rtp')).conexoes, { timeout: 10_000 }).toBe(0);
});

test('apertar para falar: a voz só vai com a tecla apertada, e o atalho de mudo desliga o microfone', async ({ browser }) => {
  const sala = novaSala();
  const ana = await entrarNaSala(browser, sala, 'Ana');
  const beto = await entrarNaSala(browser, sala, 'Beto');
  await expect.poll(() => volumeNaSaida(beto), { timeout: 30_000 }).toBeGreaterThan(0.01); // a voz da Ana chega

  await ana.getByRole('button', { name: 'Configurações', exact: true }).click();
  await ana.getByRole('tab', { name: 'Atalhos' }).click();
  await ana.getByRole('radio', { name: /Apertar para falar/ }).check();
  await ana.getByRole('button', { name: /^Apertar para falar: nenhum atalho/ }).click();
  await ana.keyboard.press('F8');
  await expect(ana.getByRole('button', { name: /^Apertar para falar: F8/ })).toBeVisible();
  await ana.keyboard.press('Escape'); // fecha a engrenagem
  await expect(ana.getByRole('region', { name: 'Você', exact: true })).toContainText('Aperte F8 para falar');

  await beto.waitForTimeout(1000); // o que já estava a caminho termina de chegar
  expect(await volumeNaSaida(beto)).toBeLessThan(0.001);
  await ana.keyboard.down('F8');
  await expect.poll(() => volumeNaSaida(beto, 500), { timeout: 10_000 }).toBeGreaterThan(0.01);
  await ana.keyboard.up('F8');
  await beto.waitForTimeout(1000);
  expect(await volumeNaSaida(beto)).toBeLessThan(0.001);

  await ana.keyboard.press('Control+Shift+M'); // o atalho padrão, como no Discord
  await expect(ana.getByRole('region', { name: 'Você', exact: true })).toContainText('Mudo');
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

test('quem digita no chat continua no campo quando um amigo com o volume aberto fala (ou liga e desliga o microfone)', async ({ browser }) => {
  const sala = novaSala();
  const ana = await entrarNaSala(browser, sala, 'Ana');
  const beto = await entrarNaSala(browser, sala, 'Beto');
  await beto.getByRole('button', { name: 'Ana: volume da voz e silenciar' }).click();
  await expect(beto.getByLabel('Voz de Ana')).toBeVisible();

  await beto.getByRole('button', { name: 'Chat' }).click();
  const campo = beto.getByLabel('Mensagem para a sala');
  await campo.click();
  await campo.pressSequentially('bora');
  // Qualquer mudança na voz da Ana redesenha a barra lateral do Beto (falar, calar, desligar o microfone).
  await ana.getByRole('button', { name: 'Desligar o microfone' }).click();
  await expect(beto.getByLabel('Sala e pessoas').getByLabel('microfone desligado')).toBeVisible();
  await ana.getByRole('button', { name: 'Ligar o microfone' }).click();
  await expect(beto.getByLabel('Sala e pessoas').getByLabel('microfone desligado')).toHaveCount(0);
  await beto.keyboard.type(' jogar?');

  await expect(campo).toBeFocused();
  await expect(campo).toHaveValue('bora jogar?');
});

test('um print colado no chat chega comprimido ao amigo, direto entre os PCs, e abre em tamanho grande', async ({ browser }) => {
  const sala = novaSala();
  const ana = await entrarNaSala(browser, sala, 'Ana');
  const beto = await entrarNaSala(browser, sala, 'Beto');
  await expect(ana.getByLabel('Sala e pessoas')).toContainText('Beto');

  await ana.getByRole('button', { name: 'Chat' }).click();
  const campo = ana.getByLabel('Mensagem para a sala');
  // Um "print" 2560×1440 em PNG (formas, degradê e texto, como uma tela de jogo), colado com Ctrl+V.
  await campo.evaluate(async (entrada) => {
    const tela = document.createElement('canvas');
    tela.width = 2560;
    tela.height = 1440;
    const g = tela.getContext('2d')!;
    const fundo = g.createLinearGradient(0, 0, 2560, 1440);
    fundo.addColorStop(0, '#1d3b12');
    fundo.addColorStop(1, '#4a2d10');
    g.fillStyle = fundo;
    g.fillRect(0, 0, 2560, 1440);
    let semente = 7;
    const sorteio = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `hsl(${sorteio() * 360} 60% ${30 + sorteio() * 40}%)`;
      g.fillRect(sorteio() * 2560, sorteio() * 1440, 4 + sorteio() * 60, 4 + sorteio() * 60);
    }
    g.fillStyle = '#fff';
    g.font = 'bold 120px sans-serif';
    g.fillText('Perfect Jeweller’s Orb', 200, 700);
    const png = await new Promise<Blob>((pronto) => tela.toBlob((b) => pronto(b!), 'image/png'));
    const dados = new DataTransfer();
    dados.items.add(new File([png], 'print.png', { type: 'image/png' }));
    entrada.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dados, bubbles: true, cancelable: true }));
  });
  await expect(ana.getByLabel('Imagens para mandar').getByRole('img', { name: 'Imagem para mandar' })).toBeVisible({ timeout: 15_000 });
  await campo.fill('olha isso');
  await campo.press('Enter');

  await expect(ana.getByLabel('Chat da sala')).toContainText('Entregue', { timeout: 20_000 });
  await expect(ana.getByLabel('Chat da sala')).toContainText('olha isso'); // o texto vai junto, logo depois
  await expect(beto.getByRole('button', { name: /^Chat, \d+ mensage/ })).toBeVisible();
  await beto.getByRole('button', { name: /^Chat/ }).click();
  const recebida = beto.getByRole('img', { name: 'Imagem de Ana' });
  await expect(recebida).toBeVisible();
  // Visível não é aberta: com o PC ocupado (a suíte inteira), o tamanho ainda vinha 0×0.
  await expect.poll(() => recebida.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const tamanho = await recebida.evaluate((img: HTMLImageElement) => ({ largura: img.naturalWidth, altura: img.naturalHeight, src: img.src }));
  expect(tamanho).toMatchObject({ largura: 2560, altura: 1440 });
  expect(tamanho.src).toMatch(/^blob:/); // veio pelo canal de dados, não de um endereço do servidor
  const bytes = await recebida.evaluate(async (img: HTMLImageElement) => (await (await fetch(img.src)).blob()).size);
  expect(bytes).toBeLessThanOrEqual(1_500_000);

  await beto.getByRole('button', { name: 'Abrir a imagem de Ana' }).click();
  await expect(beto.getByRole('dialog', { name: 'Imagem de Ana' })).toBeVisible();
  await beto.keyboard.press('Escape');
  await expect(beto.getByRole('dialog')).toHaveCount(0);
  await expect(beto.getByLabel('Chat da sala')).toBeVisible(); // o Esc fechou a imagem, não o chat
});

test('no celular, nada passa da largura da tela (sem rolagem de lado), com o chat fechado ou aberto', async ({ browser }) => {
  const celular = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
  const pagina = await entrarNaSala(browser, novaSala(), 'Kayo', celular);
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
