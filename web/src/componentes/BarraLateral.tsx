import { Fragment, useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, HeadphoneOff, Headphones, Link, LogOut, Mic, MicOff, Settings, VolumeX } from 'lucide-react';
import { LIMITE_POR_SALA, cliente, linkDaSala } from '../cliente';
import { useCliente, useVoz } from '../useCliente';
import { EU, voz } from '../voz/voz';
import { Avatar } from './Avatar';
import { ConfiguracoesDeVoz } from './ConfiguracoesDeVoz';
import { Logo } from './Logo';

export function BarraLateral() {
  const { sala, pessoas, meuId, meuNome, transmitindo, plateias, assistindo } = useCliente();
  const { falando, remotos } = useVoz();
  const [copiado, setCopiado] = useState(false);
  const [menuDe, setMenuDe] = useState<string | null>(null); // o amigo com o menu de voz aberto
  const total = pessoas.length + 1;

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(linkDaSala(sala));
    } catch {
      // Sem área de transferência (página sem HTTPS, ou permissão negada): mostra o link para copiar à mão.
      cliente.avisar(`Copie o link: ${linkDaSala(sala)}`);
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
        <Logo />
        <button type="button" className="botao-icone botao-sair" aria-label="Sair da sala" title="Sair da sala" onClick={() => cliente.sair()}>
          <LogOut size={18} />
        </button>
      </div>

      <section className="cartao-sala">
        <div>
          <span className="rotulo">Sala</span>
          <code className="codigo-sala" title={sala}>
            {sala}
          </code>
        </div>
        <button type="button" className="botao botao-secundario botao-pequeno" onClick={copiarLink}>
          {copiado ? <Check size={14} /> : <Link size={14} />}
          {copiado ? 'Copiado' : 'Copiar link'}
        </button>
      </section>

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
                    <Avatar nome={nome} aoVivo={aoVivo} falando={falando.includes(id)} />
                    <span className="pessoa-texto">
                      <span className="pessoa-nome">
                        <span className="pessoa-nome-texto">{nome}</span>
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
              Só você por aqui. Copie o link e mande para os amigos, com a senha <strong>separada</strong> do link.
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
  const { minhaTela } = useCliente();
  const { mudo, surdo, falando, microfone } = useVoz();
  const previa = useRef<HTMLVideoElement>(null);
  const [configuracoes, setConfiguracoes] = useState(false);
  const semMicrofone = microfone !== 'ok' && microfone !== 'ligando';
  const microfoneDesligado = mudo || surdo || semMicrofone;
  const status = semMicrofone ? 'Sem microfone' : surdo ? 'Som desligado' : mudo ? 'Mudo' : minhaTela ? 'Ao vivo' : 'Na voz';

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
            'Ninguém assiste você ainda: o vídeo só sai do seu PC quando alguém clica em Assistir.'
          )}
        </p>
      )}
      <div className="voce-linha">
        <Avatar nome={nome} aoVivo={Boolean(minhaTela)} falando={falando.includes(EU)} />
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
          <button type="button" className="botao-icone" aria-label="Configurações de voz e áudio" title="Configurações de voz e áudio" onClick={() => setConfiguracoes(true)}>
            <Settings size={18} />
          </button>
        </div>
      </div>
      {configuracoes && <ConfiguracoesDeVoz aoFechar={() => setConfiguracoes(false)} />}
    </section>
  );
}

/** Clicar num amigo: o volume da voz dele (0 a 200%) e "silenciar para mim", lembrados pelo nome. */
function MenuDaVoz({ id, nome, aoFechar }: { id: string; nome: string; aoFechar: () => void }) {
  useVoz(); // redesenha quando o volume muda
  const volume = voz.volumeDe(id);
  const silenciado = voz.silenciadoParaMim(id);
  const caixa = useRef<HTMLLIElement>(null);

  useEffect(() => {
    caixa.current?.querySelector('input')?.focus();
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
    </li>
  );
}
