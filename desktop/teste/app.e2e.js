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
