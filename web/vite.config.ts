/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// O build vai direto para a pasta que o Spring serve: o servidor Java entrega a interface pronta.
// Em desenvolvimento (npm run dev), o Vite repassa o WebSocket /sinal para o servidor Java.
const servidorJava = process.env.OZAMIGOS_SERVIDOR ?? 'http://localhost:8080';

/**
 * O commit de onde a interface saiu, para aparecer ao lado da versão (componentes/Versao.tsx). Um deploy do Render já
 * saiu com a interface antiga dentro, e o painel dizia "Live": com o commit na tela, isso se vê na hora.
 * No Render, vem de RENDER_GIT_COMMIT (o Dockerfile o recebe como ARG); no PC, do git. Sem nenhum dos dois, fica vazio.
 */
function commitDaInterface(): string {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __COMMIT__: JSON.stringify(commitDaInterface()) },
  build: {
    outDir: '../src/main/resources/static',
    emptyOutDir: true,
  },
  // Testes (npm test): o cliente usa location, localStorage e crypto, então rodam num DOM simulado.
  test: {
    environment: 'happy-dom',
  },
  server: {
    proxy: {
      // O Spring só aceita o WebSocket de páginas do próprio servidor: a origem vai como se fosse a dele.
      '/sinal': { target: servidorJava, ws: true, changeOrigin: true, headers: { origin: servidorJava } },
    },
  },
});
