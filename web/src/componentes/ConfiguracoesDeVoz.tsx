import { useEffect, useRef, useState } from 'react';
import { Server, X } from 'lucide-react';
import { ponte } from '../ponte';
import { ligarSons, sonsLigados } from '../sons';
import { useVoz } from '../useCliente';
import type { Supressao } from '../voz/ajustes';
import { voz } from '../voz/voz';

const SUPRESSOES: { valor: Supressao; titulo: string; texto: string }[] = [
  { valor: 'rnnoise', titulo: 'RNNoise (recomendado)', texto: 'Uma rede neural tira teclado, ventilador e barulho de fundo, e deixa a voz.' },
  { valor: 'navegador', titulo: 'Do navegador', texto: 'A supressão do próprio Chrome: mais leve, tira menos ruído.' },
  { valor: 'nenhuma', titulo: 'Desligada', texto: 'O microfone vai como está. Bom para microfones de estúdio em lugar silencioso.' },
];

/** dB (−100 a 0) para a posição na barra (0 a 100%). */
const posicao = (db: number) => `${Math.min(100, Math.max(0, db + 100))}%`;

/** A engrenagem: microfone, saída, volumes, sensibilidade e o processamento da voz, como no Discord. */
export function ConfiguracoesDeVoz({ aoFechar }: { aoFechar: () => void }) {
  const { ajustes, entradas, saidas, testando, rnnoise, podeEscolherSaida, microfone } = useVoz();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [sons, setSons] = useState(sonsLigados);

  useEffect(() => {
    dialogo.current?.showModal();
    void voz.atualizarDispositivos();
    return () => voz.pararTeste(); // fechou a engrenagem: para de se ouvir
  }, []);

  const mudar = voz.mudarAjustes.bind(voz);
  const semMicrofone = microfone === 'sem-permissao' || microfone === 'sem-microfone' || microfone === 'erro';

  return (
    <dialog ref={dialogo} className="seletor configuracoes" aria-labelledby="titulo-configuracoes" onClose={aoFechar}>
      <header>
        <h2 id="titulo-configuracoes">Voz e áudio</h2>
        <button type="button" className="botao-icone" aria-label="Fechar" onClick={() => dialogo.current?.close()}>
          <X size={18} />
        </button>
      </header>

      <div className="configuracoes-corpo">
        {semMicrofone && (
          <p className="configuracoes-alerta" role="status">
            {microfone === 'sem-permissao'
              ? 'O Ozamigos não tem permissão para usar o microfone. Libere nas configurações de privacidade do Windows (Microfone) e escolha o microfone de novo aqui.'
              : 'Nenhum microfone funcionando. Conecte um e escolha abaixo.'}
          </p>
        )}

        <div className="configuracoes-duas">
          <label className="campo">
            <span>Microfone</span>
            <select value={ajustes.entrada} onChange={(e) => mudar({ entrada: e.target.value })}>
              <option value="">Padrão do Windows</option>
              {entradas.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Saída de áudio</span>
            <select value={ajustes.saida} disabled={!podeEscolherSaida} onChange={(e) => mudar({ saida: e.target.value })}>
              <option value="">Padrão do Windows</option>
              {saidas.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </select>
            {!podeEscolherSaida && <small className="ajuda">Este navegador não deixa escolher a saída; no app do Ozamigos dá.</small>}
          </label>
          <Volume rotulo="Volume do microfone" valor={ajustes.volumeEntrada} aoMudar={(v) => mudar({ volumeEntrada: v })} />
          <Volume rotulo="Volume de saída" valor={ajustes.volumeSaida} aoMudar={(v) => mudar({ volumeSaida: v })} />
        </div>

        <section className="configuracoes-secao" aria-labelledby="titulo-sensibilidade">
          <div className="configuracoes-linha">
            <h3 id="titulo-sensibilidade">Sensibilidade do microfone</h3>
            <label className="interruptor">
              <input
                type="checkbox"
                role="switch"
                checked={ajustes.sensibilidadeAutomatica}
                onChange={(e) => mudar({ sensibilidadeAutomatica: e.target.checked })}
              />
              <span>Ajustar sozinho</span>
            </label>
          </div>
          <p className="ajuda">
            {ajustes.sensibilidadeAutomatica
              ? rnnoise
                ? 'O microfone abre quando o RNNoise reconhece voz acima do barulho do ambiente: teclado, mouse e ventilador não abrem.'
                : 'O microfone abre quando o som passa do barulho do ambiente, que o Ozamigos acompanha sozinho.'
              : 'Arraste o limite: o microfone abre quando a barra passa dele. Fale normalmente e deixe o limite logo acima do barulho de quando você está quieto.'}
          </p>
          <Medidor automatica={ajustes.sensibilidadeAutomatica} limiarDb={ajustes.limiarDb} aoMudarLimiar={(db) => mudar({ limiarDb: db })} />
          <div className="configuracoes-linha">
            <button type="button" className={testando ? 'botao botao-perigo' : 'botao botao-secundario'} disabled={semMicrofone} onClick={() => voz.alternarTeste()}>
              {testando ? 'Parar o teste' : 'Testar o microfone'}
            </button>
            <span className="ajuda">{testando ? 'Você está se ouvindo como os amigos ouvem (use fone para não ecoar).' : 'Para se ouvir como os amigos ouvem.'}</span>
          </div>
        </section>

        <section className="configuracoes-secao" aria-labelledby="titulo-processamento">
          <h3 id="titulo-processamento">Processamento da voz</h3>
          <fieldset className="opcoes">
            <legend className="rotulo">Supressão de ruído</legend>
            {SUPRESSOES.map((s) => (
              <label key={s.valor} className={ajustes.supressao === s.valor ? 'opcao escolhida' : 'opcao'}>
                <input type="radio" name="supressao" checked={ajustes.supressao === s.valor} onChange={() => mudar({ supressao: s.valor })} />
                <span>
                  <strong>{s.titulo}</strong>
                  <small>{s.valor === 'rnnoise' && !rnnoise && microfone === 'ok' ? 'Não carregou neste navegador: a voz vai sem ela.' : s.texto}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="interruptor">
            <input type="checkbox" role="switch" checked={ajustes.cancelarEco} onChange={(e) => mudar({ cancelarEco: e.target.checked })} />
            <span>
              Cancelamento de eco <small className="ajuda">evita que os amigos ouçam a própria voz saindo da sua caixa de som</small>
            </span>
          </label>
          <label className="interruptor">
            <input type="checkbox" role="switch" checked={ajustes.ganhoAutomatico} onChange={(e) => mudar({ ganhoAutomatico: e.target.checked })} />
            <span>
              Controle automático de ganho <small className="ajuda">deixa sua voz num volume parecido, perto ou longe do microfone</small>
            </span>
          </label>
        </section>

        <section className="configuracoes-secao" aria-labelledby="titulo-geral">
          <h3 id="titulo-geral">Geral</h3>
          <label className="interruptor">
            <input
              type="checkbox"
              role="switch"
              checked={sons}
              onChange={(e) => {
                ligarSons(e.target.checked);
                setSons(e.target.checked);
              }}
            />
            <span>Sons de aviso (alguém entrou, saiu, começou a transmitir, microfone e fone)</span>
          </label>
          {ponte && (
            <button type="button" className="botao botao-secundario" onClick={() => ponte!.trocarServidor()}>
              <Server size={16} /> Trocar o servidor
            </button>
          )}
        </section>
      </div>
    </dialog>
  );
}

function Volume({ rotulo, valor, aoMudar }: { rotulo: string; valor: number; aoMudar: (v: number) => void }) {
  return (
    <label className="campo">
      <span>
        {rotulo} <span className="volume-numero">{valor}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={valor}
        onChange={(e) => aoMudar(Number(e.target.value))}
        style={{ '--preenchido': `${valor / 2}%` } as React.CSSProperties}
      />
    </label>
  );
}

/**
 * O volume do microfone ao vivo. Na sensibilidade manual, o limite é arrastado por cima da barra;
 * a barra fica verde quando o microfone está aberto. Atualiza direto no elemento, sem redesenhar a tela.
 */
function Medidor({ automatica, limiarDb, aoMudarLimiar }: { automatica: boolean; limiarDb: number; aoMudarLimiar: (db: number) => void }) {
  const barra = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      voz.ouvirMedida(({ nivelDb, aberta }) => {
        if (!barra.current) return;
        barra.current.style.width = posicao(nivelDb);
        barra.current.classList.toggle('aberto', aberta);
      }),
    [],
  );
  return (
    <div className="medidor">
      <div className="medidor-trilha" aria-hidden="true">
        <div ref={barra} className="medidor-nivel" />
        {!automatica && <div className="medidor-limite" style={{ left: posicao(limiarDb) }} />}
      </div>
      {!automatica && (
        <input
          type="range"
          className="medidor-controle"
          min={-100}
          max={0}
          value={limiarDb}
          onChange={(e) => aoMudarLimiar(Number(e.target.value))}
          aria-label="Limite de sensibilidade do microfone"
          aria-valuetext={`${limiarDb} dB`}
        />
      )}
    </div>
  );
}
