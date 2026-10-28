import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Check, Copy, Crown, LogOut, Shield, Trash2, X } from 'lucide-react';
import { cliente } from '../cliente';
import { linkDoConvite } from '../conexao/codigoDaSala';
import { useConta } from '../conta';
import { pode, servidores, type Bloqueado, type Convite, type Membro, type Papel, type Servidor } from '../servidores';
import { Avatar } from './Avatar';

const NOME_DO_PAPEL: Record<Papel, string> = { dono: 'Dono', admin: 'Admin', membro: 'Membro' };

const VALIDADES: { horas: number | null; texto: string }[] = [
  { horas: 1, texto: '1 hora' },
  { horas: 24, texto: '1 dia' },
  { horas: 24 * 7, texto: '7 dias' },
  { horas: 24 * 30, texto: '30 dias' },
  { horas: null, texto: 'Nunca' },
];
const USOS: (number | null)[] = [null, 1, 5, 10, 25, 100];

type Props = { servidor: Servidor; aoMudar: (servidor: Servidor) => void; aoFechar: () => void };

/**
 * As configurações de um servidor salvo, para quem é membro: cada um vê só o que o papel deixa fazer (pode, em
 * servidores.ts; quem confere de verdade é o servidor). Sair, expulsar e apagar tiram da sala na hora, pelo servidor.
 */
export function ConfiguracoesDoServidor({ servidor, aoMudar, aoFechar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const permite = pode(servidor);
  const abas = [
    { id: 'geral', titulo: 'Geral' },
    { id: 'membros', titulo: 'Membros' },
    ...(permite.convidar ? [{ id: 'convites', titulo: 'Convites' }] : []),
    ...(permite.cuidarDosConvites ? [{ id: 'bloqueados', titulo: 'Bloqueados' }] : []),
  ];
  const [aba, setAba] = useState('geral');
  const [erro, setErro] = useState('');

  useEffect(() => {
    dialogo.current?.showModal();
    // O servidor de quando a sala abriu pode estar velho (quem entrou depois, um papel que mudou): lê de novo.
    void servidores.ver(servidor.codigo).then((lido) => lido.ok && aoMudar(lido.valor));
  }, []); // uma vez, ao abrir

  /** Roda uma ação da API; a recusa vira o aviso no topo. Resolve true se deu certo. */
  async function fazer<T>(acao: Promise<{ ok: true; valor: T } | { ok: false; erro: string }>, aoDarCerto?: (valor: T) => void) {
    setErro('');
    const feito = await acao;
    if (!feito.ok) {
      setErro(feito.erro);
      return false;
    }
    aoDarCerto?.(feito.valor);
    return true;
  }

  return (
    <dialog ref={dialogo} className="seletor configuracoes" aria-labelledby="titulo-do-servidor" onClose={aoFechar}>
      <header>
        <h2 id="titulo-do-servidor">{servidor.nome}</h2>
        <button type="button" className="botao-icone" aria-label="Fechar" onClick={() => dialogo.current?.close()}>
          <X size={18} />
        </button>
      </header>
      <div className="segmentado configuracoes-abas" role="tablist" aria-label="Seções do servidor">
        {abas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>
            {a.titulo}
          </button>
        ))}
      </div>
      <div className="configuracoes-corpo" role="tabpanel">
        {erro && (
          <p className="configuracoes-alerta" role="alert">
            {erro}
          </p>
        )}
        {aba === 'geral' && <AbaGeral servidor={servidor} aoMudar={aoMudar} fazer={fazer} fechar={() => dialogo.current?.close()} />}
        {aba === 'membros' && <AbaDeMembros servidor={servidor} aoMudar={aoMudar} fazer={fazer} />}
        {aba === 'convites' && <AbaDeConvites servidor={servidor} fazer={fazer} />}
        {aba === 'bloqueados' && <AbaDeBloqueados servidor={servidor} fazer={fazer} />}
      </div>
    </dialog>
  );
}

type Fazer = <T>(acao: Promise<{ ok: true; valor: T } | { ok: false; erro: string }>, aoDarCerto?: (valor: T) => void) => Promise<boolean>;

function AbaGeral({ servidor, aoMudar, fazer, fechar }: { servidor: Servidor; aoMudar: (s: Servidor) => void; fazer: Fazer; fechar: () => void }) {
  const { conta } = useConta();
  const permite = pode(servidor);
  const [nome, setNome] = useState(servidor.nome);
  const [confirmando, setConfirmando] = useState<'sair' | 'apagar' | null>(null);
  const mudou = nome.trim() !== '' && nome.trim() !== servidor.nome;

  function salvarNome(evento: FormEvent) {
    evento.preventDefault();
    if (mudou) void fazer(servidores.mudar(servidor.codigo, { nome }), aoMudar);
  }

  function trocarIcone(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    evento.target.value = ''; // escolher a mesma imagem de novo também vale
    if (arquivo) void fazer(servidores.trocarIcone(servidor.codigo, arquivo), ({ icone }) => aoMudar({ ...servidor, icone }));
  }

  return (
    <>
      {permite.mudarNomeEIcone && (
        <section className="configuracoes-secao" aria-labelledby="titulo-perfil-do-servidor">
          <h3 id="titulo-perfil-do-servidor">Nome e ícone</h3>
          <form className="conta-perfil" onSubmit={salvarNome}>
            <Avatar nome={servidor.nome} foto={servidor.icone} tamanho={56} quadrado />
            <label className="campo">
              <span>Nome do servidor</span>
              <span className="conta-perfil-nome">
                <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} required />
                <button type="submit" className="botao botao-secundario" disabled={!mudou}>
                  Salvar
                </button>
              </span>
            </label>
          </form>
          <div className="configuracoes-linha">
            <label className="botao botao-secundario botao-pequeno">
              Trocar o ícone
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={trocarIcone} />
            </label>
            {servidor.icone && (
              <button
                type="button"
                className="botao botao-fantasma botao-pequeno"
                onClick={() => void fazer(servidores.tirarIcone(servidor.codigo), () => aoMudar({ ...servidor, icone: null }))}
              >
                Tirar o ícone
              </button>
            )}
          </div>
        </section>
      )}

      {permite.decidirSeMembrosConvidam && (
        <section className="configuracoes-secao" aria-labelledby="titulo-quem-convida">
          <h3 id="titulo-quem-convida">Quem convida</h3>
          <label className="configuracoes-linha">
            <span>Membros também podem convidar</span>
            <input
              type="checkbox"
              checked={servidor.membrosConvidam}
              onChange={(e) => void fazer(servidores.mudar(servidor.codigo, { membrosConvidam: e.target.checked }), aoMudar)}
            />
          </label>
          <p className="ajuda">O dono e os admins sempre podem.</p>
        </section>
      )}

      {(permite.sair || permite.apagar) && (
        <section className="configuracoes-secao" aria-labelledby="titulo-sair-do-servidor">
          <h3 id="titulo-sair-do-servidor">{permite.apagar ? 'Apagar o servidor' : 'Sair do servidor'}</h3>
          <p className="ajuda">
            {permite.apagar
              ? 'Apaga o servidor para todos, com os membros e os convites. Não tem como desfazer. Para sair sem apagar, passe a posse a outra pessoa, em Membros.'
              : 'Você sai da sala agora e só volta com um convite novo.'}
          </p>
          {confirmando ? (
            <div className="configuracoes-linha">
              <button
                type="button"
                className="botao botao-perigo"
                onClick={() =>
                  void fazer(
                    confirmando === 'apagar' ? servidores.apagar(servidor.codigo) : servidores.tirar(servidor.codigo, conta!.id),
                    fechar, // o servidor tira da sala na hora (servidor-apagado, fora-do-servidor)
                  )
                }
              >
                {confirmando === 'apagar' ? <Trash2 size={16} /> : <LogOut size={16} />}
                {confirmando === 'apagar' ? 'Apagar para sempre' : 'Sair do servidor'}
              </button>
              <button type="button" className="botao botao-fantasma" onClick={() => setConfirmando(null)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="botao botao-perigo" onClick={() => setConfirmando(permite.apagar ? 'apagar' : 'sair')}>
              {permite.apagar ? <Trash2 size={16} /> : <LogOut size={16} />}
              {permite.apagar ? 'Apagar o servidor' : 'Sair do servidor'}
            </button>
          )}
        </section>
      )}
    </>
  );
}

function AbaDeMembros({ servidor, aoMudar, fazer }: { servidor: Servidor; aoMudar: (s: Servidor) => void; fazer: Fazer }) {
  const { conta } = useConta();
  const permite = pode(servidor);
  // Uma ação que pede confirmação: passar a posse ou expulsar alguém.
  const [confirmando, setConfirmando] = useState<{ acao: 'posse' | 'expulsar'; membro: Membro } | null>(null);

  async function confirmar() {
    if (!confirmando) return;
    const { acao, membro } = confirmando;
    setConfirmando(null);
    if (acao === 'posse') {
      await fazer(servidores.passarPosse(servidor.codigo, membro.conta), aoMudar);
    } else if (await fazer(servidores.tirar(servidor.codigo, membro.conta))) {
      aoMudar({ ...servidor, membros: servidor.membros.filter((m) => m.conta !== membro.conta) });
      cliente.avisar(`${membro.nome} foi removido do servidor e não volta por convite.`);
    }
  }

  return (
    <section className="configuracoes-secao" aria-labelledby="titulo-membros">
      <h3 id="titulo-membros">Membros · {servidor.membros.length}</h3>
      <ul className="membros-do-servidor">
        {servidor.membros.map((membro) => {
          const eu = membro.conta === conta?.id;
          return (
            <li key={membro.conta} className="configuracoes-linha">
              <span className="membro">
                <Avatar nome={membro.nome} foto={membro.foto} tamanho={32} />
                <span>
                  {membro.nome}
                  {eu && <small className="ajuda"> (você)</small>}
                </span>
                <span className={`selo-papel selo-${membro.papel}`}>
                  {membro.papel === 'dono' ? <Crown size={12} aria-hidden="true" /> : membro.papel === 'admin' ? <Shield size={12} aria-hidden="true" /> : null}
                  {NOME_DO_PAPEL[membro.papel]}
                </span>
              </span>
              {!eu && (
                <span className="membro-acoes">
                  {permite.mudarPapeis && membro.papel !== 'dono' && (
                    <button
                      type="button"
                      className="botao botao-fantasma botao-pequeno"
                      onClick={() =>
                        void fazer(servidores.mudarPapel(servidor.codigo, membro.conta, membro.papel === 'admin' ? 'membro' : 'admin'), aoMudar)
                      }
                    >
                      {membro.papel === 'admin' ? 'Tirar admin' : 'Tornar admin'}
                    </button>
                  )}
                  {permite.passarPosse && (
                    <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => setConfirmando({ acao: 'posse', membro })}>
                      Passar a posse
                    </button>
                  )}
                  {permite.expulsar(membro) && (
                    <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => setConfirmando({ acao: 'expulsar', membro })}>
                      Expulsar
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {confirmando && (
        <div className="configuracoes-alerta" role="alertdialog" aria-label="Confirmar">
          <p>
            {confirmando.acao === 'posse'
              ? `${confirmando.membro.nome} vira dono do servidor, e você vira admin. Só a pessoa nova pode devolver.`
              : `${confirmando.membro.nome} sai do servidor agora e não volta por convite, até alguém desbloquear em Bloqueados.`}
          </p>
          <div className="configuracoes-linha">
            <button type="button" className="botao botao-perigo" onClick={() => void confirmar()}>
              {confirmando.acao === 'posse' ? 'Passar a posse' : 'Expulsar'}
            </button>
            <button type="button" className="botao botao-fantasma" onClick={() => setConfirmando(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function AbaDeConvites({ servidor, fazer }: { servidor: Servidor; fazer: Fazer }) {
  const permite = pode(servidor);
  const [horas, setHoras] = useState<number | null>(24 * 7);
  const [usos, setUsos] = useState<number | null>(null);
  const [novo, setNovo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [convites, setConvites] = useState<Convite[] | null>(null);
  const codigo = servidor.codigo;
  const cuida = permite.cuidarDosConvites;

  useEffect(() => {
    if (cuida) void servidores.convites(codigo).then((lidos) => lidos.ok && setConvites(lidos.valor.convites));
  }, [codigo, cuida, novo]);

  async function copiar(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      cliente.avisar(`Copie o link: ${link}`);
    }
  }

  return (
    <>
      <section className="configuracoes-secao" aria-labelledby="titulo-novo-convite">
        <h3 id="titulo-novo-convite">Convidar</h3>
        <p className="ajuda">Quem abrir o link entra com o Google ou o Discord e vira membro: depois, entra sem senha quando quiser.</p>
        <div className="configuracoes-duas">
          <label className="campo">
            <span>Vence em</span>
            <select value={String(horas)} onChange={(e) => setHoras(e.target.value === 'null' ? null : Number(e.target.value))}>
              {VALIDADES.map((v) => (
                <option key={String(v.horas)} value={String(v.horas)}>
                  {v.texto}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Pode ser usado</span>
            <select value={String(usos)} onChange={(e) => setUsos(e.target.value === 'null' ? null : Number(e.target.value))}>
              {USOS.map((u) => (
                <option key={String(u)} value={String(u)}>
                  {u === null ? 'Quantas vezes quiser' : u === 1 ? '1 vez' : `${u} vezes`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="configuracoes-linha">
          <button
            type="button"
            className="botao botao-primario"
            onClick={() =>
              void fazer(servidores.convidar(codigo, horas, usos), ({ codigo: convite }) => {
                setNovo(convite);
                void copiar(linkDoConvite(convite));
              })
            }
          >
            Criar e copiar o link
          </button>
        </div>
        {novo && (
          <p className="vazio-link">
            {copiado ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} <code>{linkDoConvite(novo)}</code>
          </p>
        )}
      </section>

      {cuida && (
        <section className="configuracoes-secao" aria-labelledby="titulo-convites">
          <h3 id="titulo-convites">Convites valendo</h3>
          {convites?.length === 0 && <p className="ajuda">Nenhum convite valendo agora.</p>}
          <ul className="membros-do-servidor">
            {convites?.map((c) => (
              <li key={c.codigo} className="configuracoes-linha">
                <span>
                  <code>{c.codigo}</code>{' '}
                  <small className="ajuda">
                    {c.expiraEm ? `vence ${new Date(c.expiraEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'não vence'}
                    {' · '}
                    {c.usosMaximos === null ? `${c.usos} usos` : `${c.usos} de ${c.usosMaximos} usos`}
                    {c.criadoPor && ` · por ${c.criadoPor}`}
                  </small>
                </span>
                <button
                  type="button"
                  className="botao botao-fantasma botao-pequeno"
                  onClick={() => void fazer(servidores.apagarConvite(codigo, c.codigo), () => setConvites(convites.filter((x) => x.codigo !== c.codigo)))}
                >
                  Apagar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function AbaDeBloqueados({ servidor, fazer }: { servidor: Servidor; fazer: Fazer }) {
  const [bloqueados, setBloqueados] = useState<Bloqueado[] | null>(null);
  const codigo = servidor.codigo;

  useEffect(() => {
    void servidores.bloqueados(codigo).then((lidos) => lidos.ok && setBloqueados(lidos.valor.bloqueados));
  }, [codigo]);

  return (
    <section className="configuracoes-secao" aria-labelledby="titulo-bloqueados">
      <h3 id="titulo-bloqueados">Bloqueados</h3>
      <p className="ajuda">Quem foi expulso não volta por convite. Desbloqueado, a pessoa pode voltar com um convite novo.</p>
      {bloqueados?.length === 0 && <p className="ajuda">Ninguém bloqueado.</p>}
      <ul className="membros-do-servidor">
        {bloqueados?.map((b) => (
          <li key={b.conta} className="configuracoes-linha">
            <span className="membro">
              <Avatar nome={b.nome} foto={b.foto} tamanho={32} />
              <span>
                {b.nome}
                {b.porQuem && <small className="ajuda"> · por {b.porQuem}</small>}
              </span>
            </span>
            <button
              type="button"
              className="botao botao-fantasma botao-pequeno"
              onClick={() => void fazer(servidores.desbloquear(codigo, b.conta), () => setBloqueados(bloqueados.filter((x) => x.conta !== b.conta)))}
            >
              Desbloquear
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
