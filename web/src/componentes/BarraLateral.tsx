import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BellRing, Check, Eye, EyeOff, HeadphoneOff, Headphones, LogOut, Mic, MicOff, Settings, SignalLow, SignalMedium, SignalZero, UserPlus, VolumeX } from 'lucide-react';
import { cliente } from '../cliente';
import { LIMITE_POR_SALA, linkDoConvite } from '../conexao/codigoDaSala';
import { pode, servidores, useServidor } from '../servidores';
import { useCliente, useVoz } from '../useCliente';
import { atalhos } from '../voz/atalhos';
import { descrever, type QualidadeDaConexao } from '../voz/qualidade';
import { EU, voz } from '../voz/voz';
import { Avatar } from './Avatar';
import { Configuracoes } from './Configuracoes';
import { ConfiguracoesDoServidor } from './ConfiguracoesDoServidor';
import { Logo } from './Logo';
import { Versao } from './Versao';

export function BarraLateral() {
  const { servidor, pessoas, meuId, meuNome, transmitindo, plateias, assistindo } = useCliente();
  const { falando, remotos, conexao } = useVoz();
  const [copiado, setCopiado] = useState(false);
  const doServidor = useServidor(servidor);
  const [configurandoServidor, setConfigurandoServidor] = useState(false);
  const podeConvidar = doServidor.servidor !== null && pode(doServidor.servidor).convidar;
  const [menuDe, setMenuDe] = useState<string | null>(null); // o amigo com o menu de voz aberto
  const total = pessoas.length + 1;

  /** Um convite novo a cada clique, no link copiado: vale 7 dias, sem limite de usos (os outros, nas configurações). */
  async function convidar() {
    if (!servidor) return;
    const convite = await servidores.convidar(servidor, 24 * 7, null);
    if (!convite.ok) {
      cliente.avisar(convite.erro, 'erro');
      return;
    }
    const link = linkDoConvite(convite.valor.codigo);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Sem área de transferência (página sem HTTPS, ou permissão negada): mostra o link para copiar à mão.
      cliente.avisar(`Copie o link: ${link}`);
      return;
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  // Quem está transmitindo aparece primeiro; depois, quem só está na sala.
  const ordenadas = [...pessoas].sort((a, b) => Number(transmitindo.includes(b.id)) - Number(transmitindo.includes(a.id)));
  const nomesDe = (ids: string[]) => ids.map((id) => cliente.nomeDe(id)).join(', ');

  return (
    <aside className="barra-lateral" aria-label="Sala e pessoas">
      <div className="barra-lateral-topo">
        <div className="logo-e-versao">
          <Logo />
          <Versao />
        </div>
        <button type="button" className="botao-icone botao-sair" aria-label="Sair da sala" title="Sair da sala" onClick={() => cliente.sair()}>
          <LogOut size={18} />
        </button>
      </div>

      {/* O servidor: o ícone, o nome inteiro e a engrenagem em cima; o "Convidar" embaixo, com a largura toda. */}
      <section className="cartao-sala cartao-do-servidor">
        <div className="cartao-sala-servidor">
          <Avatar nome={doServidor.servidor?.nome ?? '…'} foto={doServidor.servidor?.icone} tamanho={32} quadrado />
          <span className="cartao-sala-servidor-texto">
            <span className="rotulo">Servidor</span>
            <strong className="nome-do-servidor" title={doServidor.servidor?.nome}>
              {doServidor.servidor?.nome ?? '…'}
            </strong>
          </span>
          {doServidor.servidor && (
            <button
              type="button"
              className="botao-icone"
              aria-label="Configurações do servidor"
              title="Configurações do servidor"
              onClick={() => setConfigurandoServidor(true)}
            >
              <Settings size={16} />
            </button>
          )}
        </div>
        {podeConvidar && (
          <button type="button" className="botao botao-secundario botao-pequeno" onClick={() => void convidar()}>
            {copiado ? <Check size={14} /> : <UserPlus size={14} />}
            {copiado ? 'Copiado' : 'Convidar'}
          </button>
        )}
      </section>
      {configurandoServidor && doServidor.servidor && (
        <ConfiguracoesDoServidor
          servidor={doServidor.servidor}
          aoMudar={doServidor.setServidor}
          aoFechar={() => {
            setConfigurandoServidor(false);
            void doServidor.recarregar();
          }}
        />
      )}

      <section className="pessoas" aria-labelledby="titulo-pessoas">
        <h2 id="titulo-pessoas" className="rotulo">
          Na sala · {total}/{LIMITE_POR_SALA}
        </h2>
        <ul>
          {ordenadas.map(({ id, nome }) => {
            const aoVivo = transmitindo.includes(id);
            const plateia = plateias[id] ?? [];
            const assistoEssa = assistindo.includes(id);
            const naVoz = remotos[id];
            const menuAberto = menuDe === id;
            const silenciado = voz.silenciadoParaMim(id);
            return (
              <Fragment key={id}>
                <li className={menuAberto ? 'pessoa aberta' : 'pessoa'}>
                  <button
                    type="button"
                    className="pessoa-abrir"
                    aria-expanded={menuAberto}
                    aria-label={`${nome}: volume da voz e silenciar`}
                    title="Volume da voz e silenciar"
                    onClick={() => setMenuDe(menuAberto ? null : id)}
                  >
                    <Avatar nome={nome} foto={cliente.fotoDe(id)} aoVivo={aoVivo} falando={falando.includes(id)} />
                    <span className="pessoa-texto">
                      <span className="pessoa-nome">
                        <span className="pessoa-nome-texto">{nome}</span>
                        <SinalDaConexao q={conexao[id]} nome={nome} />
                        {(naVoz?.surdo || naVoz?.mudo || silenciado) && (
                          <span className="pessoa-voz">
                            {naVoz?.surdo ? (
                              <HeadphoneOff size={13} aria-label="som desligado" />
                            ) : naVoz?.mudo ? (
                              <MicOff size={13} aria-label="microfone desligado" />
                            ) : null}
                            {silenciado && <VolumeX size={13} aria-label="silenciado para você" />}
                          </span>
                        )}
                      </span>
                      <span className="pessoa-status">
                        {aoVivo ? (
                          <>
                            <span className="selo-ao-vivo">Ao vivo</span>
                            <span className="pessoa-plateia" title={plateia.length ? `Assistindo: ${nomesDe(plateia)}` : 'Ninguém assistindo'}>
                              <Eye size={12} aria-hidden="true" /> {plateia.length}
                            </span>
                          </>
                        ) : (
                          'Na sala'
                        )}
                      </span>
                    </span>
                  </button>
                  {aoVivo && (
                    <button
                      type="button"
                      className={assistoEssa ? 'botao-quadrado' : 'botao-quadrado primario'}
                      onClick={() => (assistoEssa ? cliente.deixarDeAssistir(id) : cliente.assistir(id))}
                      aria-label={assistoEssa ? `Parar de assistir ${nome}` : `Assistir ${nome}`}
                      title={assistoEssa ? 'Parar de assistir' : 'Assistir'}
                    >
                      {assistoEssa ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  )}
                </li>
                {menuAberto && <MenuDaVoz id={id} nome={nome} aoFechar={() => setMenuDe(null)} />}
              </Fragment>
            );
          })}
          {pessoas.length === 0 && (
            <li className="pessoa-vazia">
              Só você por aqui. Clique em Convidar e mande o link para os amigos: eles entram com a conta do Google ou do Discord.
            </li>
          )}
        </ul>
      </section>

      <Voce nome={meuNome} plateia={meuId ? (plateias[meuId] ?? null) : null} nomesDe={nomesDe} />
    </aside>
  );
}

/** O cartão de baixo: você, a prévia da sua transmissão, quem te assiste, e o microfone, o som e a engrenagem. */
function Voce({ nome, plateia, nomesDe }: { nome: string; plateia: string[] | null; nomesDe: (ids: string[]) => string }) {
  const { minhaTela, minhaFoto } = useCliente();
  const { mudo, surdo, falando, microfone, ajustes, apertado } = useVoz();
  const teclaDeFalar = useSyncExternalStore(atalhos.inscrever, () => atalhos.ler().falar.nome);
  const previa = useRef<HTMLVideoElement>(null);
  const [configuracoes, setConfiguracoes] = useState(false);
  const semMicrofone = microfone !== 'ok' && microfone !== 'ligando';
  const microfoneDesligado = mudo || surdo || semMicrofone;
  // Apertar para falar, com a tecla solta: diz qual tecla abre o microfone (ou que falta escolher uma).
  const esperandoATecla = ajustes.apertarParaFalar && !apertado;
  const status = semMicrofone
    ? 'Sem microfone'
    : surdo
      ? 'Som desligado'
      : mudo
        ? 'Mudo'
        : esperandoATecla
          ? teclaDeFalar
            ? `Aperte ${teclaDeFalar} para falar`
            : 'Escolha a tecla de falar (engrenagem)'
          : minhaTela
            ? 'Ao vivo'
            : 'Na voz';

  useEffect(() => {
    if (previa.current) previa.current.srcObject = minhaTela;
  }, [minhaTela]);

  return (
    <section className="voce" aria-label="Você">
      {minhaTela && (
        <div className="previa">
          <video ref={previa} autoPlay playsInline muted />
          <span className="selo-ao-vivo">Ao vivo</span>
        </div>
      )}
      {minhaTela && (
        <p className="voce-plateia">
          {plateia && plateia.length > 0 ? (
            <>
              <Eye size={14} aria-hidden="true" /> Assistindo você: {nomesDe(plateia)}
            </>
          ) : (
            'Ninguém assiste você ainda.'
          )}
        </p>
      )}
      <div className="voce-linha">
        <Avatar nome={nome} foto={minhaFoto} aoVivo={Boolean(minhaTela)} falando={falando.includes(EU)} />
        <div className="pessoa-texto">
          <span className="pessoa-nome" title={nome}>
            <span className="pessoa-nome-texto">{nome}</span>
          </span>
          <span className={microfoneDesligado ? 'pessoa-status desligado' : 'pessoa-status'} title={minhaTela ? cliente.descreverFonte() : undefined}>
            {status}
          </span>
        </div>
        <div className="voce-botoes">
          <button
            type="button"
            className={microfoneDesligado ? 'botao-icone desligado' : 'botao-icone'}
            aria-pressed={mudo || surdo}
            aria-label={mudo || surdo ? 'Ligar o microfone' : 'Desligar o microfone'}
            title={semMicrofone ? 'Sem microfone: veja na engrenagem' : mudo || surdo ? 'Ligar o microfone' : 'Desligar o microfone'}
            onClick={() => voz.alternarMudo()}
          >
            {microfoneDesligado ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            type="button"
            className={surdo ? 'botao-icone desligado' : 'botao-icone'}
            aria-pressed={surdo}
            aria-label={surdo ? 'Ligar o som' : 'Desligar o som e o microfone'}
            title={surdo ? 'Ligar o som' : 'Desligar o som (e o microfone)'}
            onClick={() => voz.alternarSurdo()}
          >
            {surdo ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
          </button>
          <button type="button" className="botao-icone" aria-label="Configurações" title="Configurações" onClick={() => setConfiguracoes(true)}>
            <Settings size={18} />
          </button>
        </div>
      </div>
      {configuracoes && <Configuracoes aoFechar={() => setConfiguracoes(false)} />}
    </section>
  );
}

/** Clicar num amigo: o volume da voz dele (0 a 200%) e "silenciar para mim", lembrados pelo nome. */
/**
 * A conexão com o amigo, só quando ela está ruim: uma lista cheia de ícones verdes não diria nada. Os números ficam
 * na dica e no menu de voz da pessoa.
 */
function SinalDaConexao({ q, nome }: { q: QualidadeDaConexao | undefined; nome: string }) {
  if (!q || q.nivel === 'boa' || q.nivel === 'conectando') return null;
  const Icone = q.nivel === 'instavel' ? SignalMedium : q.nivel === 'ruim' ? SignalLow : SignalZero;
  const texto = `Conexão com ${nome}: ${descrever(q)}`;
  return (
    <span className={`sinal-da-conexao sinal-${q.nivel}`} title={texto}>
      <Icone size={14} aria-label={texto} />
    </span>
  );
}

function MenuDaVoz({ id, nome, aoFechar }: { id: string; nome: string; aoFechar: () => void }) {
  const { conexao } = useVoz(); // redesenha quando o volume muda
  const q = conexao[id];
  const volume = voz.volumeDe(id);
  const silenciado = voz.silenciadoParaMim(id);
  const caixa = useRef<HTMLLIElement>(null);

  // O foco vai para o volume só ao abrir. Junto com o efeito de baixo, ele voltava a cada desenho da barra lateral
  // (o aoFechar é outra função a cada vez, e a barra redesenha quando alguém começa ou para de falar): quem digitava
  // no chat perdia o campo sempre que aquele amigo falava.
  useEffect(() => caixa.current?.querySelector('input')?.focus(), []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    addEventListener('keydown', tecla);
    return () => removeEventListener('keydown', tecla);
  }, [aoFechar]);

  return (
    <li ref={caixa} className="menu-da-voz" aria-label={`Voz de ${nome}`}>
      <label className="campo">
        <span>
          Volume da voz <span className="volume-numero">{volume}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={volume}
          onChange={(e) => voz.mudarVolumeDe(id, Number(e.target.value))}
          style={{ '--preenchido': `${volume / 2}%` } as React.CSSProperties}
        />
      </label>
      <label className="interruptor">
        <input type="checkbox" role="switch" checked={silenciado} onChange={(e) => voz.silenciarParaMim(id, e.target.checked)} />
        <span>Silenciar para mim</span>
      </label>
      <BotaoDeChamar id={id} nome={nome} />
      {q && (
        <p className={`menu-da-voz-conexao sinal-${q.nivel}`}>
          <span className="ponto" aria-hidden="true" /> Conexão {descrever(q)}
        </p>
      )}
    </li>
  );
}

/**
 * Chamar a atenção do amigo (por exemplo, ele com o som desligado e você de volta ao PC): ele ouve um som e vê um
 * aviso, mesmo com o som do Ozamigos e as notificações desligados. Até 5 vezes por minuto; depois, o botão conta o
 * tempo.
 */
function BotaoDeChamar({ id, nome }: { id: string; nome: string }) {
  const [, redesenhar] = useState(0);
  const falta = cliente.chamarDeNovoEm(id);
  useEffect(() => {
    if (falta <= 0) return;
    const relogio = setTimeout(() => redesenhar((n) => n + 1), Math.min(falta, 1000));
    return () => clearTimeout(relogio);
  });
  return (
    <button
      type="button"
      className="botao botao-secundario botao-pequeno menu-da-voz-chamar"
      disabled={falta > 0}
      title={`Toca um som para ${nome} e mostra um aviso, mesmo com o som dele desligado. Até 5 vezes por minuto.`}
      onClick={() => {
        cliente.chamar(id);
        redesenhar((n) => n + 1);
      }}
    >
      <BellRing size={14} />
      {falta > 0 ? `Chamar de novo em ${Math.ceil(falta / 1000)} s` : `Chamar ${nome}`}
    </button>
  );
}
