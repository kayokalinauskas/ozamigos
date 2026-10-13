import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import './estilo.css';
import { App } from './componentes/App';
import { ouvirPedidosDeMedidas } from './desempenho/amigos';

// Quem transmite pode pedir as medidas de recepção deste PC num teste de desempenho com os amigos.
ouvirPedidosDeMedidas();

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
