// O que os testes ponta a ponta precisam, uma vez para todos (globalSetup do Playwright): um Postgres e o "Google"
// falso (mock-oauth2-server), os dois em Docker, e o servidor do Ozamigos na 8090 apontado para eles. Desde 28/10/2026,
// toda sala é de um servidor salvo, e entrar pede a conta: sem o Docker, os testes ponta a ponta não rodam.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
export const PORTA = 8090; // a 8080 fica livre para o servidor de quem desenvolve
const BASE = `http://localhost:${PORTA}`;

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

/** O servidor está de pé, com o banco e o login (as migrações rodaram e o Google falso responde)? */
async function pronto(): Promise<boolean> {
  const eu = (await (await fetch(`${BASE}/api/eu`)).json()) as { login: string[] };
  return eu.login.includes('google');
}

export default async function preparar(): Promise<() => Promise<void>> {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 20_000 });
  } catch {
    throw new Error('Os testes ponta a ponta precisam do Docker ligado (o banco e o login de teste rodam nele).');
  }
  // Outro servidor já na 8090 (um rodado à mão, de outro código) faria os testes passarem contra ele, sem avisar.
  const ocupada = await fetch(`${BASE}/actuator/health`).then(() => true, () => false);
  if (ocupada) {
    throw new Error(`A porta ${PORTA} já está em uso: feche o servidor que está nela antes dos testes ponta a ponta.`);
  }
  const conteineres: string[] = [];
  let servidor: ChildProcess | undefined;
  const desmontar = async () => {
    if (servidor?.pid) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(servidor.pid), '/t', '/f'], { stdio: 'ignore' });
        else process.kill(-servidor.pid, 'SIGTERM');
      } catch {
        // já tinha saído
      }
    }
    for (const conteiner of conteineres) docker('stop', conteiner);
  };

  try {
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
    const log = openSync('test-results/servidor.log', 'w');
    const mvnw = join(RAIZ, windows ? 'mvnw.cmd' : 'mvnw');
    servidor = spawn(windows ? 'cmd' : mvnw, windows ? ['/c', mvnw, '-q', 'spring-boot:run'] : ['-q', 'spring-boot:run'], {
      cwd: RAIZ,
      detached: !windows, // no Linux, o grupo inteiro sai junto no fim (o Maven abre o Java como filho)
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        PORT: String(PORTA),
        OZAMIGOS_BANCO_URL: `jdbc:postgresql://localhost:${portaDe(banco, 5432)}/ozamigos`,
        OZAMIGOS_BANCO_USUARIO: 'ozamigos',
        OZAMIGOS_BANCO_SENHA: 'ozamigos-e2e',
        OZAMIGOS_GOOGLE_ID: 'ozamigos-e2e',
        OZAMIGOS_GOOGLE_SEGREDO: 'segredo-e2e',
        OZAMIGOS_GOOGLE_EMISSOR: emissor,
        // Os testes criam muitas contas seguidas: o teto de contas novas por hora é de quem usa de verdade.
        OZAMIGOS_CONTAS_NOVAS_POR_HORA: '100000',
      },
    });
    await esperar(pronto, 'o servidor com o banco e o login');
  } catch (erro) {
    await desmontar();
    throw erro;
  }
  return desmontar;
}
