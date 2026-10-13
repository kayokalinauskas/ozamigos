/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O build vai direto para a pasta que o Spring serve: o servidor Java entrega a interface pronta.
// Em desenvolvimento (npm run dev), o Vite repassa o WebSocket /sinal para o servidor Java.
const servidorJava = process.env.OZAMIGOS_SERVIDOR ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
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
