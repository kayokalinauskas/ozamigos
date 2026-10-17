// Tela de início do app: pergunta o endereço do servidor e guarda.
const endereco = document.getElementById('endereco');
const erro = document.getElementById('erro');
const conectar = document.getElementById('conectar');

function mostrarErro(texto) {
  erro.textContent = texto ?? '';
  erro.hidden = !texto;
}

const parametros = new URLSearchParams(location.search);
mostrarErro(parametros.get('erro'));

// Acordando o servidor: o main.js abre esta tela quando o servidor demora a responder, e troca pela sala quando
// ele acorda. "Trocar o servidor" para a espera e mostra o formulário.
const acordando = parametros.get('acordando');
if (acordando) {
  const formulario = document.getElementById('formulario');
  const tela = document.getElementById('acordando');
  const segundos = document.getElementById('segundos');
  formulario.hidden = true;
  tela.hidden = false;
  document.getElementById('servidor').textContent = acordando;
  const comeco = Number(parametros.get('desde')) || Date.now(); // a espera começou um pouco antes desta tela
  const contar = () => (segundos.textContent = String(Math.floor((Date.now() - comeco) / 1000)));
  contar();
  const relogio = setInterval(contar, 1000);
  document.getElementById('outro-servidor').addEventListener('click', () => {
    clearInterval(relogio);
    window.ozamigos.pararDeEsperar();
    tela.hidden = true;
    formulario.hidden = false;
    endereco.focus();
  });
}
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
