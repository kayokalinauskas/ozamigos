import { useState, type FormEvent } from 'react';
import { LoaderCircle, LogOut, Trash2 } from 'lucide-react';
import '@fontsource/google-sans/500.css'; // a fonte do botão do Google, pela diretriz de marca dele
import { cliente } from '../cliente';
import {
  NOME_DO_PROVEDOR,
  apagarConta,
  desligar,
  entrarCom,
  ligar,
  renomear,
  sairDaConta,
  sairDeTodos,
  useConta,
  type Provedor,
} from '../conta';
import { noApp, ponte } from '../ponte';
import { useCliente } from '../useCliente';
import { Avatar } from './Avatar';

/** Por que entrar, dito uma vez, onde a pessoa decide. Sem senha nem cadastro: a conta é a do Google ou a do Discord. */
const PARA_QUE = 'Entre com o Google ou o Discord para ver os seus servidores, criar um e entrar nos convites dos amigos.';

/**
 * Os botões de cada provedor seguem a marca dele, com o logo oficial (web/public/marcas, sem redesenhar nem mudar a cor):
 * o do Google pela diretriz do Google Identity (tema escuro: fundo #131314, borda #8E918F, texto #E3E3E3, Google Sans
 * 500 14/20, 12 px antes do logo, 10 depois, 12 no fim) e com um texto que ela aceita ("Continuar com o Google"); o do
 * Discord no Blurple (#5865F2) com o símbolo branco. Mudar o texto ou as cores do Google pode custar a aprovação dele.
 */
const MARCA: Record<Provedor, { logo: string; texto: string }> = {
  google: { logo: '/marcas/google.svg', texto: 'Continuar com o Google' },
  discord: { logo: '/marcas/discord.svg', texto: 'Continuar com o Discord' },
};

/**
 * Os botões de login (os que o servidor tiver). No app, o login abre no navegador do sistema; dando certo numa sala
 * aberta, a conexão com o servidor é refeita para a conta valer na hora.
 */
export function BotoesDeLogin() {
  const { login, ocupada } = useConta();
  const [qual, setQual] = useState<Provedor | null>(null);

  async function entrar(provedor: Provedor) {
    setQual(provedor);
    const continuaAqui = await entrarCom(provedor);
    setQual(null);
    if (continuaAqui) cliente.renovarConexao();
  }

  return (
    <div className="botoes-de-login">
      {login.map((provedor) => (
        <button
          key={provedor}
          type="button"
          className={`botao-login botao-login-${provedor}`}
          // No app, clicar de novo vale: o login novo cancela o que ficou esperando no navegador (a aba fechada).
          disabled={ocupada && !noApp}
          onClick={() => void entrar(provedor)}
        >
          {qual === provedor ? (
            <LoaderCircle size={20} className="girando" aria-hidden="true" />
          ) : (
            <img src={MARCA[provedor].logo} alt="" width={provedor === 'google' ? 20 : 22} height={provedor === 'google' ? 20 : 17} draggable={false} />
          )}
          <span>{MARCA[provedor].texto}</span>
        </button>
      ))}
      {noApp && qual && <p className="ajuda">Continue no navegador que abriu. Depois, é só voltar para cá.</p>}
    </div>
  );
}

/** O aviso de erro da conta (um login que não terminou, uma ação recusada). */
export function ErroDaConta() {
  const { erro } = useConta();
  if (!erro) return null;
  return (
    <p className="erro" role="alert">
      {erro}
    </p>
  );
}

/**
 * Na entrada: com conta, quem está entrando (o nome é o dela, mudado na engrenagem); sem conta, os botões de login. Não
 * há convidado: as salas são as dos servidores, só para quem tem conta (decisão do dono, 28/10/2026).
 */
export function ContaNaEntrada() {
  const { login, conta, ocupada } = useConta();

  if (conta) {
    return (
      <div className="conta-na-entrada">
        <Avatar nome={conta.nome} foto={conta.foto} tamanho={40} />
        <span className="conta-na-entrada-texto">
          <small>Entrando como</small>
          <strong>{conta.nome}</strong>
        </span>
        <button type="button" className="botao botao-fantasma botao-pequeno" disabled={ocupada} onClick={() => void sairDaConta()}>
          Sair da conta
        </button>
      </div>
    );
  }
  return (
    <div className="conta-convite">
      {login.length > 0 ? (
        <>
          <p className="ajuda">{PARA_QUE}</p>
          <BotoesDeLogin />
        </>
      ) : (
        <p className="ajuda">{SEM_LOGIN}</p>
      )}
      <ErroDaConta />
    </div>
  );
}

/** Sem os botões: um app de antes da 1.3.0 (sem o login pelo navegador), ou o banco fora do ar. */
const SEM_LOGIN =
  noApp && !ponte?.conta
    ? 'Para entrar com a sua conta, atualize o Ozamigos: feche e abra o app de novo.'
    : 'Entrar com a conta não está disponível agora. Tente de novo daqui a pouco.';

/** Configurações → Conta: o perfil, as formas de entrar, sair e apagar a conta. */
export function AbaDaConta() {
  const { carregada, login, conta } = useConta();

  if (!carregada) {
    return (
      <p className="ajuda">
        <LoaderCircle size={14} className="girando" /> Carregando…
      </p>
    );
  }
  if (!conta) {
    return (
      <section className="configuracoes-secao" aria-labelledby="titulo-conta">
        <h3 id="titulo-conta">Conta</h3>
        {login.length > 0 ? (
          <>
            <p className="ajuda">{PARA_QUE}</p>
            <BotoesDeLogin />
          </>
        ) : (
          <p className="ajuda">{SEM_LOGIN}</p>
        )}
        <ErroDaConta />
      </section>
    );
  }
  return (
    <>
      <ErroDaConta />
      <Perfil />
      <FormasDeEntrar />
      <section className="configuracoes-secao" aria-labelledby="titulo-sair">
        <h3 id="titulo-sair">Sair</h3>
        <p className="ajuda">
          Sai da conta neste aparelho. Nos outros, ela continua. Perdeu um aparelho ou entrou num PC de outra pessoa? Saia
          de todos de uma vez.
        </p>
        <div className="configuracoes-linha">
          <BotaoSair />
          <BotaoSairDeTodos />
        </div>
      </section>
      <ApagarConta />
    </>
  );
}

function Perfil() {
  const { conta, ocupada } = useConta();
  const [nome, setNome] = useState(conta!.nome);
  const [salvo, setSalvo] = useState(false);
  const mudou = nome.trim() !== '' && nome.trim() !== conta!.nome;

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!mudou) return;
    const novo = await renomear(nome);
    if (novo === null) return;
    setNome(novo);
    setSalvo(true);
  }

  return (
    <section className="configuracoes-secao" aria-labelledby="titulo-perfil">
      <h3 id="titulo-perfil">Perfil</h3>
      <form className="conta-perfil" onSubmit={(e) => void salvar(e)}>
        <Avatar nome={conta!.nome} foto={conta!.foto} tamanho={56} />
        <label className="campo">
          <span>Nome na sala</span>
          <span className="conta-perfil-nome">
            <input
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setSalvo(false);
              }}
              maxLength={20}
              autoComplete="nickname"
              required
            />
            <button type="submit" className="botao botao-secundario" disabled={!mudou || ocupada}>
              Salvar
            </button>
          </span>
          <small className="ajuda">
            {salvo ? 'Nome salvo. Os amigos veem o nome novo na próxima vez que você entrar numa sala.' : 'A foto é a do seu Google ou Discord.'}
          </small>
        </label>
      </form>
    </section>
  );
}

function FormasDeEntrar() {
  const { conta, login, ocupada } = useConta();
  const provedores = [...new Set<Provedor>([...login, ...conta!.provedores])];
  const ligados = conta!.provedores;

  return (
    <section className="configuracoes-secao" aria-labelledby="titulo-formas">
      <h3 id="titulo-formas">Formas de entrar</h3>
      <ul className="formas-de-entrar">
        {provedores.map((provedor) => {
          const ligado = ligados.includes(provedor);
          return (
            <li key={provedor} className="configuracoes-linha">
              <span>
                {NOME_DO_PROVEDOR[provedor]} <small className="ajuda">{ligado ? 'ligado' : 'não ligado'}</small>
              </span>
              {ligado ? (
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  disabled={ocupada || ligados.length === 1}
                  title={ligados.length === 1 ? 'A conta precisa de pelo menos uma forma de entrar' : undefined}
                  onClick={() => void desligar(provedor)}
                >
                  Desligar
                </button>
              ) : (
                login.includes(provedor) && (
                  <button type="button" className="botao botao-secundario botao-pequeno" disabled={ocupada} onClick={() => void ligar(provedor)}>
                    Ligar
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BotaoSair() {
  const { ocupada } = useConta();
  return (
    <button
      type="button"
      className="botao botao-secundario"
      disabled={ocupada}
      onClick={() => void sairDaConta().then((saiu) => saiu && cliente.renovarConexao())}
    >
      <LogOut size={16} /> Sair da conta
    </button>
  );
}

function BotaoSairDeTodos() {
  const { ocupada } = useConta();
  return (
    <button
      type="button"
      className="botao botao-fantasma"
      disabled={ocupada}
      onClick={() => void sairDeTodos().then((saiu) => saiu && cliente.renovarConexao())}
    >
      Sair de todos os aparelhos
    </button>
  );
}

function ApagarConta() {
  const { ocupada } = useConta();
  const { fase } = useCliente();
  const [confirmando, setConfirmando] = useState(false);

  return (
    <section className="configuracoes-secao" aria-labelledby="titulo-apagar">
      <h3 id="titulo-apagar">Apagar a conta</h3>
      <p className="ajuda">
        Apaga na hora tudo o que o Ozamigos guarda da sua conta: o nome, a foto, as formas de entrar e o seu lugar nos
        servidores (os de que você é dono passam para outra pessoa). Não tem como desfazer.
        {fase === 'sala' && ' Você sai da sala.'}
      </p>
      {confirmando ? (
        <div className="configuracoes-linha">
          <button
            type="button"
            className="botao botao-perigo"
            disabled={ocupada}
            onClick={() => void apagarConta().then((apagou) => apagou && cliente.renovarConexao())}
          >
            <Trash2 size={16} /> Apagar para sempre
          </button>
          <button type="button" className="botao botao-fantasma" onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" className="botao botao-perigo" onClick={() => setConfirmando(true)}>
          <Trash2 size={16} /> Apagar a minha conta
        </button>
      )}
    </section>
  );
}
