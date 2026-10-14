// Testes de ponta a ponta: navegadores de verdade contra o servidor de verdade (npm run test:e2e).
// Antes, a interface precisa estar compilada (npm run build), porque quem a entrega é o servidor.
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PORTA = 8090; // a 8080 fica livre para o servidor de quem desenvolve

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // cada teste já abre vários navegadores; em paralelo, a máquina vira o gargalo
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORTA}`,
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream', // microfone falso (um bipe)
        '--use-fake-ui-for-media-stream', // permissão do microfone sem perguntar
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: process.platform === 'win32' ? '.\\mvnw.cmd -q spring-boot:run' : './mvnw -q spring-boot:run',
    cwd: RAIZ,
    env: { PORT: String(PORTA), OZAMIGOS_SENHA: 'teste' },
    url: `http://localhost:${PORTA}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
