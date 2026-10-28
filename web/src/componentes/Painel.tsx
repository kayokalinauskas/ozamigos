import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, LoaderCircle, MonitorUp, RefreshCw } from 'lucide-react';
import { entrarCom, enviar, NOME_DO_PROVEDOR, useConta, type Provedor } from '../conta';
import { Avatar } from './Avatar';
import { Logo } from './Logo';

// O painel do dono (PainelApi.java): só o dono recebe os dados; para os outros, o servidor responde como se o painel não
// existisse, e esta página diz só isso. Apagar, banir e desbanir pedem um login recente (o servidor confere): sem ele, o
// painel pede para entrar de novo.

type NoAr = { nome: string; conta: string | null; transmitindo: boolean; assistindo: string[] };
type SalaAberta = { codigo: string | null; nome: string; pessoas: NoAr[] };
type Uso = { video: number; voz: number };
type Retransmissao = {
  ligada: boolean;
  lidoEm?: string;
  periodo?: number;
  hoje?: number;
  hojeVideo?: number;
  hojeVoz?: number;
  esgotada?: boolean;
  videoEsgotado?: boolean;
  porConta?: Record<string, Uso>;
  limites: { periodo: number; dia: number; periodoDoVideo: number; diaDoVideo: number; videoPorPessoa: number; vozPorPessoa: number; diasDoPeriodo: number };
};
type Banco = {
  bytesDoBanco: number;
  bytesPorTabela: Record<string, number>;
  contas: number;
  contasNovasHoje: number;
  contasNovasNaSemana: number;
  contasVistasHoje: number;
  contasVistasNaSemana: number;
  servidores: number;
  membros: number;
  convitesValendo: number;
  sessoesValendo: number;
  bloqueios: number;
};
type ServidorNoPainel = { codigo: string; nome: string; icone: string | null; dono: string | null; nomeDoDono: string | null; membros: number; convitesValendo: number; criadoEm: string };
type ContaNoPainel = { id: string; nome: string; foto: string | null; provedores: string[]; criadaEm: string; vistaEm: string; donaDe: number; membroDe: number; sessoes: number; banida: boolean };
type Banimento = { provedor: string; idExterno: string; conta: string | null; nome: string; banidoEm: string; porQuem: string | null };
type AcaoDoPainel = { quando: string; quem: string | null; acao: 'apagar-servidor' | 'banir' | 'desbanir'; alvo: string; nomeDoAlvo: string };
type Dados = {
  agora: string;
  salas: SalaAberta[];
  retransmissao: Retransmissao;
  banco: Banco;
  servidores: ServidorNoPainel[];
  contas: ContaNoPainel[];
  banimentos: Banimento[];
  registro: AcaoDoPainel[];
  loginRecente: boolean;
};

/** Faz uma ação do painel e lê tudo de novo; um erro vira o aviso no topo. */
type Agir = (metodo: string, caminho: string, corpo?: unknown) => Promise<void>;

const TEXTO_DA_ACAO: Record<AcaoDoPainel['acao'], string> = { 'apagar-servidor': 'apagou o servidor', banir: 'baniu', desbanir: 'desbaniu' };

const ERROS: Record<string, string> = {
  'servidor-nao-existe': 'Esse servidor não existe mais.',
  'conta-nao-existe': 'Essa conta não existe mais.',
  'nao-banida': 'Essa conta não está banida.',
  'dono-nao-se-bane': 'Uma conta dona do Ozamigos não pode ser banida.',
  'muitas-tentativas': 'Muitas ações em pouco tempo. Espere um minuto.',
};

/** O banco grátis do Supabase. */
const BANCO_GRATIS = 500e6;
const ATUALIZAR_A_CADA_MS = 15_000;

type Aba = 'agora' | 'servidores' | 'contas' | 'banidos' | 'consumo' | 'registro';
const ABAS: { id: Aba; titulo: string }[] = [
  { id: 'agora', titulo: 'Agora' },
  { id: 'servidores', titulo: 'Servidores' },
  { id: 'contas', titulo: 'Contas' },
  { id: 'banidos', titulo: 'Banidos' },
  { id: 'consumo', titulo: 'Consumo' },
  { id: 'registro', titulo: 'Registro' },
];

function bytes(n: number | undefined): string {
  if (n === undefined) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${n} B`;
}

function quando(data: string): string {
  return new Date(data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function Painel() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState<Aba>('agora');
  const [lendo, setLendo] = useState(false);

  const ler = useCallback(async () => {
    setLendo(true);
    const resposta = await enviar('GET', '/api/painel');
    setLendo(false);
    if (resposta.ok) {
      setDados(resposta.corpo as unknown as Dados);
      setErro('');
    } else {
      setErro(resposta.motivo === 'nao-existe' || resposta.motivo === 'sem-conta' ? 'Esta página não existe.' : 'Não deu para ler o painel agora.');
    }
  }, []);

  useEffect(() => {
    void ler();
    const vez = setInterval(() => void ler(), ATUALIZAR_A_CADA_MS);
    return () => clearInterval(vez);
  }, [ler]);

  const agir: Agir = useCallback(
    async (metodo, caminho, corpo) => {
      const resposta = await enviar(metodo, caminho, corpo);
      if (resposta.ok) {
        setErro('');
      } else if (resposta.motivo === 'login-antigo') {
        setDados((atual) => atual && { ...atual, loginRecente: false });
        return;
      } else {
        setErro(ERROS[resposta.motivo ?? ''] ?? 'Não deu certo. Tente de novo.');
      }
      await ler();
    },
    [ler],
  );

  // Antes da resposta, e para quem não é dono, nada do painel: nem o título.
  if (!dados) {
    return (
      <main className="entrada">
        <div className="cartao-entrada">
          <Logo grande />
          {erro ? (
            <>
              <p className="ajuda">{erro}</p>
              <a className="botao botao-secundario" href="/">
                Ir para a entrada do Ozamigos
              </a>
            </>
          ) : (
            <p className="ajuda">
              <LoaderCircle size={14} className="girando" /> Carregando…
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="painel">
      <header className="painel-topo">
        <Logo />
        <h1>Painel</h1>
        <span className="painel-espaco" />
        <button type="button" className="botao botao-fantasma botao-pequeno" disabled={lendo} onClick={() => void ler()}>
          <RefreshCw size={14} className={lendo ? 'girando' : undefined} /> Atualizar
        </button>
        <a className="botao botao-secundario botao-pequeno" href="/">
          <ArrowLeft size={14} /> Voltar
        </a>
      </header>
      <div className="segmentado painel-abas" role="tablist" aria-label="Seções do painel">
        {ABAS.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>
            {a.titulo}
          </button>
        ))}
      </div>
      {erro && (
        <p className="painel-alerta" role="alert">
          {erro}
        </p>
      )}
      {!dados.loginRecente && <EntrarDeNovo aoEntrar={() => void ler()} />}
      <section role="tabpanel">
        {aba === 'agora' && <Agora dados={dados} />}
        {aba === 'servidores' && <Servidores dados={dados} agir={agir} />}
        {aba === 'contas' && <Contas dados={dados} agir={agir} />}
        {aba === 'banidos' && <Banidos dados={dados} agir={agir} />}
        {aba === 'consumo' && <Consumo dados={dados} />}
        {aba === 'registro' && <Registro dados={dados} />}
      </section>
      <p className="painel-rodape">Lido às {new Date(dados.agora).toLocaleTimeString('pt-BR')}</p>
    </main>
  );
}

/** Sem login recente, as ações não valem: entrar de novo (no navegador, a página volta para cá; no app, fica aqui). */
function EntrarDeNovo({ aoEntrar }: { aoEntrar: () => void }) {
  const { conta, ocupada } = useConta();
  return (
    <div className="painel-alerta">
      <span>Para apagar ou banir, entre de novo.</span>
      {(conta?.provedores ?? []).map((provedor: Provedor) => (
        <button
          key={provedor}
          type="button"
          className="botao botao-secundario botao-pequeno"
          disabled={ocupada}
          onClick={() => void entrarCom(provedor).then((ficou) => ficou && aoEntrar())}
        >
          Entrar com o {NOME_DO_PROVEDOR[provedor]}
        </button>
      ))}
    </div>
  );
}

/** Um botão que pede confirmação no lugar, antes de agir. */
function Confirmar({ rotulo, pergunta, aoConfirmar }: { rotulo: string; pergunta: string; aoConfirmar: () => Promise<void> }) {
  const [perguntando, setPerguntando] = useState(false);
  const [fazendo, setFazendo] = useState(false);
  if (!perguntando) {
    return (
      <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => setPerguntando(true)}>
        {rotulo}
      </button>
    );
  }
  return (
    <span className="painel-confirmar">
      <span>{pergunta}</span>
      <button
        type="button"
        className="botao botao-perigo botao-pequeno"
        disabled={fazendo}
        onClick={() => {
          setFazendo(true);
          void aoConfirmar().finally(() => {
            setFazendo(false);
            setPerguntando(false);
          });
        }}
      >
        {rotulo}
      </button>
      <button type="button" className="botao botao-fantasma botao-pequeno" onClick={() => setPerguntando(false)}>
        Cancelar
      </button>
    </span>
  );
}

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: string | number; detalhe?: string }) {
  return (
    <div className="painel-numero">
      <small>{rotulo}</small>
      <strong>{valor}</strong>
      {detalhe && <span>{detalhe}</span>}
    </div>
  );
}

function Agora({ dados }: { dados: Dados }) {
  const pessoas = dados.salas.reduce((soma, sala) => soma + sala.pessoas.length, 0);
  const noAr = dados.salas.reduce((soma, sala) => soma + sala.pessoas.filter((p) => p.transmitindo).length, 0);
  return (
    <>
      <div className="painel-numeros">
        <Numero rotulo="Salas abertas" valor={dados.salas.length} />
        <Numero rotulo="Pessoas nas salas" valor={pessoas} />
        <Numero rotulo="Transmitindo" valor={noAr} />
        <Numero rotulo="Retransmissão hoje" valor={bytes(dados.retransmissao.hoje)} />
      </div>
      {dados.salas.length === 0 && <p className="ajuda">Nenhuma sala aberta.</p>}
      {dados.salas.map((sala) => (
        <article key={sala.codigo ?? sala.nome} className="painel-cartao">
          <h2>
            {sala.nome} <small>{sala.pessoas.length} na sala</small>
          </h2>
          <ul className="painel-lista">
            {sala.pessoas.map((p, i) => (
              <li key={p.conta ?? i}>
                <Avatar nome={p.nome} tamanho={28} aoVivo={p.transmitindo} />
                <span className="painel-texto">
                  <strong>{p.nome}</strong>
                  <small>
                    {p.transmitindo && (
                      <>
                        <MonitorUp size={12} /> transmitindo{' '}
                      </>
                    )}
                    {p.assistindo.length > 0 && (
                      <>
                        <Eye size={12} /> assiste {p.assistindo.join(', ')}
                      </>
                    )}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </>
  );
}

/** Busca por nome, código ou id, sem diferenciar maiúsculas nem acentos. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function useBusca<T>(itens: T[], texto: (item: T) => string) {
  const [busca, setBusca] = useState('');
  const filtrados = useMemo(() => {
    const procurado = normalizar(busca.trim());
    return procurado ? itens.filter((item) => normalizar(texto(item)).includes(procurado)) : itens;
  }, [itens, busca, texto]);
  const campo = (
    <input className="painel-busca" type="search" placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
  );
  return { filtrados, campo };
}

const textoDoServidor = (s: ServidorNoPainel) => `${s.nome} ${s.codigo} ${s.nomeDoDono ?? ''}`;
const textoDaConta = (c: ContaNoPainel) => `${c.nome} ${c.id}`;

function Servidores({ dados, agir }: { dados: Dados; agir: Agir }) {
  const naSala = useMemo(() => new Map(dados.salas.map((s) => [s.codigo, s.pessoas.length])), [dados.salas]);
  const { filtrados, campo } = useBusca(dados.servidores, textoDoServidor);
  return (
    <>
      <div className="painel-cabecalho">
        <p className="ajuda">{dados.banco.servidores} servidores, {dados.banco.membros} participações</p>
        {campo}
      </div>
      <ul className="painel-lista painel-cartao">
        {filtrados.map((s) => (
          <li key={s.codigo}>
            <Avatar nome={s.nome} foto={s.icone} tamanho={32} quadrado />
            <span className="painel-texto">
              <strong>{s.nome}</strong>
              <small>
                {s.codigo} · dono: {s.nomeDoDono ?? 'ninguém'} · {s.membros} {s.membros === 1 ? 'membro' : 'membros'} · {s.convitesValendo} convites · criado em {quando(s.criadoEm)}
              </small>
            </span>
            {naSala.has(s.codigo) && <span className="painel-etiqueta">{naSala.get(s.codigo)} na sala</span>}
            <Confirmar
              rotulo="Apagar"
              pergunta={`Apagar "${s.nome}" para todos?`}
              aoConfirmar={() => agir('DELETE', `/api/painel/servidores/${s.codigo}`, { confirmar: true })}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function Contas({ dados, agir }: { dados: Dados; agir: Agir }) {
  const { conta: eu } = useConta();
  const salaDe = useMemo(() => {
    const mapa = new Map<string, string>();
    dados.salas.forEach((sala) => sala.pessoas.forEach((p) => p.conta && mapa.set(p.conta, sala.nome)));
    return mapa;
  }, [dados.salas]);
  const { filtrados, campo } = useBusca(dados.contas, textoDaConta);
  const uso = dados.retransmissao.porConta ?? {};
  return (
    <>
      <div className="painel-cabecalho">
        <p className="ajuda">
          {dados.banco.contas} contas · {dados.banco.contasVistasHoje} usaram hoje · {dados.banco.contasNovasNaSemana} novas na semana
        </p>
        {campo}
      </div>
      <ul className="painel-lista painel-cartao">
        {filtrados.map((c) => (
          <li key={c.id}>
            <Avatar nome={c.nome} foto={c.foto} tamanho={32} />
            <span className="painel-texto">
              <strong>{c.nome}</strong>
              <small>
                {c.provedores.join(' e ')} · dono de {c.donaDe}, membro de {c.membroDe} · {c.sessoes} {c.sessoes === 1 ? 'sessão' : 'sessões'} · criada em {quando(c.criadaEm)} · vista em {quando(c.vistaEm)}
                {uso[c.id] && ` · retransmissão hoje: vídeo ${bytes(uso[c.id].video)}, voz ${bytes(uso[c.id].voz)}`}
              </small>
              <small className="painel-id">{c.id}</small>
            </span>
            {salaDe.has(c.id) && <span className="painel-etiqueta">em {salaDe.get(c.id)}</span>}
            {c.banida ? (
              <span className="painel-etiqueta painel-banida">banida</span>
            ) : (
              c.id !== eu?.id && (
                <Confirmar rotulo="Banir" pergunta={`Banir ${c.nome}?`} aoConfirmar={() => agir('POST', `/api/painel/contas/${c.id}/banir`, { confirmar: true })} />
              )
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Consumo({ dados }: { dados: Dados }) {
  const { retransmissao: r, banco: b } = dados;
  const tabelas = Object.entries(b.bytesPorTabela);
  return (
    <>
      <h2 className="painel-titulo">Retransmissão (Cloudflare)</h2>
      {!r.ligada ? (
        <p className="ajuda">Desligada neste servidor.</p>
      ) : r.lidoEm === undefined ? (
        <p className="ajuda">Ainda sem leitura do consumo.</p>
      ) : (
        <>
          <div className="painel-numeros">
            <Numero rotulo="Hoje" valor={bytes(r.hoje)} detalhe={`vídeo ${bytes(r.hojeVideo)}, voz ${bytes(r.hojeVoz)} · teto ${bytes(r.limites.dia)}`} />
            <Numero rotulo={`Últimos ${r.limites.diasDoPeriodo} dias`} valor={bytes(r.periodo)} detalhe={`teto ${bytes(r.limites.periodo)}`} />
            <Numero rotulo="Situação" valor={r.esgotada ? 'Desligada pelo teto' : r.videoEsgotado ? 'Só voz' : 'Normal'} detalhe={`lido às ${new Date(r.lidoEm).toLocaleTimeString('pt-BR')}`} />
          </div>
          <p className="ajuda">
            Por pessoa, no dia: vídeo até {bytes(r.limites.videoPorPessoa)}, voz até {bytes(r.limites.vozPorPessoa)}.
          </p>
        </>
      )}
      <h2 className="painel-titulo">Banco (Supabase)</h2>
      <div className="painel-numeros">
        <Numero rotulo="Tamanho" valor={bytes(b.bytesDoBanco)} detalhe={`${Math.round((b.bytesDoBanco / BANCO_GRATIS) * 100)}% dos 500 MB grátis`} />
        <Numero rotulo="Contas" valor={b.contas} detalhe={`${b.contasNovasHoje} novas hoje, ${b.contasNovasNaSemana} na semana`} />
        <Numero rotulo="Sessões valendo" valor={b.sessoesValendo} />
        <Numero rotulo="Convites valendo" valor={b.convitesValendo} detalhe={`${b.bloqueios} bloqueios`} />
      </div>
      <ul className="painel-lista painel-cartao">
        {tabelas.map(([nome, tamanho]) => (
          <li key={nome}>
            <span className="painel-texto">
              <strong>{nome}</strong>
            </span>
            <span className="painel-etiqueta">{bytes(tamanho)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Banidos({ dados, agir }: { dados: Dados; agir: Agir }) {
  if (dados.banimentos.length === 0) return <p className="ajuda">Ninguém banido.</p>;
  return (
    <ul className="painel-lista painel-cartao">
      {dados.banimentos.map((b) => (
        <li key={`${b.provedor}:${b.idExterno}`}>
          <span className="painel-texto">
            <strong>{b.nome}</strong>
            <small>
              {NOME_DO_PROVEDOR[b.provedor as Provedor] ?? b.provedor} · banida em {quando(b.banidoEm)}
              {b.porQuem && ` por ${b.porQuem}`}
              {!b.conta && ' · a conta foi apagada'}
            </small>
          </span>
          <Confirmar
            rotulo="Desbanir"
            pergunta={`Desbanir ${b.nome}?`}
            aoConfirmar={() => agir('POST', '/api/painel/desbanir', { provedor: b.provedor, idExterno: b.idExterno })}
          />
        </li>
      ))}
    </ul>
  );
}

function Registro({ dados }: { dados: Dados }) {
  if (dados.registro.length === 0) return <p className="ajuda">Nenhuma ação ainda.</p>;
  return (
    <ul className="painel-lista painel-cartao">
      {dados.registro.map((a, i) => (
        <li key={i}>
          <span className="painel-texto">
            <strong>
              {a.quem ?? 'Alguém'} {TEXTO_DA_ACAO[a.acao]} {a.nomeDoAlvo}
            </strong>
            <small>{quando(a.quando)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}
