import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SendHorizontal, X } from 'lucide-react';
import { LIMITE_DO_CHAT, cliente, type MensagemDoChat } from '../cliente';
import { useCliente } from '../useCliente';
import { Avatar } from './Avatar';

// Mensagens seguidas da mesma pessoa, com menos que isso entre uma e outra, ficam juntas, sem repetir o nome.
const JUNTAR_ATE = 2 * 60_000;
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

/** O chat da sala: o servidor só repassa, e nada fica guardado. Quem entra depois não vê o que foi dito antes. */
export function PainelChat() {
  const { chat, conexaoPerdida } = useCliente();
  const [texto, setTexto] = useState('');
  const lista = useRef<HTMLOListElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const noFim = useRef(true);

  useEffect(() => campo.current?.focus(), []);

  // Desce sozinho com a mensagem nova, a não ser que a pessoa tenha subido para ler as antigas.
  useLayoutEffect(() => {
    if (noFim.current && lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [chat]);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (cliente.mandarMensagem(texto)) setTexto('');
  }

  function tecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') cliente.abrirChat(false);
  }

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
          <Mensagem key={m.numero} m={m} junto={juntaComAnterior(chat[i - 1], m)} />
        ))}
      </ol>
      <form className="chat-envio" onSubmit={enviar}>
        <input
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={tecla}
          maxLength={LIMITE_DO_CHAT}
          placeholder={conexaoPerdida ? 'Sem conexão com o servidor…' : 'Mensagem para a sala'}
          disabled={conexaoPerdida}
          aria-label="Mensagem para a sala"
        />
        <button type="submit" className="botao-icone" aria-label="Enviar" disabled={conexaoPerdida || !texto.trim()}>
          <SendHorizontal size={18} />
        </button>
      </form>
      {texto.length > LIMITE_DO_CHAT - 100 && (
        <span className="chat-contador">
          {texto.length}/{LIMITE_DO_CHAT}
        </span>
      )}
    </aside>
  );
}

function juntaComAnterior(anterior: MensagemDoChat | undefined, m: MensagemDoChat): boolean {
  return anterior !== undefined && anterior.de === m.de && m.momento - anterior.momento < JUNTAR_ATE;
}

function Mensagem({ m, junto }: { m: MensagemDoChat; junto: boolean }) {
  if (junto) {
    return (
      <li className="chat-mensagem junto">
        <p>{comLinks(m.texto)}</p>
      </li>
    );
  }
  return (
    <li className={m.minha ? 'chat-mensagem minha' : 'chat-mensagem'}>
      <Avatar nome={m.nome} tamanho={32} />
      <div>
        <span className="chat-autor">
          {m.minha ? 'Você' : m.nome} <time dateTime={new Date(m.momento).toISOString()}>{hora.format(m.momento)}</time>
        </span>
        <p>{comLinks(m.texto)}</p>
      </div>
    </li>
  );
}
