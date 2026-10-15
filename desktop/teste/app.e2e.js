// Fumaça do app para Windows: abre o Electron de verdade (pelo embrulho), confere a janela e a ponte, e fecha.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// O Windows pode criar um atalho "Electron" no menu Iniciar para o app de teste: só sai se não existia antes.
const ATALHO = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk');
const atalhoJaExistia = fs.existsSync(ATALHO);
test.afterAll(() => {
  if (process.platform === 'win32' && !atalhoJaExistia) fs.rmSync(ATALHO, { force: true });
});

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
    await expect(aberto.janela.locator('h1')).toHaveText('servidor de teste');
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

/** Um servidor mínimo no lugar do Ozamigos: uma página qualquer, na origem que o app confia. */
async function servidorDeTeste() {
  const servidor = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Ozamigos</title><h1>servidor de teste</h1>');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  return { servidor, endereco: `http://localhost:${servidor.address().port}` };
}

test('fechar a janela deixa o app na bandeja, e a página tem a bandeja, o aviso de mensagens e a tela acordada', async () => {
  const { servidor, endereco } = await servidorDeTeste();
  const aberto = await abrirApp(endereco);
  try {
    await expect(aberto.janela.locator('h1')).toHaveText('servidor de teste');
    const pagina = await aberto.janela.evaluate(async () => {
      window.ozamigos.naoLidas(2); // o ponto na barra de tarefas: não pode dar erro
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

/** As regras de economia de energia do Windows para o processo (ProcessPowerThrottling), lidas pelo PowerShell. */
function economiaDoProcesso(pid) {
  const { execFileSync } = require('node:child_process');
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
