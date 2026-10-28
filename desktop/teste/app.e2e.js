// Fumaça do app para Windows: abre o Electron de verdade (pelo embrulho), confere a janela e a ponte, e fecha.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// O Windows pode criar um atalho "Electron" no menu Iniciar para o app de teste: só sai se não existia antes.
const ATALHO = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk');
const atalhoJaExistia = fs.existsSync(ATALHO);
test.afterAll(() => {
  if (process.platform === 'win32' && !atalhoJaExistia) fs.rmSync(ATALHO, { force: true });
});

// O app pergunta ao servidor antes de abrir a página; sem resposta em 1,5 s, mostra "Conectando…" (inicio.html, com outro
// h1) e só depois abre a página. No CI, o servidor de teste às vezes demora isso no primeiro pedido.
const PAGINA_DO_SERVIDOR = 20_000;

async function abrirApp(servidor, configuracao = {}) {
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'ozamigos-teste-'));
  // Sem o aviso "o Ozamigos continua aberto" do Windows a cada teste que fecha a janela.
  fs.writeFileSync(path.join(dados, 'configuracao.json'), JSON.stringify({ avisouDaBandeja: true, ...configuracao }));
  const app = await electron.launch({
    args: [path.join(__dirname, 'embrulho.js')],
    env: { ...process.env, OZAMIGOS_SERVIDOR: servidor, OZAMIGOS_TESTE_DADOS: dados },
  });
  test.info().attach('pasta de dados', { body: dados });
  return { app, janela: await app.firstWindow(), dados };
}

async function fechar({ app, dados }) {
  await app.close();
  fs.rmSync(dados, { recursive: true, force: true });
}

test('abre a interface do servidor, com a ponte do app e sem acesso ao Node', async () => {
  // Um servidor mínimo no lugar do Ozamigos: o que se testa aqui é o app, não a interface.
  const servidor = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Ozamigos</title><h1>servidor de teste</h1>');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const endereco = `http://localhost:${servidor.address().port}`;
  const aberto = await abrirApp(endereco);
  try {
    await expect(aberto.janela.getByRole('heading', { name: 'servidor de teste' })).toBeVisible({ timeout: PAGINA_DO_SERVIDOR });
    expect(aberto.janela.url()).toBe(`${endereco}/`);
    const ponte = await aberto.janela.evaluate(() => ({
      ponte: Object.keys(window.ozamigos ?? {}).sort(),
      node: typeof require !== 'undefined' || typeof process !== 'undefined',
    }));
    expect(ponte.ponte).toEqual(expect.arrayContaining(['aoPedirFonte', 'responderFonte', 'aoReceberSom', 'trocarServidor', 'versao']));
    expect(ponte.node).toBe(false);
  } finally {
    await fechar(aberto);
    servidor.close();
  }
});

test('sem servidor, mostra a tela de início explicando o erro', async () => {
  const aberto = await abrirApp('http://localhost:1'); // porta fechada
  try {
    await expect.poll(() => aberto.janela.url(), { timeout: 15_000 }).toContain('inicio.html');
    await expect(aberto.janela.locator('body')).toContainText('Não foi possível abrir');
  } finally {
    await fechar(aberto);
  }
});

test('com o servidor dormindo, explica e conta o tempo, e abre a sala sozinho quando ele acorda', async () => {
  // Como o Render gratuito acordando: o pedido fica parado, sem resposta, e depois chega.
  let acordou = false;
  const servidor = http.createServer((req, res) => {
    const responder = () => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>Ozamigos</title><h1>servidor de teste</h1>');
    };
    if (acordou) responder();
    else
      setTimeout(() => {
        acordou = true;
        responder();
      }, 4_000);
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const endereco = `http://localhost:${servidor.address().port}`;
  const aberto = await abrirApp(endereco);
  try {
    await expect(aberto.janela.locator('#acordando')).toBeVisible({ timeout: 5_000 });
    await expect(aberto.janela.locator('#acordando')).toContainText('Conectando');
    expect(await aberto.janela.locator('#formulario').isVisible()).toBe(false);
    await expect.poll(() => aberto.janela.url(), { timeout: 10_000 }).toBe(`${endereco}/`);
    await expect(aberto.janela.getByRole('heading', { name: 'servidor de teste' })).toBeVisible({ timeout: PAGINA_DO_SERVIDOR });
  } finally {
    await fechar(aberto);
    servidor.close();
  }
});

/** Um servidor mínimo no lugar do Ozamigos: uma página qualquer, na origem que o app confia. */
async function servidorDeTeste() {
  const servidor = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Ozamigos</title><h1>servidor de teste</h1>');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  return { servidor, endereco: `http://localhost:${servidor.address().port}` };
}

test('os atalhos de voz chegam à página pelo auxiliar do app, que lê as teclas do Windows (valem com o jogo na frente)', async () => {
  const { servidor, endereco } = await servidorDeTeste();
  const aberto = await abrirApp(endereco);
  try {
    await expect(aberto.janela.getByRole('heading', { name: 'servidor de teste' })).toBeVisible({ timeout: PAGINA_DO_SERVIDOR });
    // F24 (0x87): uma tecla que existe para o Windows mas em nenhum teclado, então não mexe em nada do PC de quem roda.
    const globais = await aberto.janela.evaluate(async () => {
      window.__atalhos = [];
      window.ozamigos.atalhos.aoApertar((evento) => window.__atalhos.push(evento));
      return window.ozamigos.atalhos.definir({ mudo: [], surdo: [], falar: [0x87] });
    });
    expect(globais).toBe(true);
    await new Promise((r) => setTimeout(r, 500)); // o auxiliar abre e lê a configuração
    const tecla = (solta) =>
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `Add-Type -Name K -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);'; [W.K]::keybd_event(0x87, 0, ${solta ? 2 : 0}, [System.UIntPtr]::Zero)`,
      ]);
    tecla(false);
    await new Promise((r) => setTimeout(r, 300));
    tecla(true);
    await expect.poll(() => aberto.janela.evaluate(() => window.__atalhos)).toEqual(['falar 1', 'falar 0']);
  } finally {
    await fechar(aberto);
    servidor.close();
  }
});

test('o login pelo navegador espera a volta só no 127.0.0.1, e só com o estado que o app sorteou', async () => {
  const { servidor, endereco } = await servidorDeTeste();
  const aberto = await abrirApp(endereco);
  try {
    await expect(aberto.janela.getByRole('heading', { name: 'servidor de teste' })).toBeVisible({ timeout: PAGINA_DO_SERVIDOR });
    // O navegador do sistema não abre no teste: o app guarda o endereço, e o teste faz a volta.
    await aberto.app.evaluate(({ shell }) => {
      globalThis.abertos = [];
      shell.openExternal = async (url) => {
        globalThis.abertos.push(url);
      };
    });
    const login = aberto.janela.evaluate(() => window.ozamigos.conta.loginPeloNavegador('google'));
    await expect.poll(() => aberto.app.evaluate(() => globalThis.abertos.length)).toBe(1);
    const inicio = new URL((await aberto.app.evaluate(() => globalThis.abertos))[0]);
    expect(`${inicio.origin}${inicio.pathname}`).toBe(`${endereco}/conta/entrar/google`);
    const porta = inicio.searchParams.get('app');
    const estado = inicio.searchParams.get('estado');
    expect(estado).toMatch(/^[A-Za-z0-9_-]{32}$/);

    // Uma volta forjada, sem o estado certo: não serve, e o app continua esperando a de verdade.
    const codigo = 'c'.repeat(43);
    expect((await fetch(`http://127.0.0.1:${porta}/login?codigo=${codigo}&estado=forjado`)).status).toBe(404);
    const volta = await fetch(`http://127.0.0.1:${porta}/login?codigo=${codigo}&estado=${estado}`);
    expect(await volta.text()).toContain('Pronto!');
    expect(await login).toEqual({ codigo });

    expect(await aberto.janela.evaluate(() => window.ozamigos.conta.loginPeloNavegador('outro'))).toEqual({ erro: 'pedido-invalido' });
  } finally {
    await fechar(aberto);
    servidor.close();
  }
});

test('a captura do app manda à página os quadros prontos da janela escolhida, e avisa quando a janela fecha', async () => {
  test.skip(Boolean(process.env.CI), 'o runner do GitHub não tem placa de vídeo para reduzir e converter os quadros');
  // A janela a transmitir: um formulário do PowerShell, com um título que só ela tem.
  const titulo = `ozamigos-teste-${Date.now()}`;
  const formulario = spawn('powershell', [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object Windows.Forms.Form; $f.Text = '${titulo}'; $f.Width = 640; $f.Height = 480; [void]$f.ShowDialog()`,
  ]);
  const { servidor, endereco } = await servidorDeTeste();
  const aberto = await abrirApp(endereco);
  try {
    await expect(aberto.janela.getByRole('heading', { name: 'servidor de teste' })).toBeVisible({ timeout: PAGINA_DO_SERVIDOR });
    // A página faz o que a interface faz: pede a tela (num clique), e responde ao seletor do app pedindo a captura dele.
    await aberto.janela.evaluate((titulo) => {
      window.__quadros = [];
      window.ozamigos.video.aoReceberQuadro((dados) => {
        const cabecalho = new DataView(dados.buffer, dados.byteOffset, 24);
        window.__quadros.push({ marca: String.fromCharCode(...dados.subarray(0, 4)), largura: cabecalho.getUint16(4, true), altura: cabecalho.getUint16(6, true), bytes: dados.length });
      });
      window.ozamigos.video.aoParar((aviso) => (window.__parou = aviso.motivo));
      window.ozamigos.aoPedirFonte((fontes) => {
        const fonte = fontes.find((f) => f.nome === titulo);
        window.__resultado = window.ozamigos.responderFonte(fonte ? { id: fonte.id, audio: false, captura: { largura: 1280, altura: 720, fps: 30 } } : null);
      });
      document.querySelector('h1').addEventListener('click', () => {
        window.__captura = navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => 'do Chromium', () => 'recusada');
      });
    }, titulo);
    // O formulário leva uns segundos para abrir: pede de novo até ele aparecer no seletor.
    await expect
      .poll(
        async () => {
          await aberto.janela.click('h1');
          await aberto.janela.waitForFunction(() => window.__captura, null, { timeout: 10_000 });
          const captura = await aberto.janela.evaluate(() => window.__captura);
          return captura === 'recusada' ? aberto.janela.evaluate(() => window.__resultado) : null;
        },
        { timeout: 20_000, intervals: [1_000] },
      )
      .toMatchObject({ videoDoApp: true, tipo: 'janela' });
    // O getDisplayMedia foi recusado de propósito: o vídeo chega pelos quadros, já reduzidos e em NV12.
    await expect.poll(() => aberto.janela.evaluate(() => window.__quadros.length), { timeout: 5_000 }).toBeGreaterThan(5);
    const [quadro] = await aberto.janela.evaluate(() => window.__quadros);
    expect(quadro.marca).toBe('OZQ1');
    expect(quadro.largura % 2 + (quadro.altura % 2)).toBe(0);
    expect(quadro.largura).toBeLessThanOrEqual(1280);
    expect(quadro.bytes).toBe(24 + (quadro.largura * quadro.altura * 3) / 2);
    // A janela transmitida fechou: a página fica sabendo (e encerra a transmissão, como na captura do Chromium).
    formulario.kill();
    await expect.poll(() => aberto.janela.evaluate(() => window.__parou), { timeout: 5_000 }).toBe('fechou');
  } finally {
    formulario.kill();
    await fechar(aberto);
    servidor.close();
  }
});

test('fechar a janela deixa o app na bandeja, e a página tem a bandeja, o aviso de mensagens e a tela acordada', async () => {
  const { servidor, endereco } = await servidorDeTeste();
  const aberto = await abrirApp(endereco);
  try {
    await expect(aberto.janela.getByRole('heading', { name: 'servidor de teste' })).toBeVisible({ timeout: PAGINA_DO_SERVIDOR });
    const pagina = await aberto.janela.evaluate(async () => {
      // A marca com o número na barra de tarefas e na bandeja (e o "9+"), e de volta ao ícone limpo: não pode dar erro.
      window.ozamigos.naoLidas(2);
      window.ozamigos.naoLidas(12);
      window.ozamigos.naoLidas(0);
      let telaAcordada;
      try {
        await (await navigator.wakeLock.request('screen')).release();
        telaAcordada = 'ok';
      } catch (erro) {
        telaAcordada = erro.name;
      }
      return { bandeja: await window.ozamigos.bandeja.ler(), telaAcordada };
    });
    expect(pagina).toEqual({ bandeja: true, telaAcordada: 'ok' });

    await aberto.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const depois = await aberto.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((j) => j.isVisible()));
    expect(depois).toEqual([false]); // escondida, não fechada: a conversa continuaria
  } finally {
    await fechar(aberto); // sair de verdade (como o "Sair" da bandeja) ainda fecha tudo
    servidor.close();
  }
});

test('a marca das mensagens não lidas tem o número, e na bandeja fica no canto de cima sem apagar o ícone', () => {
  const { iconeComMarca, marcaSozinha, textoDaMarca } = require('../marcaDoChat');
  expect([1, 9, 10, 250].map(textoDaMarca)).toEqual(['1', '9', '9+', '9+']);
  const cor = (pixels, lado, x, y) => [...pixels.subarray((y * lado + x) * 4, (y * lado + x) * 4 + 4)];
  const VERDE = [0x4a, 0xf2, 0xb6, 255];
  for (const lado of [16, 32]) {
    const marca = marcaSozinha(3, lado);
    const cores = new Set(Array.from({ length: lado * lado }, (_, i) => cor(marca, lado, i % lado, Math.floor(i / lado)).join()));
    expect(cores).toContain(VERDE.join()); // a bolinha
    expect(cores).toContain([0x0a, 0x0e, 0x0b, 255].join()); // o número, escuro
    // Um "ícone" cinza: o canto de baixo à esquerda continua o ícone, o de cima à direita ganha a marca.
    const icone = Buffer.alloc(lado * lado * 4, 0x80);
    for (const n of [1, 12]) {
      const comMarca = iconeComMarca(icone, lado, n);
      expect(cor(comMarca, lado, 1, lado - 2)).toEqual(cor(icone, lado, 1, lado - 2));
      const alto = Array.from({ length: lado / 2 }, (_, y) => Array.from({ length: lado / 2 }, (_, x) => cor(comMarca, lado, lado / 2 + x, y).join())).flat();
      expect(alto).toContain(VERDE.join());
    }
  }
});

/** As regras de economia de energia do Windows para o processo (ProcessPowerThrottling), lidas pelo PowerShell. */
function economiaDoProcesso(pid) {
  const { execFileSync, spawn } = require('node:child_process');
  const script = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class E {
  [StructLayout(LayoutKind.Sequential)] public struct P { public uint Version; public uint ControlMask; public uint StateMask; }
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint a, bool h, int pid);
  [DllImport("kernel32.dll")] public static extern bool GetProcessInformation(IntPtr h, int c, ref P p, int t);
  public static string Ler(int pid) { var p = new P { Version = 1 }; var h = OpenProcess(0x1000, false, pid); return GetProcessInformation(h, 4, ref p, 12) ? p.ControlMask + " " + p.StateMask : "erro"; }
}
'@
[E]::Ler(${Number(pid)})`;
  const [controle, estado] = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim().split(' ').map(Number);
  return { controle, estado };
}

test('o Windows continua dando o relógio fino ao app com a janela escondida (a captura não cai para ~21 fps)', async () => {
  test.skip(process.platform !== 'win32', 'regra do Windows 11');
  const aberto = await abrirApp('http://localhost:1'); // a tela de início basta
  try {
    // PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION (4) no "controle" e fora do "estado": a marca do auxiliar
    // (OzamigosSom.exe --relogio, Relogio.cs). Sem ela, minimizado ou tapado, o processo vai para o tique de 15,6 ms.
    const pid = await aberto.app.evaluate(() => process.pid); // o do processo principal (o do Playwright é outro)
    await expect.poll(() => economiaDoProcesso(pid), { timeout: 10_000 }).toEqual({ controle: 4, estado: 0 });
  } finally {
    await fechar(aberto);
  }
});

test('a janela guardada num monitor que não existe mais abre dentro da tela', async () => {
  const aberto = await abrirApp('http://localhost:1', { posicao: { x: -30_000, y: -30_000, width: 1280, height: 800 } });
  try {
    const { janela, telas } = await aberto.app.evaluate(({ BrowserWindow, screen }) => ({
      janela: BrowserWindow.getAllWindows()[0].getBounds(),
      telas: screen.getAllDisplays().map((t) => t.workArea),
    }));
    const dentro = telas.some((t) => janela.x >= t.x - 16 && janela.y >= t.y - 16 && janela.x < t.x + t.width && janela.y < t.y + t.height);
    expect(dentro).toBe(true);
  } finally {
    await fechar(aberto);
  }
});

test('a página que cai abre de novo sozinha', async () => {
  const { servidor, endereco } = await servidorDeTeste();
  const aberto = await abrirApp(endereco);
  try {
    await expect(aberto.janela.getByRole('heading', { name: 'servidor de teste' })).toBeVisible({ timeout: PAGINA_DO_SERVIDOR });
    // O Playwright perde a página junto com o processo que caiu: quem confere é o processo principal do app.
    await aberto.app.evaluate(({ BrowserWindow }) => {
      const conteudo = BrowserWindow.getAllWindows()[0].webContents;
      globalThis.carregouDepoisDaQueda = false;
      conteudo.once('render-process-gone', () => conteudo.once('did-finish-load', () => (globalThis.carregouDepoisDaQueda = true)));
      conteudo.forcefullyCrashRenderer();
    });
    const estado = () =>
      aberto.app.evaluate(({ BrowserWindow }) => {
        const conteudo = BrowserWindow.getAllWindows()[0].webContents;
        return { recarregou: globalThis.carregouDepoisDaQueda, caida: conteudo.isCrashed(), endereco: conteudo.getURL() };
      });
    await expect.poll(estado, { timeout: 15_000 }).toEqual({ recarregou: true, caida: false, endereco: `${endereco}/` });
  } finally {
    await fechar(aberto);
    servidor.close();
  }
});

test('um convite ozamigos:// abre o app na sala, e com o app aberto chega à página', async () => {
  // Uma página que mostra no título o convite que chegou pela ponte (a interface de verdade chama cliente.abrirConvite).
  const servidor = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>sem convite</title><h1>servidor de teste</h1><script>window.ozamigos.aoAbrirSala((s) => (document.title = "convite " + s));</script>');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const endereco = `http://localhost:${servidor.address().port}`;
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'ozamigos-teste-'));
  fs.writeFileSync(path.join(dados, 'configuracao.json'), JSON.stringify({ avisouDaBandeja: true }));
  const env = { ...process.env, OZAMIGOS_SERVIDOR: endereco, OZAMIGOS_TESTE_DADOS: dados };
  const embrulho = path.join(__dirname, 'embrulho.js');
  const app = await electron.launch({ args: [embrulho, 'ozamigos://sala/Convite01/'], env });
  try {
    const janela = await app.firstWindow();
    await expect(janela.getByRole('heading', { name: 'servidor de teste' })).toBeVisible({ timeout: PAGINA_DO_SERVIDOR });
    expect(janela.url()).toBe(`${endereco}/?sala=Convite01`);

    // Com o app aberto, o Windows abre outro processo com o link: ele passa o convite ao primeiro e fecha.
    const { spawnSync } = require('node:child_process');
    spawnSync(require('electron'), [embrulho, 'ozamigos://sala/Outra02'], { env, timeout: 20_000 });
    await expect(janela).toHaveTitle('convite Outra02');

    // Um convite que tentasse trocar de servidor não vira sala.
    spawnSync(require('electron'), [embrulho, 'ozamigos://servidor/Outra03'], { env, timeout: 20_000 });
    await janela.waitForTimeout(500);
    await expect(janela).toHaveTitle('convite Outra02');
  } finally {
    await app.close();
    fs.rmSync(dados, { recursive: true, force: true });
    servidor.close();
  }
});
