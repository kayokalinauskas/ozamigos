// Testes de ponta a ponta: navegadores de verdade contra o servidor de verdade (npm run test:e2e).
// Antes, a interface precisa estar compilada (npm run build), porque quem a entrega é o servidor. O servidor, o banco
// e o login de teste sobem uma vez para todos (e2e/infra.ts), e precisam do Docker.
import { defineConfig } from '@playwright/test';
import { PORTA } from './e2e/infra';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // cada teste já abre vários navegadores; em paralelo, a máquina vira o gargalo
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalSetup: './e2e/infra.ts',
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
});
