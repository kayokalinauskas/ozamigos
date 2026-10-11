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
  server: {
    proxy: {
      '/sinal': { target: servidorJava, ws: true, changeOrigin: true },
    },
  },
});
