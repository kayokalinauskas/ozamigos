// Tela de início do app: pergunta o endereço do servidor e guarda.
const endereco = document.getElementById('endereco');
const erro = document.getElementById('erro');
const conectar = document.getElementById('conectar');

function mostrarErro(texto) {
  erro.textContent = texto ?? '';
  erro.hidden = !texto;
}

mostrarErro(new URLSearchParams(location.search).get('erro'));
window.ozamigos.servidorAtual().then((atual) => {
  if (atual && !endereco.value) endereco.value = atual;
});

document.getElementById('formulario').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  conectar.disabled = true;
  conectar.textContent = 'Conectando…';
  const problema = await window.ozamigos.salvarServidor(endereco.value);
  if (problema) {
    mostrarErro(problema);
    conectar.disabled = false;
    conectar.textContent = 'Conectar';
  }
});
