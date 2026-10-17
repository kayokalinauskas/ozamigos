import { useEffect, useState, useSyncExternalStore } from 'react';
import { Keyboard, X } from 'lucide-react';
import { ponte } from '../ponte';
import { useVoz } from '../useCliente';
import {
  BOTOES_DO_MOUSE,
  NOME_DO_MODIFICADOR,
  atalhos,
  ehModificador,
  teclaDoEvento,
  teclaVirtual,
  type Atalho,
  type NomeDoAtalho,
} from '../voz/atalhos';
import { voz } from '../voz/voz';

const CAMPOS: { nome: NomeDoAtalho; titulo: string }[] = [
  { nome: 'falar', titulo: 'Apertar para falar' },
  { nome: 'mudo', titulo: 'Ligar e desligar o microfone' },
  { nome: 'surdo', titulo: 'Ligar e desligar o som' },
];
const ORDEM_DOS_MODIFICADORES = ['Control', 'Shift', 'Alt'];
const NOMES_ESPECIAIS: Record<string, string> = {
  Space: 'Espaço',
  Enter: 'Enter',
  NumpadEnter: 'Enter do teclado numérico',
  Tab: 'Tab',
  Backspace: 'Backspace',
  CapsLock: 'Caps Lock',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** O nome da tecla como a pessoa a vê no teclado dela ("Ç", não "Semicolon"). */
function nomeDaTecla(e: KeyboardEvent): string {
  if (NOMES_ESPECIAIS[e.code]) return NOMES_ESPECIAIS[e.code];
  if (/^Numpad\d$/.test(e.code)) return `Num ${e.code.slice(6)}`;
  if (/^F\d{1,2}$/.test(e.code)) return e.code;
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

function combinar(modificadores: Set<string>, tecla?: { tecla: string; nome: string }): Atalho {
  const mods = ORDEM_DOS_MODIFICADORES.filter((m) => modificadores.has(m));
  const teclas = tecla ? [...mods, tecla.tecla] : mods;
  const nomes = [...mods.map((m) => NOME_DO_MODIFICADOR[m]), ...(tecla ? [tecla.nome] : [])];
  return { teclas, nome: nomes.join(' + ') };
}

/** A aba "Atalhos" da engrenagem: o modo do microfone e as teclas de cada atalho. */
export function AbaDeAtalhos() {
  const { ajustes } = useVoz();
  const lista = useSyncExternalStore(atalhos.inscrever, atalhos.ler);
  const globais = useSyncExternalStore(atalhos.inscrever, () => atalhos.globais);
  const semTecla = ajustes.apertarParaFalar && lista.falar.teclas.length === 0;

  return (
    <>
      <section className="configuracoes-secao" aria-labelledby="titulo-modo">
        <h3 id="titulo-modo">Quando a sua voz vai</h3>
        <fieldset className="opcoes">
          <legend className="rotulo">Modo do microfone</legend>
          <label className={ajustes.apertarParaFalar ? 'opcao' : 'opcao escolhida'}>
            <input type="radio" name="modo-do-microfone" checked={!ajustes.apertarParaFalar} onChange={() => voz.mudarAjustes({ apertarParaFalar: false })} />
            <span>
              <strong>Detecção de voz</strong>
              <small>O microfone abre sozinho quando você fala (a sensibilidade fica na aba Voz e áudio).</small>
            </span>
          </label>
          <label className={ajustes.apertarParaFalar ? 'opcao escolhida' : 'opcao'}>
            <input type="radio" name="modo-do-microfone" checked={ajustes.apertarParaFalar} onChange={() => voz.mudarAjustes({ apertarParaFalar: true })} />
            <span>
              <strong>Apertar para falar</strong>
              <small>A sua voz só vai enquanto a tecla abaixo estiver apertada.</small>
            </span>
          </label>
        </fieldset>
        {semTecla && (
          <p className="configuracoes-alerta" role="status">
            Escolha a tecla de &quot;Apertar para falar&quot; abaixo: sem ela, ninguém te ouve.
          </p>
        )}
      </section>

      <section className="configuracoes-secao" aria-labelledby="titulo-atalhos">
        <h3 id="titulo-atalhos">Atalhos</h3>
        <p className="ajuda">
          {globais
            ? 'Funcionam com o jogo na frente, sem tirar a tecla do jogo.'
            : ponte
              ? 'Por enquanto, só com o Ozamigos em foco: atualize o app (ele se atualiza ao abrir) para funcionarem com o jogo na frente.'
              : 'No navegador, só funcionam com esta aba em foco. No app para Windows, funcionam com o jogo na frente.'}
        </p>
        <div className="atalhos">
          {CAMPOS.map(({ nome, titulo }) => (
            <CampoDeAtalho key={nome} nome={nome} titulo={titulo} atalho={lista[nome]} />
          ))}
        </div>
        {ponte && (
          <p className="ajuda">
            Um jogo aberto como administrador esconde as teclas dos outros programas: nele, os atalhos só funcionam com o Ozamigos aberto como
            administrador também.
          </p>
        )}
      </section>
    </>
  );
}

function CampoDeAtalho({ nome, titulo, atalho }: { nome: NomeDoAtalho; titulo: string; atalho: Atalho }) {
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    if (!gravando) return;
    atalhos.pausar(true);
    const modificadores = new Set<string>();
    let maisModificadores = new Set<string>(); // um atalho só de modificadores (Alt, por exemplo) vale ao soltar
    const terminar = (novo: Atalho | null) => {
      if (novo) definirSemRepetir(nome, novo);
      setGravando(false);
    };
    const parar = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const apertou = (e: KeyboardEvent) => {
      parar(e); // o Esc também: sem isso, ele fecharia a engrenagem
      if (e.repeat) return;
      if (e.code === 'Escape') return terminar(null);
      const tecla = teclaDoEvento(e.code);
      if (ehModificador(tecla)) {
        modificadores.add(tecla);
        if (modificadores.size > maisModificadores.size) maisModificadores = new Set(modificadores);
        return;
      }
      if (teclaVirtual(tecla) === null) return; // uma tecla que o app não sabe ler: espera outra
      terminar(combinar(modificadores, { tecla, nome: nomeDaTecla(e) }));
    };
    const soltou = (e: KeyboardEvent) => {
      parar(e);
      const tecla = teclaDoEvento(e.code);
      if (!ehModificador(tecla)) return;
      modificadores.delete(tecla);
      if (modificadores.size === 0 && maisModificadores.size > 0) terminar(combinar(maisModificadores));
    };
    const clicou = (e: MouseEvent) => {
      const botao = BOTOES_DO_MOUSE[e.button];
      parar(e);
      // Um clique comum (fora daqui, por exemplo) desiste; o do meio e os laterais viram o atalho.
      terminar(botao ? combinar(modificadores, botao) : null);
    };
    addEventListener('keydown', apertou, true);
    addEventListener('keyup', soltou, true);
    addEventListener('mousedown', clicou, true);
    return () => {
      removeEventListener('keydown', apertou, true);
      removeEventListener('keyup', soltou, true);
      removeEventListener('mousedown', clicou, true);
      atalhos.pausar(false);
    };
  }, [gravando, nome]);

  return (
    <div className="atalho">
      <span className="atalho-titulo">{titulo}</span>
      <button
        type="button"
        className={gravando ? 'botao botao-secundario atalho-tecla gravando' : 'botao botao-secundario atalho-tecla'}
        aria-label={`${titulo}: ${gravando ? 'aperte as teclas' : atalho.nome || 'nenhum atalho'}. Clique para trocar.`}
        onClick={() => setGravando(true)}
      >
        <Keyboard size={14} aria-hidden="true" />
        {gravando ? 'Aperte as teclas… (Esc cancela)' : atalho.nome || 'Nenhum'}
      </button>
      {atalho.teclas.length > 0 && !gravando ? (
        <button type="button" className="botao-icone" aria-label={`Tirar o atalho de ${titulo}`} title="Tirar o atalho" onClick={() => atalhos.definir(nome, { teclas: [], nome: '' })}>
          <X size={16} />
        </button>
      ) : (
        <span className="atalho-sem-x" aria-hidden="true" /> // o lugar do X: as teclas ficam alinhadas
      )}
    </div>
  );
}

/** Duas ações com as mesmas teclas fariam as duas coisas de uma vez: a outra fica sem atalho. */
function definirSemRepetir(nome: NomeDoAtalho, novo: Atalho) {
  const iguais = (a: Atalho) => a.teclas.length === novo.teclas.length && a.teclas.every((t) => novo.teclas.includes(t));
  for (const [outro, atalho] of Object.entries(atalhos.ler()) as [NomeDoAtalho, Atalho][]) {
    if (outro !== nome && iguais(atalho)) atalhos.definir(outro, { teclas: [], nome: '' });
  }
  atalhos.definir(nome, novo);
}
