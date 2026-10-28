// As contas com navegadores de verdade: o login inteiro (servidor → "Google" → servidor), a conta na sala, o nome que
// muda na hora e apagar a conta. O "Google" é o mock-oauth2-server, um emissor OpenID Connect de teste, e o banco é
// um Postgres: os dois em Docker, com um servidor só deste arquivo na 8092 (OZAMIGOS_GOOGLE_EMISSOR aponta para o
// falso; ProvedoresDeLogin.java). Sem o Docker, este arquivo pula; os outros continuam no servidor sem contas (8090).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const PORTA = 8092;
const BASE = `http://localhost:${PORTA}`;
const SENHA = 'teste';

function temDocker(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

function docker(...argumentos: string[]): string {
  return execFileSync('docker', argumentos, { encoding: 'utf8' }).trim();
}

/** A porta do PC que o Docker escolheu para a porta do contêiner. */
function portaDe(conteiner: string, porta: number): string {
  return docker('port', conteiner, `${porta}/tcp`).split('\n')[0].split(':').pop()!;
}

async function esperar(condicao: () => Promise<boolean>, o_que: string, ms = 180_000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`não ficou pronto: ${o_que}`);
}

test.describe('contas', () => {
  test.skip(!temDocker(), 'sem o Docker: as contas precisam do banco e do Google falso');

  const conteineres: string[] = [];
  let servidor: ChildProcess | undefined;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const banco = docker('run', '-d', '--rm', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_DB=ozamigos', '-e', 'POSTGRES_USER=ozamigos',
      '-e', 'POSTGRES_PASSWORD=ozamigos-e2e', 'postgres:18-alpine');
    conteineres.push(banco);
    const google = docker('run', '-d', '--rm', '-p', '127.0.0.1::8080', '-e', 'JSON_CONFIG={"interactiveLogin":true}',
      'ghcr.io/navikt/mock-oauth2-server:2.1.10');
    conteineres.push(google);
    const emissor = `http://localhost:${portaDe(google, 8080)}/default`;
    await esperar(async () => (await fetch(`${emissor}/.well-known/openid-configuration`)).ok, 'o Google falso');

    const windows = process.platform === 'win32';
    // A saída do servidor vai para um arquivo, junto com os rastros do Playwright: é onde se lê por que não subiu.
    mkdirSync('test-results', { recursive: true });
    const log = openSync('test-results/servidor-das-contas.log', 'w');
    const mvnw = join(RAIZ, windows ? 'mvnw.cmd' : 'mvnw');
    servidor = spawn(windows ? 'cmd' : mvnw, windows ? ['/c', mvnw, '-q', 'spring-boot:run'] : ['-q', 'spring-boot:run'], {
      cwd: RAIZ,
      detached: !windows, // no Linux, o grupo inteiro sai junto no fim (o Maven abre o Java como filho)
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        PORT: String(PORTA),
        OZAMIGOS_SENHA: SENHA,
        OZAMIGOS_BANCO_URL: `jdbc:postgresql://localhost:${portaDe(banco, 5432)}/ozamigos`,
        OZAMIGOS_BANCO_USUARIO: 'ozamigos',
        OZAMIGOS_BANCO_SENHA: 'ozamigos-e2e',
        OZAMIGOS_GOOGLE_ID: 'ozamigos-e2e',
        OZAMIGOS_GOOGLE_SEGREDO: 'segredo-e2e',
        OZAMIGOS_GOOGLE_EMISSOR: emissor,
      },
    });
    // Pronto de verdade quando o banco também está: o login só aparece com as migrações rodadas.
    await esperar(async () => {
      const eu = await (await fetch(`${BASE}/api/eu`)).json();
      return eu.login.includes('google');
    }, 'o servidor com as contas');
  });

  test.afterAll(() => {
    if (servidor?.pid) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(servidor.pid), '/t', '/f'], { stdio: 'ignore' });
        else process.kill(-servidor.pid, 'SIGTERM');
      } catch {
        // já tinha saído
      }
    }
    for (const conteiner of conteineres) docker('stop', conteiner);
  });

  /** Uma pessoa num navegador próprio (como num PC), sem a pergunta do convite para o app. */
  async function pessoa(browser: Browser, celular = false): Promise<Page> {
    const contexto = await browser.newContext(
      celular
        ? { baseURL: BASE, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }
        : { baseURL: BASE, viewport: { width: 1280, height: 900 } },
    );
    await contexto.addInitScript(() => localStorage.setItem('ozamigos-fica-no-navegador', '1'));
    return contexto.newPage();
  }

  /** O login no Google falso: a tela dele pede o usuário e aceita os dados do perfil. */
  async function entrarComOGoogle(p: Page, usuario: string, nome: string) {
    await p.getByRole('button', { name: 'Continuar com o Google' }).click();
    await p.locator('input[name="username"]').fill(usuario);
    await p.locator('textarea[name="claims"]').fill(JSON.stringify({ given_name: nome }));
    await p.getByRole('button', { name: 'Sign-in' }).click();
    await expect(p.locator('.conta-na-entrada')).toContainText(nome);
  }

  async function entrarNaSala(p: Page) {
    await p.getByLabel('Senha do grupo').fill(SENHA);
    await p.getByRole('button', { name: 'Entrar na sala' }).click();
    await expect(p.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
  }

  test('entrar com o Google leva o nome da conta para a sala, e o amigo convidado vê', async ({ browser }) => {
    const ana = await pessoa(browser);
    await ana.goto('/?entrada');
    await expect(ana.getByRole('button', { name: 'Continuar com o Discord' })).toHaveCount(0); // só o que o servidor tem

    await entrarComOGoogle(ana, `ana-${Date.now()}`, 'Ana da Conta');
    expect(new URL(ana.url()).searchParams.has('erro-de-login')).toBe(false);
    await expect(ana.getByLabel('Seu nome')).toHaveCount(0); // com conta, o nome é o dela
    await entrarNaSala(ana);
    await expect(ana.locator('.voce-linha')).toContainText('Ana da Conta');

    const beto = await pessoa(browser);
    await beto.goto(`/?sala=${new URL(ana.url()).searchParams.get('sala')}`);
    await beto.getByLabel('Seu nome').fill('Beto');
    await entrarNaSala(beto);
    await expect(beto.locator('.pessoa-nome-texto', { hasText: 'Ana da Conta' })).toBeVisible();

    // A sessão continua ao recarregar: o cookie é do Ozamigos, e o servidor diz quem é.
    await ana.reload();
    await expect(ana.locator('.conta-na-entrada').or(ana.locator('.voce-linha'))).toContainText('Ana da Conta');
  });

  test('o nome novo vale na sala na hora, e apagar a conta volta a ser convidado', async ({ browser }) => {
    const caio = await pessoa(browser);
    await caio.goto('/?entrada');
    await entrarComOGoogle(caio, `caio-${Date.now()}`, 'Caio');
    await entrarNaSala(caio);

    const dani = await pessoa(browser);
    await dani.goto(`/?sala=${new URL(caio.url()).searchParams.get('sala')}`);
    await dani.getByLabel('Seu nome').fill('Dani');
    await entrarNaSala(dani);
    await expect(dani.locator('.pessoa-nome-texto', { hasText: 'Caio' })).toBeVisible();

    await caio.getByRole('button', { name: 'Configurações' }).click();
    await caio.getByRole('tab', { name: 'Conta' }).click();
    await caio.getByLabel('Nome na sala').fill('Caio Novo');
    await caio.getByRole('button', { name: 'Salvar' }).click();
    await expect(caio.getByText('Nome salvo.')).toBeVisible();
    await expect(dani.locator('.pessoa-nome-texto', { hasText: 'Caio Novo' })).toBeVisible();

    await caio.getByRole('button', { name: 'Apagar a minha conta' }).click();
    await caio.getByRole('button', { name: 'Apagar para sempre' }).click();
    await expect(caio.getByRole('button', { name: 'Continuar com o Google' })).toBeVisible();
    const eu = await (await caio.request.get('/api/eu')).json();
    expect(eu.conta).toBeNull();
    await expect(caio.getByRole('button', { name: 'Sair da sala' })).toBeVisible(); // continua na sala, como convidado
  });

  test('o erro do login aparece na entrada e sai do endereço', async ({ browser }) => {
    const p = await pessoa(browser);
    await p.goto('/?entrada&erro-de-login=recusado');

    await expect(p.getByRole('alert')).toContainText('O login não foi concluído');
    expect(new URL(p.url()).searchParams.has('erro-de-login')).toBe(false);
  });

  test('no celular, os botões de login não passam da largura da tela', async ({ browser }) => {
    const p = await pessoa(browser, true);
    await p.goto('/?entrada');
    await expect(p.getByRole('button', { name: 'Continuar com o Google' })).toBeVisible();

    const larguras = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(larguras[0]).toBeLessThanOrEqual(larguras[1]);
  });
});
