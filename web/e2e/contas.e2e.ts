// As contas e os servidores salvos com navegadores de verdade: o login inteiro (servidor → "Google" → servidor), o
// servidor criado na entrada, o convite pelo link, a lista dos servidores, expulsar, o nome que muda e apagar a conta.
// O "Google" é o mock-oauth2-server, e o banco um Postgres, os dois em Docker (infra.ts).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrarComOGoogle, entrarNaSala, novaSala, novoContexto } from './conta';

/** Uma pessoa num navegador próprio (como num PC), ainda sem conta. */
async function pessoa(browser: Browser, celular = false): Promise<Page> {
  const contexto = await novoContexto(
    browser,
    celular ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } },
  );
  return contexto.newPage();
}

test('sem conta, a entrada é só o login; com conta, os servidores, e a sessão continua ao recarregar', async ({ browser }) => {
  const ana = await pessoa(browser);
  await ana.goto('/');
  await expect(ana.getByRole('button', { name: 'Continuar com o Discord' })).toHaveCount(0); // só o que o servidor tem
  await expect(ana.getByLabel(/Senha/)).toHaveCount(0); // as salas com senha saíram (28/10/2026)

  await entrarComOGoogle(ana, 'Ana da Conta');
  expect(new URL(ana.url()).searchParams.has('erro-de-login')).toBe(false);
  await expect(ana.getByRole('button', { name: 'Criar um servidor' })).toBeVisible();

  await ana.reload();
  await expect(ana.locator('.conta-na-entrada')).toContainText('Ana da Conta'); // o cookie é do Ozamigos
});

test('um servidor salvo: criar, convidar pelo link, voltar pela lista, e expulsar', async ({ browser }) => {
  const eva = await pessoa(browser);
  await eva.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await eva.goto('/');
  await entrarComOGoogle(eva, 'Eva');
  await eva.getByRole('button', { name: 'Criar um servidor' }).click();
  await eva.getByLabel('Nome do servidor').fill('Os Amigos');
  await eva.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(eva.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
  await expect(eva.locator('.nome-do-servidor')).toHaveText('Os Amigos');
  expect(new URL(eva.url()).pathname).toMatch(/^\/s\/[A-Za-z0-9]{10}$/);

  await eva.getByRole('button', { name: 'Convidar' }).click();
  await expect(eva.getByRole('button', { name: 'Copiado' })).toBeVisible();
  const convite = new URL(await eva.evaluate(() => navigator.clipboard.readText()));
  expect(convite.pathname).toMatch(/^\/c\/[A-Za-z0-9]{10}$/);

  // Sem conta, o convite mostra o servidor e pede o login; a volta do login é o próprio convite.
  const fabio = await pessoa(browser);
  await fabio.goto(convite.pathname);
  await expect(fabio.locator('.servidor-titulo')).toContainText('Os Amigos');
  await entrarComOGoogle(fabio, 'Fábio');
  await fabio.getByRole('button', { name: 'Aceitar e entrar' }).click();
  await expect(fabio.getByRole('button', { name: 'Sair da sala' })).toBeVisible();
  await expect(eva.locator('.pessoa-nome-texto', { hasText: 'Fábio' })).toBeVisible();

  // Membro, volta pela lista dos servidores, sem convite.
  await fabio.getByRole('button', { name: 'Sair da sala' }).click();
  await fabio.getByRole('button', { name: /Os Amigos/ }).click();
  await expect(fabio.getByRole('button', { name: 'Sair da sala' })).toBeVisible();

  await eva.getByRole('button', { name: 'Configurações do servidor' }).click();
  await eva.getByRole('tab', { name: 'Membros' }).click();
  await eva.getByRole('button', { name: 'Expulsar' }).click();
  await eva.getByRole('alertdialog').getByRole('button', { name: 'Expulsar' }).click();
  await expect(fabio.getByRole('alert')).toContainText('Você foi removido deste servidor.');
  await expect(fabio.getByRole('button', { name: 'Entrar no servidor' })).toBeDisabled(); // e não volta
});

test('o nome novo vale na próxima entrada, e apagar a conta tira da sala', async ({ browser }) => {
  const sala = novaSala();
  const caio = await entrarNaSala(browser, sala, 'Caio');
  const dani = await entrarNaSala(browser, sala, 'Dani');
  await expect(dani.locator('.pessoa-nome-texto', { hasText: 'Caio' })).toBeVisible();

  await caio.getByRole('button', { name: 'Configurações', exact: true }).click();
  await caio.getByRole('tab', { name: 'Conta' }).click();
  await caio.getByLabel('Nome na sala').fill('Caio Novo');
  await caio.getByRole('button', { name: 'Salvar' }).click();
  await expect(caio.getByText('Nome salvo.')).toBeVisible();
  expect((await (await caio.request.get('/api/eu')).json()).conta.nome).toBe('Caio Novo');
  await expect(dani.locator('.pessoa-nome-texto', { hasText: 'Caio' })).toBeVisible(); // ninguém caiu da sala

  await caio.getByRole('button', { name: 'Apagar a minha conta' }).click();
  await caio.getByRole('button', { name: 'Apagar para sempre' }).click();
  await expect(caio.getByRole('button', { name: 'Continuar com o Google' })).toBeVisible();
  expect((await (await caio.request.get('/api/eu')).json()).conta).toBeNull();
  await expect(dani.locator('.pessoa-nome-texto', { hasText: 'Caio' })).toHaveCount(0); // saiu da sala, para todos
});

test('o erro do login aparece na entrada e sai do endereço', async ({ browser }) => {
  const p = await pessoa(browser);
  await p.goto('/?erro-de-login=recusado');

  await expect(p.getByRole('alert')).toContainText('O login não foi concluído');
  expect(new URL(p.url()).searchParams.has('erro-de-login')).toBe(false);
});

test('no celular, a entrada não passa da largura da tela, sem e com conta', async ({ browser }) => {
  const p = await pessoa(browser, true);
  await p.goto('/');
  await expect(p.getByRole('button', { name: 'Continuar com o Google' })).toBeVisible();

  // Contra 375, e não contra o innerWidth: no celular, o Chromium afasta a página que não cabe, e os dois crescem juntos.
  expect(await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth])).toEqual([375, 375]);
  await entrarComOGoogle(p, 'Celular'); // com conta: a lista dos servidores
  expect(await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth])).toEqual([375, 375]);
});

test('os links de antes das contas (o grupo fixo, um grupo, uma sala) levam à entrada', async ({ browser }) => {
  const p = await pessoa(browser);
  for (const antigo of ['/ozamigos', '/amigos-do-kayo', '/?sala=Ab3dEf9']) {
    await p.goto(antigo);
    await expect(p.getByRole('button', { name: 'Continuar com o Google' })).toBeVisible();
  }
});
