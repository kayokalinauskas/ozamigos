import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle, RefreshCw, Server } from 'lucide-react';
import { cliente, codigoDe, codigoValido, novoCodigo } from '../cliente';
import { lembrado } from '../armazenamento';
import { ponte } from '../ponte';
import { useCliente } from '../useCliente';
import { Logo } from './Logo';

export function Entrada() {
  const { fase, erro, sala, meuNome } = useCliente();
  const [nome, setNome] = useState(meuNome);
  const [senha, setSenha] = useState(() => lembrado('ozamigos-senha'));
  const [textoDaSala, setTextoDaSala] = useState(sala);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const entrando = fase === 'entrando';
  const codigo = codigoDe(textoDaSala);
  const salaOk = codigoValido(codigo);

  function enviar(evento: FormEvent) {
    evento.preventDefault(); // o formulário não recarrega a página: quem entra é o JavaScript
    if (!salaOk) return;
    cliente.trocarSala(codigo);
    cliente.entrar(nome, senha);
  }

  return (
    <main className="entrada">
      <form className="cartao-entrada" onSubmit={enviar}>
        <Logo grande />
        <p className="subtitulo">Transmita seu jogo para os amigos em até 1080p, direto de um PC para o outro.</p>

        <label className="campo">
          <span>Seu nome</span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={20}
            autoComplete="nickname"
            placeholder="Como os amigos te chamam"
            required
            autoFocus={!nome}
          />
        </label>

        <label className="campo">
          <span>Senha do grupo</span>
          <span className="campo-com-botao">
            <input
              type={mostrarSenha ? 'text' : 'password'}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
              autoFocus={Boolean(nome)}
            />
            <button
              type="button"
              className="botao-icone"
              aria-label={mostrarSenha ? 'Esconder a senha' : 'Mostrar a senha'}
              onClick={() => setMostrarSenha(!mostrarSenha)}
            >
              {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>

        <label className="campo">
          <span>Sala</span>
          <span className="campo-com-botao">
            <input
              value={textoDaSala}
              onChange={(e) => setTextoDaSala(e.target.value)}
              aria-describedby="ajuda-sala"
              aria-invalid={!salaOk}
              spellCheck={false}
            />
            <button
              type="button"
              className="botao-icone"
              aria-label="Criar uma sala nova"
              title="Criar uma sala nova"
              onClick={() => setTextoDaSala(novoCodigo())}
            >
              <RefreshCw size={18} />
            </button>
          </span>
          <small id="ajuda-sala" className={salaOk ? 'ajuda' : 'ajuda ajuda-erro'}>
            {salaOk
              ? 'Cole o link ou o código que um amigo mandou, ou use este para criar uma sala nova.'
              : 'Cole o link da sala ou um código de 6 a 20 letras e números.'}
          </small>
        </label>

        {erro && (
          <p className="erro" role="alert">
            {erro}
          </p>
        )}

        <button type="submit" className="botao botao-primario botao-grande" disabled={entrando || !salaOk}>
          {entrando ? (
            <>
              <LoaderCircle size={18} className="girando" /> Entrando…
            </>
          ) : (
            'Entrar na sala'
          )}
        </button>

        {ponte && (
          <button type="button" className="botao botao-fantasma botao-pequeno trocar-servidor" onClick={() => ponte!.trocarServidor()}>
            <Server size={14} /> Servidor: {location.host}
          </button>
        )}
      </form>
    </main>
  );
}
