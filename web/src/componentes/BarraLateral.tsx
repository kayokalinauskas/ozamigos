import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Check, Eye, EyeOff, Link, LogOut, Server } from 'lucide-react';
import { LIMITE_POR_SALA, cliente, linkDaSala } from '../cliente';
import { ponte } from '../ponte';
import { ligarSons, sonsLigados } from '../sons';
import { useCliente } from '../useCliente';
import { Avatar } from './Avatar';
import { Logo } from './Logo';

export function BarraLateral() {
  const { sala, pessoas, meuId, meuNome, transmitindo, plateias, assistindo } = useCliente();
  const [copiado, setCopiado] = useState(false);
  const total = pessoas.length + 1;

  async function copiarLink() {
    await navigator.clipboard.writeText(linkDaSala(sala));
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  // Quem está transmitindo aparece primeiro; depois, quem só está na sala.
  const ordenadas = [...pessoas].sort((a, b) => Number(transmitindo.includes(b.id)) - Number(transmitindo.includes(a.id)));
  const nomesDe = (ids: string[]) => ids.map((id) => cliente.nomeDe(id)).join(', ');

  return (
    <aside className="barra-lateral" aria-label="Sala e pessoas">
      <Logo />

      <section className="cartao-sala">
        <div>
          <span className="rotulo">Sala</span>
          <code className="codigo-sala">{sala}</code>
        </div>
        <button type="button" className="botao botao-secundario botao-pequeno" onClick={copiarLink}>
          {copiado ? <Check size={14} /> : <Link size={14} />}
          {copiado ? 'Link copiado' : 'Copiar link'}
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
            return (
              <li key={id} className={aoVivo ? 'pessoa pessoa-ao-vivo' : 'pessoa'}>
                <Avatar nome={nome} aoVivo={aoVivo} />
                <div className="pessoa-texto">
                  <span className="pessoa-nome">{nome}</span>
                  <span className="pessoa-status">
                    {aoVivo ? (
                      <>
                        <span className="selo-ao-vivo">Ao vivo</span>
                        <span title={plateia.length ? `Assistindo: ${nomesDe(plateia)}` : 'Ninguém assistindo'}>
                          <Eye size={12} aria-hidden="true" /> {plateia.length}
                        </span>
                      </>
                    ) : (
                      'Na sala'
                    )}
                  </span>
                </div>
                {aoVivo && (
                  <button
                    type="button"
                    className={assistoEssa ? 'botao botao-secundario botao-pequeno' : 'botao botao-primario botao-pequeno'}
                    onClick={() => (assistoEssa ? cliente.deixarDeAssistir(id) : cliente.assistir(id))}
                    aria-label={assistoEssa ? `Parar de assistir ${nome}` : `Assistir ${nome}`}
                  >
                    {assistoEssa ? <EyeOff size={14} /> : <Eye size={14} />}
                    {assistoEssa ? 'Parar' : 'Assistir'}
                  </button>
                )}
              </li>
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

/** O cartão de baixo: você, a prévia da sua transmissão e quem está te assistindo. */
function Voce({ nome, plateia, nomesDe }: { nome: string; plateia: string[] | null; nomesDe: (ids: string[]) => string }) {
  const { minhaTela } = useCliente();
  const previa = useRef<HTMLVideoElement>(null);
  const [sons, setSons] = useState(sonsLigados);

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
            'Ninguém está assistindo você ainda: o vídeo só sai do seu PC quando alguém clica em Assistir.'
          )}
        </p>
      )}
      <div className="voce-linha">
        <Avatar nome={nome} aoVivo={Boolean(minhaTela)} />
        <div className="pessoa-texto">
          <span className="pessoa-nome">{nome}</span>
          <span className="pessoa-status">{minhaTela ? cliente.descreverFonte() : 'Você'}</span>
        </div>
        <button
          type="button"
          className="botao-icone"
          aria-pressed={sons}
          aria-label={sons ? 'Desligar sons de aviso' : 'Ligar sons de aviso'}
          title={sons ? 'Sons de aviso ligados' : 'Sons de aviso desligados'}
          onClick={() => {
            ligarSons(!sons);
            setSons(!sons);
          }}
        >
          {sons ? <Bell size={18} /> : <BellOff size={18} />}
        </button>
        {ponte && (
          <button type="button" className="botao-icone" aria-label="Trocar o servidor" title="Trocar o servidor" onClick={() => ponte!.trocarServidor()}>
            <Server size={18} />
          </button>
        )}
        <button type="button" className="botao-icone botao-sair" aria-label="Sair da sala" title="Sair da sala" onClick={() => cliente.sair()}>
          <LogOut size={18} />
        </button>
      </div>
    </section>
  );
}
