import { useState } from 'react';
import {
  AppWindow,
  Check,
  Download,
  ExternalLink,
  Gauge,
  Globe,
  Lock,
  Minus,
  PictureInPicture2,
  RefreshCw,
  Users,
  Volume2,
} from 'lucide-react';
import { PAGINA_DA_RELEASE, REPOSITORIO, useInstalador } from '../versaoDoApp';
import { Logo } from './Logo';
import '../apresentacao.css';

// A primeira página de quem abre o site no navegador: apresenta o Ozamigos e recomenda o app para
// Windows, que tem o som sem o Discord e o seletor de janelas. Quem prefere o navegador segue para a
// entrada com um clique. O app instalado e quem chega por um link de sala não passam por aqui.

const NO_WINDOWS = /Windows/i.test(navigator.userAgent);

const RECURSOS = [
  { icone: Gauge, titulo: 'Até 1080p a 60 fps', texto: 'Qualidade ajustável ao vivo, com indicador de saúde e estatísticas de cada conexão.' },
  { icone: Users, titulo: 'Todos transmitem juntos', texto: 'Salas de até 5 pessoas. Assista uma ou várias transmissões, em grade ou com uma em destaque.' },
  { icone: Volume2, titulo: 'Som sem eco', texto: 'O app manda o som do PC sem o Discord: os amigos não ouvem a própria voz de volta.' },
  { icone: PictureInPicture2, titulo: 'Janela flutuante', texto: 'Solte uma transmissão numa janelinha que fica por cima do jogo.' },
  { icone: Lock, titulo: 'Só para o seu grupo', texto: 'Salas protegidas pela senha do grupo. O vídeo vai direto de um PC para o outro.' },
  { icone: RefreshCw, titulo: 'Sempre atualizado', texto: 'O app se atualiza sozinho ao abrir e volta para a sala se a internet oscilar.' },
];

// [o que, no app, no navegador]
const COMPARACAO: [string, boolean, boolean][] = [
  ['Assistir e transmitir em até 1080p', true, true],
  ['Várias transmissões ao mesmo tempo', true, true],
  ['Som do PC sem o Discord e sem eco', true, false],
  ['Seletor de janelas com miniaturas', true, false],
  ['Sem engasgos com o jogo na frente', true, false],
  ['Funciona sem instalar nada', false, true],
];

const DUVIDAS = [
  {
    pergunta: 'O Windows disse que protegeu o computador. É seguro?',
    resposta: (
      <>
        O aviso aparece porque o instalador não tem assinatura digital paga. Clique em <b>Mais informações</b> e depois em{' '}
        <b>Executar assim mesmo</b>. O código é aberto, e cada instalador é gerado pelo GitHub a partir dele, com um
        histórico público de cada versão.
      </>
    ),
  },
  {
    pergunta: 'Preciso de senha?',
    resposta: <>Sim, a senha do grupo. Peça para quem te convidou: ela impede que estranhos entrem nas salas.</>,
  },
  {
    pergunta: 'É de graça?',
    resposta: <>Sim. O Ozamigos é gratuito e de código aberto, com licença MIT.</>,
  },
  {
    pergunta: 'Dá para usar sem instalar?',
    resposta: (
      <>
        Dá. A versão portátil abre com dois cliques e está na{' '}
        <a href={PAGINA_DA_RELEASE} target="_blank" rel="noreferrer">
          página de downloads
        </a>
        . Ou use pelo navegador (Chrome ou Edge), sem o som separado do Discord.
      </>
    ),
  },
  {
    pergunta: 'Funciona no Mac, no Linux ou no celular?',
    resposta: <>O app é só para Windows 10 e 11. Nos outros sistemas, use pelo navegador Chrome ou Edge no computador.</>,
  },
  {
    pergunta: 'O meu vídeo passa por algum servidor?',
    resposta: (
      <>
        Não. O servidor só apresenta as pessoas da sala e confere a senha. O vídeo e o som vão direto de quem transmite
        para quem assiste, por WebRTC, e só para quem clicou em <b>Assistir</b>.
      </>
    ),
  },
];

export function Apresentacao({ aoUsarNoNavegador }: { aoUsarNoNavegador: () => void }) {
  return (
    <div className="apresentacao">
      <header className="site-topo">
        <div className="site-largura site-topo-conteudo">
          <a href="#inicio" className="site-marca" aria-label="Ozamigos, início">
            <Logo />
          </a>
          <nav aria-label="Seções" className="site-nav">
            <a href="#recursos">Recursos</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#duvidas">Dúvidas</a>
          </nav>
          <button type="button" className="botao botao-secundario botao-pequeno" onClick={aoUsarNoNavegador}>
            <Globe size={14} /> Abrir no navegador
          </button>
        </div>
      </header>

      <main>
        <section id="inicio" className="site-largura site-heroi" aria-labelledby="titulo-heroi">
          <div className="site-heroi-texto">
            <p className="site-selo">Grátis e de código aberto</p>
            <h1 id="titulo-heroi">
              Transmita seu jogo <span className="site-realce">para os amigos.</span>
            </h1>
            <p className="site-lead">
              Até 1080p a 60 fps, direto de um PC para o outro. Salas com senha, todo mundo transmitindo ao mesmo tempo e o
              som do jogo sem o eco do Discord.
            </p>
            <Chamada aoUsarNoNavegador={aoUsarNoNavegador} />
          </div>
          <figure className="site-moldura">
            <div className="site-moldura-barra" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <img
              src="/imagens/sala-destaque.png"
              width={1600}
              height={900}
              alt="Uma sala do Ozamigos: uma transmissão em destaque, as outras ao lado e quem está ao vivo na lateral"
              fetchPriority="high"
            />
          </figure>
        </section>

        <section id="recursos" className="site-largura site-secao" aria-labelledby="titulo-recursos">
          <h2 id="titulo-recursos">Feito para jogar junto</h2>
          <p className="site-secao-lead">Tudo o que o grupo precisa para assistir a partida dos amigos, sem complicação.</p>
          <ul className="site-recursos">
            {RECURSOS.map(({ icone: Icone, titulo, texto }) => (
              <li key={titulo}>
                <span className="site-recurso-icone" aria-hidden="true">
                  <Icone size={20} />
                </span>
                <h3>{titulo}</h3>
                <p>{texto}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="site-largura site-secao site-dupla" aria-labelledby="titulo-comparacao">
          <div>
            <h2 id="titulo-comparacao">App ou navegador?</h2>
            <p className="site-secao-lead">
              Os dois entram nas mesmas salas. O app para Windows faz o que o navegador não consegue: manda o som do jogo
              sem a voz do Discord junto.
            </p>
          </div>
          <table className="site-tabela">
            <thead>
              <tr>
                <th scope="col">
                  <span className="so-para-leitores">Recurso</span>
                </th>
                <th scope="col">App para Windows</th>
                <th scope="col">Navegador</th>
              </tr>
            </thead>
            <tbody>
              {COMPARACAO.map(([recurso, noApp, noNavegador]) => (
                <tr key={recurso}>
                  <th scope="row">{recurso}</th>
                  <td>
                    <Marca sim={noApp} />
                  </td>
                  <td>
                    <Marca sim={noNavegador} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="como-funciona" className="site-largura site-secao" aria-labelledby="titulo-como-funciona">
          <h2 id="titulo-como-funciona">Como funciona</h2>
          <ol className="site-passos">
            <li>
              <h3>Instale o app</h3>
              <p>Baixe o instalador e abra. Daí em diante, ele se atualiza sozinho.</p>
            </li>
            <li>
              <h3>Entre com a senha do grupo</h3>
              <p>Escolha como os amigos te chamam e use a senha que quem te convidou passou.</p>
            </li>
            <li>
              <h3>Mande o link da sala</h3>
              <p>Crie uma sala, copie o link e mande no chat. Clique em Transmitir e escolha a janela do jogo.</p>
            </li>
          </ol>
          <figure className="site-moldura site-moldura-larga">
            <div className="site-moldura-barra" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <img
              src="/imagens/sala-grade.png"
              width={1600}
              height={900}
              loading="lazy"
              alt="Sala em grade com quatro transmissões ao vivo lado a lado"
            />
          </figure>
        </section>

        <section id="duvidas" className="site-largura site-secao site-estreita" aria-labelledby="titulo-duvidas">
          <h2 id="titulo-duvidas">Dúvidas</h2>
          <div className="site-duvidas">
            {DUVIDAS.map(({ pergunta, resposta }) => (
              <details key={pergunta}>
                <summary>{pergunta}</summary>
                <p>{resposta}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="site-largura site-final" aria-labelledby="titulo-final">
          <h2 id="titulo-final">Bora jogar junto?</h2>
          <Chamada aoUsarNoNavegador={aoUsarNoNavegador} />
        </section>
      </main>

      <footer className="site-rodape">
        <div className="site-largura site-rodape-conteudo">
          <Logo />
          <nav aria-label="Links do projeto">
            <a href={REPOSITORIO} target="_blank" rel="noreferrer">
              Código no GitHub <ExternalLink size={12} aria-hidden="true" />
            </a>
            <a href={`${REPOSITORIO}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer">
              Novidades <ExternalLink size={12} aria-hidden="true" />
            </a>
            <a href={`${REPOSITORIO}/issues/new/choose`} target="_blank" rel="noreferrer">
              Relatar um problema <ExternalLink size={12} aria-hidden="true" />
            </a>
          </nav>
          <p>Código aberto, licença MIT.</p>
        </div>
      </footer>
    </div>
  );
}

function Marca({ sim }: { sim: boolean }) {
  return sim ? (
    <Check size={18} className="site-sim" aria-label="Sim" />
  ) : (
    <Minus size={18} className="site-nao" aria-label="Não" />
  );
}

/** Os botões de baixar e de usar no navegador. Fora do Windows, o navegador vem primeiro. */
function Chamada({ aoUsarNoNavegador }: { aoUsarNoNavegador: () => void }) {
  const instalador = useInstalador();
  const [baixou, setBaixou] = useState(false);

  const baixar = (
    <a
      className={`botao botao-grande ${NO_WINDOWS ? 'botao-primario' : 'botao-secundario'}`}
      href={instalador?.url ?? PAGINA_DA_RELEASE}
      onClick={() => instalador && setBaixou(true)}
      {...(instalador ? {} : { target: '_blank', rel: 'noreferrer' })}
    >
      <Download size={18} /> Baixar para Windows
    </a>
  );
  const navegador = (
    <button
      type="button"
      className={`botao botao-grande ${NO_WINDOWS ? 'botao-secundario' : 'botao-primario'}`}
      onClick={aoUsarNoNavegador}
    >
      <AppWindow size={18} /> Usar no navegador
    </button>
  );

  return (
    <div className="site-chamada">
      <div className="site-chamada-botoes">
        {NO_WINDOWS ? (
          <>
            {baixar}
            {navegador}
          </>
        ) : (
          <>
            {navegador}
            {baixar}
          </>
        )}
      </div>
      <p className="site-detalhes">
        {instalador ? `Versão ${instalador.versao} · ${instalador.megabytes} MB · ` : ''}Windows 10 e 11, 64 bits
      </p>
      {baixou && (
        <p className="site-depois" role="status">
          Abra o arquivo baixado. Se o Windows mostrar <b>“O Windows protegeu o computador”</b>, clique em{' '}
          <b>Mais informações</b> e depois em <b>Executar assim mesmo</b>.
        </p>
      )}
    </div>
  );
}
