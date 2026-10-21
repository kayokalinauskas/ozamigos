import { useEffect, useState, type FormEvent } from 'react';
import { AppWindow, Download, Eye, EyeOff, LoaderCircle, Plus, RefreshCw, Server } from 'lucide-react';
import { ULTIMA_SALA, ULTIMO_GRUPO, cliente } from '../cliente';
import { codigoDe, codigoValido, grupoDe, grupoReservado, grupoValido, linkDoApp, nomeDeGrupo, novoCodigo } from '../conexao/codigoDaSala';
import { lembrado, lembrar } from '../armazenamento';
import { ponte } from '../ponte';
import { useCliente } from '../useCliente';
import { Convite, FICA_NO_NAVEGADOR, SITE } from './Convite';
import { Logo } from './Logo';
import { Versao } from './Versao';

/** No navegador do Windows, quem já tem o app pode abrir a sala nele (link ozamigos://, app 1.2.16 em diante). */
const NO_WINDOWS = /Windows/.test(navigator.userAgent);
/** O mesmo mínimo do servidor (Grupos.SENHA_MINIMA). */
const SENHA_MINIMA = 4;

export function Entrada() {
  const { sala, grupo, salaFixa } = useCliente();
  const [criando, setCriando] = useState(false);

  // No navegador do Windows, o link de uma sala pergunta antes se a pessoa quer abrir no app (Convite.tsx).
  const [convite, setConvite] = useState(() => !ponte && NO_WINDOWS && cliente.veioDeUmLink && !lembrado(FICA_NO_NAVEGADOR));

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

  return (
    <main className="entrada">
      {/* Criando, o grupo já está no estado enquanto o servidor responde: o formulário fica na tela (e com o que foi digitado). */}
      {criando ? (
        <CriarGrupo aoVoltar={() => setCriando(false)} />
      ) : grupo ? (
        <EntrarNoGrupo grupo={grupo} key={grupo} />
      ) : salaFixa ? (
        <EntrarNoGrupo grupo={sala} fixo />
      ) : (
        <EntrarNaSala aoCriarGrupo={() => setCriando(true)} />
      )}
    </main>
  );
}

/** A entrada do grupo fixo: a senha de sempre e o código da sala. */
function EntrarNaSala({ aoCriarGrupo }: { aoCriarGrupo: () => void }) {
  const { fase, erro, sala, meuNome } = useCliente();
  const [nome, setNome] = useState(meuNome);
  const [senha, setSenha] = useState(() => lembrado('ozamigos-senha'));
  const [textoDaSala, setTextoDaSala] = useState(sala);
  const [ultimaSala] = useState(() => lembrado(ULTIMA_SALA));
  const codigo = codigoDe(textoDaSala);
  const grupoColado = grupoDe(textoDaSala); // o link de um grupo, colado no campo da sala
  const salaOk = codigoValido(codigo) || grupoColado !== null;

  // Um convite (link ozamigos://) chegou com a entrada aberta: a sala dele vai para o campo.
  useEffect(() => setTextoDaSala(sala), [sala]);

  function enviar(evento: FormEvent) {
    evento.preventDefault(); // o formulário não recarrega a página: quem entra é o JavaScript
    if (grupoColado) {
      location.assign(`/${grupoColado}`); // a senha do grupo é outra: a entrada dele pede
      return;
    }
    if (!salaOk) return;
    cliente.trocarSala(codigo);
    cliente.entrar(nome, senha);
  }

  return (
    <form className="cartao-entrada" onSubmit={enviar}>
      <Logo grande />
      <p className="subtitulo">Transmita seu jogo e converse com os amigos.</p>

      <CampoDoNome nome={nome} setNome={setNome} />
      <CampoDaSenha rotulo="Senha do grupo" senha={senha} setSenha={setSenha} focar={Boolean(nome)} />

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
          {salaOk && codigo === ultimaSala
            ? 'A última sala em que você entrou. Para outra, cole o link ou o código que um amigo mandou, ou crie uma nova no botão ao lado.'
            : salaOk
            ? 'Cole o link ou o código que um amigo mandou, ou use este para criar uma sala nova.'
            : 'Cole o link da sala ou um código de 6 a 20 letras e números.'}
        </small>
      </label>

      <Erro erro={erro} />

      <BotaoDeEntrar entrando={fase === 'entrando'} desligado={!salaOk} texto={grupoColado ? 'Ir para o grupo' : 'Entrar na sala'} />
      <button type="button" className="botao botao-secundario" onClick={aoCriarGrupo}>
        <Plus size={16} /> Criar um grupo com outra senha
      </button>

      <Rodape codigo={codigoValido(codigo) ? codigo : null} />
    </form>
  );
}

/**
 * O endereço de um grupo criado na hora (/nome), ou o do grupo fixo (/ozamigos, `fixo`: a senha do servidor e sempre
 * a mesma sala): o nome da pessoa e a senha do grupo.
 */
function EntrarNoGrupo({ grupo, fixo = false }: { grupo: string; fixo?: boolean }) {
  const { fase, erro, recusa, meuNome } = useCliente();
  const [nome, setNome] = useState(meuNome);
  const [senha, setSenha] = useState(() => lembrado(cliente.chaveDaSenha(fixo ? null : grupo)));
  const entrando = fase === 'entrando';

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    cliente.entrar(nome, senha);
  }

  return (
    <form className="cartao-entrada" onSubmit={enviar}>
      <Logo grande />
      <p className="subtitulo">
        Grupo <strong>{grupo}</strong>
      </p>

      <CampoDoNome nome={nome} setNome={setNome} />
      <CampoDaSenha rotulo="Senha do grupo" senha={senha} setSenha={setSenha} focar={Boolean(nome)} />

      <Erro erro={erro} />

      {recusa === 'grupo-nao-existe' ? (
        <button
          type="button"
          className="botao botao-primario botao-grande"
          disabled={entrando || senha.length < SENHA_MINIMA || !nome.trim()}
          onClick={() => cliente.entrar(nome, senha, true)}
        >
          <Plus size={18} /> Criar o grupo de novo com esta senha
        </button>
      ) : (
        <BotaoDeEntrar entrando={entrando} desligado={false} texto="Entrar no grupo" />
      )}
      <a
        className="botao botao-fantasma botao-pequeno trocar-servidor"
        href="/"
        onClick={() => lembrar(ULTIMO_GRUPO, '')} // senão, a raiz voltaria direto para este grupo
      >
        Ir para a entrada do Ozamigos
      </a>

      <Rodape codigo={null} />
    </form>
  );
}

/** Criar um grupo com nome e senha próprios. Ele fica só enquanto é usado; depois, é só criar de novo. */
function CriarGrupo({ aoVoltar }: { aoVoltar: () => void }) {
  const { fase, erro, meuNome } = useCliente();
  const [textoDoGrupo, setTextoDoGrupo] = useState('');
  const [nome, setNome] = useState(meuNome);
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const grupo = nomeDeGrupo(textoDoGrupo);
  const grupoOk = grupoValido(grupo);
  const senhaOk = senha.length >= SENHA_MINIMA;
  const confere = senha === confirmacao;

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!grupoOk || !senhaOk || !confere) return;
    cliente.criarGrupo(grupo, nome, senha);
  }

  return (
    <form className="cartao-entrada" onSubmit={enviar}>
      <Logo grande />
      <p className="subtitulo">Crie um grupo com nome e senha seus, e mande o link para os amigos.</p>

      <label className="campo">
        <span>Nome do grupo</span>
        <input
          value={textoDoGrupo}
          onChange={(e) => setTextoDoGrupo(e.target.value)}
          maxLength={40}
          aria-describedby="ajuda-grupo"
          aria-invalid={textoDoGrupo !== '' && !grupoOk}
          spellCheck={false}
          autoFocus
          required
        />
        <small id="ajuda-grupo" className={textoDoGrupo === '' || grupoOk ? 'ajuda' : 'ajuda ajuda-erro'}>
          {grupoReservado(grupo)
            ? 'Esse nome é reservado. Escolha outro.'
            : textoDoGrupo === '' || !grupoOk
              ? 'De 3 a 32 letras, números e hífen.'
              : `O link: ${location.host}/${grupo}`}
        </small>
      </label>

      <CampoDoNome nome={nome} setNome={setNome} focar={false} />
      <CampoDaSenha rotulo="Senha do grupo" senha={senha} setSenha={setSenha} nova />
      <label className="campo">
        <span>Confirme a senha</span>
        <input
          type="password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          autoComplete="new-password"
          aria-invalid={confirmacao !== '' && !confere}
          required
        />
        <small className={confirmacao === '' || confere ? 'ajuda' : 'ajuda ajuda-erro'}>
          {confirmacao !== '' && !confere
            ? 'As senhas não são iguais.'
            : `Pelo menos ${SENHA_MINIMA} caracteres. O grupo não fica guardado para sempre: se ele sumir, é só criar de novo com a mesma senha.`}
        </small>
      </label>

      <Erro erro={erro} />

      <BotaoDeEntrar entrando={fase === 'entrando'} desligado={!grupoOk || !senhaOk || !confere} texto="Criar e entrar" />
      <button type="button" className="botao botao-fantasma botao-pequeno trocar-servidor" onClick={aoVoltar}>
        Voltar
      </button>
    </form>
  );
}

function CampoDoNome({ nome, setNome, focar = !nome }: { nome: string; setNome: (nome: string) => void; focar?: boolean }) {
  return (
    <label className="campo">
      <span>Seu nome</span>
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        maxLength={20}
        autoComplete="nickname"
        placeholder="Como os amigos te chamam"
        required
        autoFocus={focar}
      />
    </label>
  );
}

function CampoDaSenha({
  rotulo,
  senha,
  setSenha,
  focar = false,
  nova = false,
}: {
  rotulo: string;
  senha: string;
  setSenha: (senha: string) => void;
  focar?: boolean;
  nova?: boolean;
}) {
  const [mostrar, setMostrar] = useState(false);
  return (
    <label className="campo">
      <span>{rotulo}</span>
      <span className="campo-com-botao">
        <input
          type={mostrar ? 'text' : 'password'}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoComplete={nova ? 'new-password' : 'current-password'}
          required
          autoFocus={focar}
        />
        <button type="button" className="botao-icone" aria-label={mostrar ? 'Esconder a senha' : 'Mostrar a senha'} onClick={() => setMostrar(!mostrar)}>
          {mostrar ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}

function Erro({ erro }: { erro: string }) {
  if (!erro) return null;
  return (
    <p className="erro" role="alert">
      {erro}
    </p>
  );
}

function BotaoDeEntrar({ entrando, desligado, texto }: { entrando: boolean; desligado: boolean; texto: string }) {
  return (
    <button type="submit" className="botao botao-primario botao-grande" disabled={entrando || desligado}>
      {entrando ? (
        <>
          <LoaderCircle size={18} className="girando" /> Entrando…
        </>
      ) : (
        texto
      )}
    </button>
  );
}

/** O servidor (no app), o app (no navegador), a política de privacidade e a versão. */
function Rodape({ codigo }: { codigo: string | null }) {
  return (
    <>
      {ponte ? (
        <button type="button" className="botao botao-fantasma botao-pequeno trocar-servidor" onClick={() => ponte!.trocarServidor()}>
          <Server size={14} /> Servidor: {location.host}
        </button>
      ) : (
        <>
          {NO_WINDOWS && codigo && (
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
    </>
  );
}
