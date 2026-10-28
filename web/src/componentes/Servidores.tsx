import { useEffect, useState } from 'react';
import { LoaderCircle, Plus, Users } from 'lucide-react';
import { cliente } from '../cliente';
import { useConta } from '../conta';
import { servidores, useServidor, type PreviaDoConvite, type ResumoDoServidor } from '../servidores';
import { useCliente } from '../useCliente';
import { Avatar } from './Avatar';
import { ContaNaEntrada } from './Conta';
import { Logo } from './Logo';
import { RodapeDaEntrada } from './RodapeDaEntrada';

const membros = (n: number) => (n === 1 ? '1 membro' : `${n} membros`);

/**
 * Na entrada, para quem tem conta: os servidores de que ela é membro (o que entrou por último primeiro) e criar um novo.
 * Um clique entra na sala do servidor, sem senha.
 */
export function MeusServidores() {
  const { conta } = useConta();
  const { fase } = useCliente();
  const [lista, setLista] = useState<ResumoDoServidor[] | null>(null);
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const idDaConta = conta?.id;

  useEffect(() => {
    if (!idDaConta) return;
    void servidores.meus().then((lido) => (lido.ok ? setLista(lido.valor.servidores) : setErro(lido.erro)));
  }, [idDaConta]);

  async function criar() {
    if (!nome.trim() || salvando) return;
    setSalvando(true);
    const criado = await servidores.criar(nome);
    setSalvando(false);
    if (!criado.ok) {
      setErro(criado.erro);
      return;
    }
    cliente.entrarNoServidor(criado.valor.codigo);
  }

  if (!conta) return null;
  return (
    <section className="meus-servidores" aria-labelledby="titulo-meus-servidores">
      <h2 id="titulo-meus-servidores" className="rotulo">
        Seus servidores
      </h2>
      {lista === null && !erro ? (
        <p className="ajuda">
          <LoaderCircle size={14} className="girando" /> Carregando…
        </p>
      ) : lista && lista.length > 0 ? (
        <ul className="lista-de-servidores">
          {lista.map((s) => (
            <li key={s.codigo}>
              <button type="button" className="servidor-item" disabled={fase !== 'entrada'} onClick={() => cliente.entrarNoServidor(s.codigo)}>
                <Avatar nome={s.nome} foto={s.icone} tamanho={40} quadrado />
                <span className="servidor-item-texto">
                  <strong>{s.nome}</strong>
                  <small>{membros(s.membros)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        lista && <p className="ajuda">Você ainda não está em nenhum servidor. Crie um para o seu grupo, ou peça um convite a um amigo.</p>
      )}
      {criando ? (
        <label className="campo">
          <span>Nome do servidor</span>
          <span className="conta-perfil-nome">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void criar();
                }
              }}
              maxLength={40}
              placeholder="Os amigos do jogo"
              autoFocus
            />
            <button type="button" className="botao botao-primario" disabled={!nome.trim() || salvando} onClick={() => void criar()}>
              {salvando ? <LoaderCircle size={16} className="girando" /> : 'Criar'}
            </button>
          </span>
        </label>
      ) : (
        <button type="button" className="botao botao-secundario" onClick={() => setCriando(true)}>
          <Plus size={16} /> Criar um servidor
        </button>
      )}
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}

/** A página de um servidor salvo (/s/<codigo>): quem entra é a conta, sem senha. */
export function EntrarNoServidor({ codigo }: { codigo: string }) {
  const { carregada, conta } = useConta();
  const { fase, erro } = useCliente();
  const { servidor, erro: erroDoServidor } = useServidor(conta ? codigo : null);
  const entrando = fase === 'entrando';

  return (
    <div className="cartao-entrada">
      <Logo grande />
      {servidor ? (
        <div className="servidor-titulo">
          <Avatar nome={servidor.nome} foto={servidor.icone} tamanho={56} quadrado />
          <span className="servidor-titulo-texto">
            <strong>{servidor.nome}</strong>
            <small className="ajuda">{membros(servidor.membros.length)}</small>
          </span>
        </div>
      ) : (
        <p className="subtitulo">Um servidor do Ozamigos.</p>
      )}

      {!carregada ? (
        <p className="ajuda">
          <LoaderCircle size={14} className="girando" /> Carregando…
        </p>
      ) : (
        <ContaNaEntrada />
      )}

      {(erro || (conta && erroDoServidor)) && (
        <p className="erro" role="alert">
          {erro || erroDoServidor}
        </p>
      )}

      <button
        type="button"
        className="botao botao-primario botao-grande"
        disabled={!conta || !servidor || entrando}
        onClick={() => cliente.entrarNoServidor(codigo)}
      >
        {entrando ? (
          <>
            <LoaderCircle size={18} className="girando" /> Entrando…
          </>
        ) : (
          'Entrar no servidor'
        )}
      </button>
      <a className="botao botao-fantasma botao-pequeno trocar-servidor" href="/">
        {conta ? 'Ver todos os seus servidores' : 'Ir para a entrada do Ozamigos'}
      </a>
      <RodapeDaEntrada />
    </div>
  );
}

/** Um convite (/c/<codigo>): o servidor, e aceitar. Sem conta, pede o login antes; a volta do login é esta página. */
export function AceitarConvite({ convite }: { convite: string }) {
  const { carregada, conta } = useConta();
  const [previa, setPrevia] = useState<PreviaDoConvite | null>(null);
  const [erro, setErro] = useState('');
  const [aceitando, setAceitando] = useState(false);

  useEffect(() => {
    void servidores.previa(convite).then((lida) => (lida.ok ? setPrevia(lida.valor) : setErro(lida.erro)));
  }, [convite]);

  async function aceitar() {
    setAceitando(true);
    const aceito = await servidores.aceitar(convite);
    if (!aceito.ok) {
      setAceitando(false);
      setErro(aceito.erro);
      return;
    }
    cliente.entrarNoServidor(aceito.valor.servidor);
  }

  return (
    <div className="cartao-entrada">
      <Logo grande />
      {previa ? (
        <>
          <p className="subtitulo">Você foi convidado para um servidor:</p>
          <div className="servidor-titulo">
            <Avatar nome={previa.nome} foto={previa.icone} tamanho={56} quadrado />
            <span className="servidor-titulo-texto">
              <strong>{previa.nome}</strong>
              <small className="ajuda">
                <Users size={12} aria-hidden="true" /> {membros(previa.membros)}
              </small>
            </span>
          </div>
        </>
      ) : (
        !erro && (
          <p className="ajuda">
            <LoaderCircle size={14} className="girando" /> Abrindo o convite…
          </p>
        )
      )}

      {previa && carregada && <ContaNaEntrada />}

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      {previa && conta && (
        <button type="button" className="botao botao-primario botao-grande" disabled={aceitando} onClick={() => void aceitar()}>
          {aceitando ? <LoaderCircle size={18} className="girando" /> : 'Aceitar e entrar'}
        </button>
      )}
      <a className="botao botao-fantasma botao-pequeno trocar-servidor" href="/">
        Ir para a entrada do Ozamigos
      </a>
      <RodapeDaEntrada />
    </div>
  );
}
