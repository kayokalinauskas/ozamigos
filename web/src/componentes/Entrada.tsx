import { useEffect, useState, type FormEvent } from 'react';
import { AppWindow, Download, Eye, EyeOff, LoaderCircle, RefreshCw, Server } from 'lucide-react';
import { cliente } from '../cliente';
import { codigoDe, codigoValido, linkDoApp, novoCodigo } from '../conexao/codigoDaSala';
import { lembrado, lembrar } from '../armazenamento';
import { ponte } from '../ponte';
import { useCliente } from '../useCliente';
import { Convite, FICA_NO_NAVEGADOR, SITE } from './Convite';
import { Logo } from './Logo';
import { Versao } from './Versao';

/** No navegador do Windows, quem já tem o app pode abrir a sala nele (link ozamigos://, app 1.2.16 em diante). */
const NO_WINDOWS = /Windows/.test(navigator.userAgent);

export function Entrada() {
  const { fase, erro, sala, meuNome } = useCliente();
  const [nome, setNome] = useState(meuNome);
  const [senha, setSenha] = useState(() => lembrado('ozamigos-senha'));
  const [textoDaSala, setTextoDaSala] = useState(sala);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const entrando = fase === 'entrando';
  const codigo = codigoDe(textoDaSala);
  const salaOk = codigoValido(codigo);

  // No navegador do Windows, o link de uma sala pergunta antes se a pessoa quer abrir no app (Convite.tsx).
  const [convite, setConvite] = useState(() => !ponte && NO_WINDOWS && cliente.veioDeUmLink && !lembrado(FICA_NO_NAVEGADOR));

  // Um convite (link ozamigos://) chegou com a entrada aberta: a sala dele vai para o campo.
  useEffect(() => setTextoDaSala(sala), [sala]);

  if (convite) {
    return (
      <main className="entrada">
        <div className="cartao-entrada">
          <Logo grande />
          <Convite sala={sala} aoContinuar={() => setConvite(false)} />
          <Versao />
        </div>
      </main>
    );
  }

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
        <p className="subtitulo">Transmita seu jogo e converse com os amigos.</p>

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

        {ponte ? (
          <button type="button" className="botao botao-fantasma botao-pequeno trocar-servidor" onClick={() => ponte!.trocarServidor()}>
            <Server size={14} /> Servidor: {location.host}
          </button>
        ) : (
          <>
            {NO_WINDOWS && salaOk && (
              <a
                className="botao botao-fantasma botao-pequeno trocar-servidor"
                href={linkDoApp(codigo)}
                onClick={() => lembrar(FICA_NO_NAVEGADOR, '')} // voltou a querer o app: o próximo link pergunta de novo
              >
                <AppWindow size={14} /> Já tem o app? Abrir esta sala nele
              </a>
            )}
            <a className="botao botao-fantasma botao-pequeno trocar-servidor" href={SITE}>
              <Download size={14} /> Baixar o app para Windows (som do jogo sem eco)
            </a>
          </>
        )}
        {/* Onde o nome é pedido, o link para a política (LGPD: a pessoa sabe como os dados são tratados). */}
        <a className="entrada-privacidade" href={`${SITE}privacidade.html`} target="_blank" rel="noopener noreferrer">
          Política de privacidade
        </a>
        <Versao />
      </form>
    </main>
  );
}
