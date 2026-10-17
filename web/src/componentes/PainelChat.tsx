import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { CircleAlert, ImagePlus, LoaderCircle, Play, SendHorizontal, X } from 'lucide-react';
import { LIMITE_DO_CHAT, cliente, type MensagemDoChat, type PreviaDeLink } from '../cliente';
import { bandeja } from '../imagens/bandeja';
import { IMAGENS_POR_ENVIO } from '../imagens/regras';
import { useCliente } from '../useCliente';
import { Avatar } from './Avatar';
import { VisualizadorDeImagem } from './VisualizadorDeImagem';

// Mensagens seguidas da mesma pessoa, com menos que isso entre uma e outra, ficam juntas, sem repetir o nome.
const JUNTAR_ATE = 2 * 60_000;
// A imagem no chat: no máximo essa altura (a largura acompanha, até a do painel).
const ALTURA_DA_IMAGEM = 240;
const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Os links do texto viram clicáveis (no app, abrem no navegador); o resto continua texto puro. */
function comLinks(texto: string) {
  return texto.split(/(https?:\/\/[^\s]+)/g).map((parte, i) =>
    i % 2 === 1 ? (
      <a key={i} href={parte} target="_blank" rel="noopener noreferrer">
        {parte}
      </a>
    ) : (
      parte
    ),
  );
}

/** Põe imagens na bandeja (colar, arrastar, escolher). Acima do limite por envio, avisa quantas ficaram de fora. */
export function adicionarImagens(arquivos: Iterable<File>) {
  const fora = bandeja.adicionar(arquivos);
  if (fora > 0) cliente.avisar(`Até ${IMAGENS_POR_ENVIO} imagens por vez: ${fora === 1 ? '1 ficou' : `${fora} ficaram`} de fora.`, 'erro');
}

/** O chat da sala: o servidor só repassa o texto, as imagens vão direto entre os PCs, e nada fica guardado. */
export function PainelChat() {
  const { chat, conexaoPerdida } = useCliente();
  const itens = useSyncExternalStore(bandeja.inscrever, bandeja.ler);
  const [texto, setTexto] = useState('');
  const [aguardando, setAguardando] = useState(false); // Enter com imagem ainda sendo preparada: manda quando ficar pronta
  const [aberta, setAberta] = useState<MensagemDoChat | null>(null);
  const lista = useRef<HTMLOListElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const escolher = useRef<HTMLInputElement>(null);
  const noFim = useRef(true);
  const preparando = itens.some((i) => i.estado === 'preparando');
  const prontas = itens.filter((i) => i.estado === 'pronta').length;
  const fecharImagem = useCallback(() => setAberta(null), []);

  useEffect(() => campo.current?.focus(), []);

  // Desce sozinho com a mensagem nova, a não ser que a pessoa tenha subido para ler as antigas.
  useLayoutEffect(() => {
    if (noFim.current && lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [chat, itens.length]);

  // A imagem aberta acompanha o chat (o estado dela muda, ou ela sai da memória).
  const abertaAgora = aberta && chat.find((m) => m.numero === aberta.numero);

  function mandar() {
    if (bandeja.ler().length > 0) {
      if (bandeja.preparando()) {
        setAguardando(true);
        return;
      }
      setAguardando(false);
      const lista = bandeja.prontas();
      if (lista.length > 0) {
        if (!cliente.mandarImagens(lista, texto)) return; // um freio segurou: continua tudo na bandeja e no campo
        bandeja.esvaziar();
        setTexto('');
        return;
      }
      bandeja.esvaziar(); // só sobraram as que não deu para abrir
    }
    setAguardando(false);
    if (texto.trim() && cliente.mandarMensagem(texto)) setTexto('');
  }

  useEffect(() => {
    if (aguardando && !preparando) mandar();
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    mandar();
  }

  function tecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') cliente.abrirChat(false);
  }

  /** Ctrl+V com um print (Win+Shift+S): vai para a bandeja. Texto colado continua indo para o campo. */
  function colar(e: ClipboardEvent<HTMLInputElement>) {
    const imagens = [...e.clipboardData.files].filter((arquivo) => arquivo.type.startsWith('image/'));
    if (imagens.length === 0) return;
    e.preventDefault();
    adicionarImagens(imagens);
  }

  const podeMandar = !conexaoPerdida && (texto.trim() !== '' || prontas > 0 || preparando);

  return (
    <aside className="painel-chat" aria-label="Chat da sala">
      <header>
        <h2>Chat da sala</h2>
        <button type="button" className="botao-icone" aria-label="Fechar o chat" onClick={() => cliente.abrirChat(false)}>
          <X size={18} />
        </button>
      </header>
      <ol
        className="chat-mensagens"
        ref={lista}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {chat.length === 0 && <li className="chat-vazio">Nenhuma mensagem ainda. As mensagens não ficam guardadas: quem entrar depois não vê o que foi dito antes.</li>}
        {chat.map((m, i) => (
          <Mensagem key={m.numero} m={m} junto={juntaComAnterior(chat[i - 1], m)} aoAbrir={setAberta} />
        ))}
      </ol>
      {itens.length > 0 && (
        <ul className="chat-bandeja" aria-label="Imagens para mandar">
          {itens.map((item) => (
            <li key={item.chave} className={item.estado === 'erro' ? 'erro' : undefined} title={item.erro || undefined}>
              {item.estado === 'pronta' && item.previa && <img src={item.previa} alt="Imagem para mandar" />}
              {item.estado === 'preparando' && <LoaderCircle size={20} className="girando" aria-label="Preparando a imagem" />}
              {item.estado === 'erro' && <CircleAlert size={20} aria-label={item.erro} />}
              <button type="button" className="chat-bandeja-tirar" aria-label="Tirar da bandeja" onClick={() => bandeja.remover(item.chave)}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="chat-envio" onSubmit={enviar}>
        <button
          type="button"
          className="botao-icone chat-anexar"
          aria-label="Mandar imagem"
          title="Mandar imagem (ou cole com Ctrl+V, ou arraste para o chat)"
          disabled={conexaoPerdida || itens.length >= IMAGENS_POR_ENVIO}
          onClick={() => escolher.current?.click()}
        >
          <ImagePlus size={18} />
        </button>
        <input
          ref={escolher}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) adicionarImagens(e.target.files);
            e.target.value = ''; // escolher o mesmo arquivo de novo também conta
            campo.current?.focus();
          }}
        />
        <input
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={tecla}
          onPaste={colar}
          maxLength={LIMITE_DO_CHAT}
          placeholder={conexaoPerdida ? 'Reconectando…' : 'Mensagem para a sala'}
          disabled={conexaoPerdida}
          aria-label="Mensagem para a sala"
        />
        <button type="submit" className="botao-icone" aria-label="Enviar" disabled={!podeMandar || aguardando}>
          {aguardando ? <LoaderCircle size={18} className="girando" /> : <SendHorizontal size={18} />}
        </button>
      </form>
      {texto.length > LIMITE_DO_CHAT - 100 && (
        <span className="chat-contador">
          {texto.length}/{LIMITE_DO_CHAT}
        </span>
      )}
      {abertaAgora?.imagem?.url && <VisualizadorDeImagem mensagem={abertaAgora} aoFechar={fecharImagem} />}
    </aside>
  );
}

function juntaComAnterior(anterior: MensagemDoChat | undefined, m: MensagemDoChat): boolean {
  return anterior !== undefined && anterior.de === m.de && m.momento - anterior.momento < JUNTAR_ATE;
}

type PropsDaMensagem = { m: MensagemDoChat; junto: boolean; aoAbrir: (m: MensagemDoChat) => void };

function Mensagem({ m, junto, aoAbrir }: PropsDaMensagem) {
  // Só o link, com o cartão dele: o cartão basta (como no Discord).
  const soOLink = m.previa !== undefined && m.texto.trim() === m.previa.url;
  const conteudo = m.imagem ? (
    <ImagemNoChat m={m} aoAbrir={aoAbrir} />
  ) : (
    <>
      {!soOLink && <p>{comLinks(m.texto)}</p>}
      {m.previa && <CartaoDoLink previa={m.previa} />}
    </>
  );
  if (junto)
    return (
      <li className="chat-mensagem junto">
        <div>{conteudo}</div>
      </li>
    );
  return (
    <li className={m.minha ? 'chat-mensagem minha' : 'chat-mensagem'}>
      <Avatar nome={m.nome} tamanho={32} />
      <div>
        <span className="chat-autor">
          {m.minha ? 'Você' : m.nome} <time dateTime={new Date(m.momento).toISOString()}>{hora.format(m.momento)}</time>
        </span>
        {conteudo}
      </div>
    </li>
  );
}

/** O cartão de um link de vídeo: a imagem, o título e o canal. O clique abre o vídeo no navegador. */
function CartaoDoLink({ previa }: { previa: PreviaDeLink }) {
  const titulo = previa.titulo ?? previa.url;
  return (
    <a className="chat-link" href={previa.url} target="_blank" rel="noopener noreferrer" title={titulo}>
      {previa.miniatura && (
        <span className="chat-link-imagem">
          <img src={previa.miniatura} alt="" draggable={false} />
          <span className="chat-link-play" aria-hidden="true">
            <Play size={18} fill="currentColor" />
          </span>
        </span>
      )}
      <span className="chat-link-texto">
        <span className="chat-link-site">{previa.site}</span>
        <strong>{titulo}</strong>
        {previa.autor && <span className="chat-link-autor">{previa.autor}</span>}
      </span>
    </a>
  );
}

function ImagemNoChat({ m, aoAbrir }: { m: MensagemDoChat; aoAbrir: (m: MensagemDoChat) => void }) {
  const img = m.imagem!;
  const autor = m.minha ? 'você' : m.nome;
  // O espaço já fica reservado no tamanho certo: a lista não pula quando a imagem chega.
  const estilo = { width: `min(100%, ${img.largura}px, ${Math.round((ALTURA_DA_IMAGEM * img.largura) / img.altura)}px)`, aspectRatio: `${img.largura} / ${img.altura}` };
  return (
    <figure className="chat-imagem">
      {img.url ? (
        <button type="button" className="chat-imagem-quadro" style={estilo} aria-label={`Abrir a imagem de ${autor}`} onClick={() => aoAbrir(m)}>
          <img src={img.url} alt={`Imagem de ${autor}`} draggable={false} />
        </button>
      ) : (
        <div className={`chat-imagem-quadro ${img.estado}`} style={estilo}>
          {img.miniatura && img.estado === 'chegando' && <img className="borrada" src={img.miniatura} alt="" />}
          {img.estado === 'chegando' && <span className="chat-imagem-progresso">{Math.round(img.progresso * 100)}%</span>}
        </div>
      )}
      <SituacaoDaImagem m={m} />
    </figure>
  );
}

function SituacaoDaImagem({ m }: { m: MensagemDoChat }) {
  useCliente(); // redesenha quando alguém entra ou sai (o "Tentar de novo" depende de quem está na sala)
  const img = m.imagem!;
  if (img.estado === 'falhou') return <figcaption className="erro">A imagem não chegou inteira.</figcaption>;
  if (img.estado === 'apagada') return <figcaption>Imagem antiga: saiu da memória desta página.</figcaption>;
  if (img.estado === 'chegando') return <figcaption>Chegando…</figcaption>;
  if (!img.envio) return null;
  const { para, entregues, falhas } = img.envio;
  const total = Object.keys(para).length;
  if (total === 0) return <figcaption>Ninguém mais na sala para receber.</figcaption>;
  if (entregues.length + falhas.length < total) {
    return (
      <figcaption>
        Enviando… {entregues.length} de {total}
      </figcaption>
    );
  }
  if (falhas.length === 0) return <figcaption>{total === 1 ? 'Entregue' : `Entregue para ${total}`}</figcaption>;
  return (
    <figcaption className="erro">
      Não chegou para {falhas.map((id) => para[id]).join(', ')}.{' '}
      {falhas.some((id) => cliente.pessoaDeAgora(id, para[id])) && (
        <button type="button" className="chat-imagem-tentar" onClick={() => cliente.reenviarImagem(img.id)}>
          Tentar de novo
        </button>
      )}
    </figcaption>
  );
}
