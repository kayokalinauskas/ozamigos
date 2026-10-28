import { useState, type FormEvent, type ReactNode } from 'react';
import { LoaderCircle, LogIn, LogOut, Trash2 } from 'lucide-react';
import { cliente } from '../cliente';
import {
  NOME_DO_PROVEDOR,
  apagarConta,
  desligar,
  entrarCom,
  ligar,
  renomear,
  sairDaConta,
  useConta,
  type Provedor,
} from '../conta';
import { noApp, ponte } from '../ponte';
import { useCliente } from '../useCliente';
import { Avatar } from './Avatar';

/** O que a conta traz, dito uma vez, onde a pessoa decide. */
const VANTAGEM = 'Com a conta, o seu nome e a sua foto aparecem na sala, e a conversa funciona mesmo em redes mais fechadas.';

/**
 * "Entrar com Google" e "Entrar com Discord" (os que o servidor tiver). No app, o login abre no navegador do sistema;
 * dando certo numa sala aberta, a conexão com o servidor é refeita para a conta valer na hora.
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
          className="botao botao-secundario botao-login"
          disabled={ocupada}
          onClick={() => void entrar(provedor)}
        >
          {qual === provedor ? <LoaderCircle size={16} className="girando" /> : <LogIn size={16} />}
          Entrar com {NOME_DO_PROVEDOR[provedor]}
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
 * Na entrada: com conta, quem está entrando (o nome é o dela, mudado na engrenagem); sem conta, os botões de login e,
 * embaixo, o campo do nome de sempre, para entrar como convidado.
 */
export function ContaNaEntrada({ campoDoNome }: { campoDoNome: ReactNode }) {
  const { carregada, login, conta, ocupada } = useConta();

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
    <>
      {carregada && login.length > 0 && (
        <div className="conta-convite">
          <BotoesDeLogin />
          <p className="ajuda">{VANTAGEM}</p>
          <div className="separador-ou" role="separator">
            <span>ou entre como convidado</span>
          </div>
        </div>
      )}
      <ErroDaConta />
      {campoDoNome}
    </>
  );
}

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
            <p className="ajuda">Entre com o Google ou o Discord. {VANTAGEM}</p>
            <BotoesDeLogin />
          </>
        ) : (
          <p className="ajuda">
            {noApp && !ponte?.conta
              ? 'Para entrar com uma conta, atualize o Ozamigos: feche e abra o app de novo.'
              : 'Entrar com uma conta não está disponível agora. Você continua usando o Ozamigos como convidado.'}
          </p>
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
        <p className="ajuda">Sai da conta neste aparelho. Nos outros, ela continua.</p>
        <BotaoSair />
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
    cliente.renovarConexao(); // numa sala, os amigos já veem o nome novo
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
          <small className="ajuda">{salvo ? 'Nome salvo.' : 'A foto é a do seu Google ou Discord.'}</small>
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

function ApagarConta() {
  const { ocupada } = useConta();
  const { fase } = useCliente();
  const [confirmando, setConfirmando] = useState(false);

  return (
    <section className="configuracoes-secao" aria-labelledby="titulo-apagar">
      <h3 id="titulo-apagar">Apagar a conta</h3>
      <p className="ajuda">
        Apaga na hora tudo o que o Ozamigos guarda da sua conta: o nome, a foto e as formas de entrar. Não tem como desfazer.
        {fase === 'sala' && ' Você continua na sala, como convidado.'}
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
