// O caminho principal do app, com navegadores de verdade: entrar, transmitir, assistir, falar e sair.
// Cada pessoa é um contexto separado do navegador (como dois PCs), com microfone falso e um "jogo" desenhado.
import { expect, test, type Browser, type Page } from '@playwright/test';

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

async function entrarNaSala(browser: Browser, sala: string, nome: string, senha = 'teste'): Promise<Page> {
  const contexto = await browser.newContext();
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
