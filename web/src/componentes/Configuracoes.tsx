import { useEffect, useRef, useState } from 'react';
import { Download, Server, X } from 'lucide-react';
import { TIPOS_DE_NOTIFICACAO, ligarNotificacao, notificacaoLigada } from '../notificacoes';
import { ponte } from '../ponte';
import { QUALIDADE, QUALIDADES, type Qualidade } from '../qualidade';
import { escolherQualidade, qualidadeEscolhida, qualidadesAltas } from '../escolhaDeQualidade';
import { ligarSons, sonsLigados } from '../sons';
import { useVoz } from '../useCliente';
import type { Supressao } from '../voz/ajustes';
import { voz } from '../voz/voz';
import { AbaDeAtalhos } from './Atalhos';
import { AbaDaConta } from './Conta';
import { SITE } from './RodapeDaEntrada';

const SUPRESSOES: { valor: Supressao; titulo: string; texto: string }[] = [
  { valor: 'rnnoise', titulo: 'Inteligente (recomendado)', texto: 'Tira teclado, ventilador e barulho de fundo, e deixa só a voz.' },
  { valor: 'navegador', titulo: 'Básica', texto: 'Mais leve, tira menos ruído.' },
  { valor: 'nenhuma', titulo: 'Desligada', texto: 'O microfone vai como está. Bom para microfones de estúdio em lugar silencioso.' },
];

/** dB (−100 a 0) para a posição na barra (0 a 100%). */
const posicao = (db: number) => `${Math.min(100, Math.max(0, db + 100))}%`;

// No navegador (e no celular), quem escolhe o microfone e a saída padrão é o sistema, não necessariamente o Windows.
const PADRAO = ponte ? 'Padrão do Windows' : 'Padrão do sistema';

const ABAS = [
  { id: 'conta', titulo: 'Conta' },
  { id: 'voz', titulo: 'Voz e áudio' },
  { id: 'atalhos', titulo: 'Atalhos' },
  { id: 'notificacoes', titulo: 'Notificações' },
  { id: 'geral', titulo: 'Geral' },
] as const;
type Aba = (typeof ABAS)[number]['id'];
// Num celular (sem teclado nem mouse), atalhos de teclado não servem.
const SO_TOQUE = typeof matchMedia !== 'undefined' && matchMedia('(hover: none) and (pointer: coarse)').matches;
const ABAS_AQUI = ABAS.filter((a) => a.id !== 'atalhos' || !SO_TOQUE);

/** A engrenagem, em abas como no Discord: a voz e o áudio, as notificações e o resto. */
export function Configuracoes({ aoFechar }: { aoFechar: () => void }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [aba, setAba] = useState<Aba>('voz');

  useEffect(() => {
    dialogo.current?.showModal();
    void voz.atualizarDispositivos();
    return () => voz.pararTeste(); // fechou a engrenagem: para de se ouvir
  }, []);

  function trocarAba(nova: Aba) {
    if (nova !== 'voz') voz.pararTeste(); // o teste do microfone só faz sentido com o medidor na tela
    setAba(nova);
  }

  return (
    <dialog ref={dialogo} className="seletor configuracoes" aria-labelledby="titulo-configuracoes" onClose={aoFechar}>
      <header>
        <h2 id="titulo-configuracoes">Configurações</h2>
        <button type="button" className="botao-icone" aria-label="Fechar" onClick={() => dialogo.current?.close()}>
          <X size={18} />
        </button>
      </header>
      <div className="segmentado configuracoes-abas" role="tablist" aria-label="Seções das configurações">
        {ABAS_AQUI.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            id={`aba-${a.id}`}
            aria-selected={aba === a.id}
            aria-controls={`painel-${a.id}`}
            onClick={() => trocarAba(a.id)}
          >
            {a.titulo}
          </button>
        ))}
      </div>
      <div className="configuracoes-corpo" role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
        {aba === 'conta' && <AbaDaConta />}
        {aba === 'voz' && <AbaDeVoz />}
        {aba === 'atalhos' && <AbaDeAtalhos />}
        {aba === 'notificacoes' && <AbaDeNotificacoes />}
        {aba === 'geral' && <AbaGeral />}
      </div>
    </dialog>
  );
}

function AbaDeVoz() {
  const { ajustes, entradas, saidas, testando, rnnoise, podeEscolherSaida, microfone } = useVoz();
  const mudar = voz.mudarAjustes.bind(voz);
  const semMicrofone = microfone === 'sem-permissao' || microfone === 'sem-microfone' || microfone === 'erro';

  return (
    <>
      {semMicrofone && (
        <p className="configuracoes-alerta" role="status">
          {microfone === 'sem-permissao'
            ? ponte
              ? 'O Ozamigos não tem permissão para usar o microfone. Libere nas configurações de privacidade do Windows (Microfone) e escolha o microfone de novo aqui.'
              : 'O navegador não deixou usar o microfone. Libere no cadeado, ao lado do endereço, e recarregue a página.'
            : 'Nenhum microfone funcionando. Conecte um e escolha abaixo.'}
        </p>
      )}

      <div className="configuracoes-duas">
        <label className="campo">
          <span>Microfone</span>
          <select value={ajustes.entrada} onChange={(e) => mudar({ entrada: e.target.value })}>
            <option value="">{PADRAO}</option>
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
            <option value="">{PADRAO}</option>
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
              ? 'O microfone abre quando reconhece voz acima do barulho do ambiente: teclado, mouse e ventilador não abrem.'
              : 'O microfone abre quando o som passa do barulho do ambiente.'
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

    </>
  );
}

function AbaDeNotificacoes() {
  const [sons, setSons] = useState(sonsLigados);
  const [ligadas, setLigadas] = useState(() => Object.fromEntries(TIPOS_DE_NOTIFICACAO.map(({ tipo }) => [tipo, notificacaoLigada(tipo)])));
  const [permissao, setPermissao] = useState(() => (typeof Notification === 'undefined' ? 'denied' : Notification.permission));
  const onde = ponte ? 'do Windows' : 'do navegador';

  return (
    <>
      <section className="configuracoes-secao" aria-labelledby="titulo-sons">
        <h3 id="titulo-sons">Sons</h3>
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
          <span>Sons de aviso (alguém entrou, saiu, começou a transmitir, mensagem no chat, microfone e fone)</span>
        </label>
      </section>

      <section className="configuracoes-secao" aria-labelledby="titulo-notificacoes">
        <h3 id="titulo-notificacoes">Notificações {onde}</h3>
        <p className="ajuda">Aparecem só com o Ozamigos atrás de outra janela, o jogo por exemplo. Com ele na frente, o aviso na tela basta.</p>
        {permissao === 'denied' && (
          <p className="configuracoes-alerta" role="status">
            {ponte
              ? 'O Windows está bloqueando as notificações do Ozamigos. Libere em Configurações do Windows → Sistema → Notificações.'
              : 'O navegador bloqueou as notificações deste site. Libere no cadeado, ao lado do endereço.'}
          </p>
        )}
        {permissao === 'default' && (
          <button
            type="button"
            className="botao botao-secundario"
            onClick={() => void Notification.requestPermission().then(setPermissao, () => undefined)}
          >
            Permitir as notificações
          </button>
        )}
        {TIPOS_DE_NOTIFICACAO.map(({ tipo, titulo }) => (
          <label key={tipo} className="interruptor">
            <input
              type="checkbox"
              role="switch"
              checked={ligadas[tipo]}
              onChange={(e) => {
                ligarNotificacao(tipo, e.target.checked);
                setLigadas({ ...ligadas, [tipo]: e.target.checked });
              }}
            />
            <span>{titulo}</span>
          </label>
        ))}
      </section>
    </>
  );
}

function AbaGeral() {
  // null: o app é anterior à 1.2.13 (sem bandeja) ou ainda está respondendo.
  const [bandeja, setBandeja] = useState<boolean | null>(null);
  useEffect(() => {
    void ponte?.bandeja?.ler().then(setBandeja, () => undefined);
  }, []);

  return (
    <>
      {bandeja !== null && (
        <section className="configuracoes-secao" aria-labelledby="titulo-janela">
          <h3 id="titulo-janela">Janela</h3>
          <label className="interruptor">
            <input
              type="checkbox"
              role="switch"
              checked={bandeja}
              onChange={(e) => {
                ponte!.bandeja!.definir(e.target.checked);
                setBandeja(e.target.checked);
              }}
            />
            <span>
              Ao fechar a janela, deixar o Ozamigos aberto na bandeja{' '}
              <small className="ajuda">perto do relógio: a conversa e as transmissões continuam. Para sair, use o botão direito no ícone.</small>
            </span>
          </label>
        </section>
      )}
      {qualidadesAltas() && <SecaoDaQualidade />}
      <section className="configuracoes-secao" aria-labelledby="titulo-versao">
        <h3 id="titulo-versao">Versão</h3>
        <p className="ajuda">
          {ponte?.versao ? `App para Windows ${ponte.versao}` : 'Versão web'}
          {__COMMIT__ && ` · ${__COMMIT__}`}. O Ozamigos se atualiza sozinho.
        </p>
      </section>
      <section className="configuracoes-secao" aria-labelledby="titulo-servidor">
        <h3 id="titulo-servidor">Servidor</h3>
        <p className="ajuda">{location.host}</p>
        {ponte ? (
          <button type="button" className="botao botao-secundario" onClick={() => ponte!.trocarServidor()}>
            <Server size={16} /> Trocar o servidor
          </button>
        ) : (
          <a className="botao botao-secundario" href={SITE}>
            <Download size={16} /> Baixar o app para Windows (som do jogo sem eco)
          </a>
        )}
      </section>
    </>
  );
}

/**
 * A qualidade da transmissão (só no app): 720p · 30 por padrão; 1080p e 60 fps são opções, com o custo dito antes.
 * Fica aqui, longe da tela principal, de propósito (pedido do dono): o 720p · 30 continua sendo o que todos usam.
 */
function SecaoDaQualidade() {
  const [qualidade, setQualidade] = useState<Qualidade>(qualidadeEscolhida);
  const { fps, altura } = QUALIDADES[qualidade];
  return (
    <section className="configuracoes-secao" aria-labelledby="titulo-qualidade">
      <h3 id="titulo-qualidade">Qualidade da transmissão</h3>
      <fieldset className="opcoes">
        <legend className="visualmente-escondido">Qualidade da transmissão</legend>
        {(Object.keys(QUALIDADES) as Qualidade[]).map((valor) => (
          <label key={valor} className={qualidade === valor ? 'opcao escolhida' : 'opcao'}>
            <input
              type="radio"
              name="qualidade"
              checked={qualidade === valor}
              onChange={() => {
                escolherQualidade(valor);
                setQualidade(valor);
              }}
            />
            <span>
              <strong>{QUALIDADES[valor].rotulo}</strong>
              {valor === QUALIDADE && <small>Recomendado. A que todos usam.</small>}
            </span>
          </label>
        ))}
      </fieldset>
      {qualidade !== QUALIDADE && (
        <p className="ajuda">
          {altura > 720 && fps > 30
            ? 'Usa quase o triplo da sua internet de envio para cada amigo assistindo, e bem mais da placa de vídeo.'
            : 'Usa quase o dobro da sua internet de envio para cada amigo assistindo, e mais da placa de vídeo.'}{' '}
          {fps > 30 && 'Em jogo pesado, a imagem pode não chegar a 60 fps (as estatísticas mostram quanto chega). '}
          Com vários amigos assistindo ou uma internet mais fraca, a imagem pode perder nitidez ou travar: nesse caso, volte para o 720p · 30 fps.
        </p>
      )}
      <p className="ajuda">Vale a partir da próxima vez que você escolher o que transmitir.</p>
    </section>
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
