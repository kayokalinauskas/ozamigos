// As pessoas dos testes ponta a ponta: cada uma entra com uma conta do "Google" falso (infra.ts), e as salas são as
// dos servidores salvos. O primeiro a entrar numa sala cria o servidor e o convite; os outros aceitam o convite.
import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';

/** Uma sala dos testes: o servidor salvo, criado por quem entra primeiro, e o convite que os outros aceitam. */
export type Sala = { codigo: string | null; convite: string | null };

export const novaSala = (): Sala => ({ codigo: null, convite: null });

let pessoas = 0;

/**
 * Um navegador próprio (como um PC), vindo de um endereço só dele: o CF-Connecting-IP é o que a Cloudflare põe no ar
 * (Enderecos.java), e sem ele todos os testes viriam do mesmo endereço e esgotariam o freio dos logins.
 */
export function novoContexto(browser: Browser, opcoes: BrowserContextOptions = {}): Promise<BrowserContext> {
  pessoas++;
  return browser.newContext({ ...opcoes, extraHTTPHeaders: { 'CF-Connecting-IP': `198.18.${Math.floor(pessoas / 250)}.${pessoas % 250}` } });
}

/** O login no Google falso: a tela dele pede o usuário e aceita os dados do perfil. */
export async function entrarComOGoogle(p: Page, nome: string) {
  await p.getByRole('button', { name: 'Continuar com o Google' }).click();
  await p.locator('input[name="username"]').fill(`${nome}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await p.locator('textarea[name="claims"]').fill(JSON.stringify({ given_name: nome }));
  await p.getByRole('button', { name: 'Sign-in' }).click();
  await expect(p.locator('.conta-na-entrada')).toContainText(nome);
}

/** Uma ação da API pela página (o cookie da sessão e o Origin são os dela). */
async function api<T>(p: Page, metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  return p.evaluate(
    async ({ metodo, caminho, corpo }) => {
      const resposta = await fetch(caminho, {
        method: metodo,
        headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      if (!resposta.ok) throw new Error(`${metodo} ${caminho}: ${resposta.status} ${await resposta.text()}`);
      return resposta.json();
    },
    { metodo, caminho, corpo },
  ) as Promise<T>;
}

/**
 * Uma pessoa num navegador próprio (como num PC), logada, que entra na sala (o servidor): a primeira cria o servidor e
 * um convite; as outras aceitam o convite pela API. `antes` roda na página antes do app (o jogo falso, os medidores).
 */
export async function entrarNaSala(browser: Browser, sala: Sala, nome: string, opcoes: BrowserContextOptions = {}, antes: (() => void)[] = []): Promise<Page> {
  const contexto = await novoContexto(browser, opcoes);
  const pagina = await contexto.newPage();
  for (const script of antes) await pagina.addInitScript(script);
  await pagina.goto('/');
  await entrarComOGoogle(pagina, nome);
  if (!sala.codigo) {
    sala.codigo = (await api<{ codigo: string }>(pagina, 'POST', '/api/servidores', { nome: 'Sala do teste' })).codigo;
    sala.convite = (await api<{ codigo: string }>(pagina, 'POST', `/api/servidores/${sala.codigo}/convites`, { horas: null, usos: null })).codigo;
  } else {
    await api(pagina, 'POST', `/api/convites/${sala.convite}`);
  }
  await pagina.goto(`/s/${sala.codigo}`);
  await pagina.getByRole('button', { name: 'Entrar no servidor' }).click();
  return pagina;
}
