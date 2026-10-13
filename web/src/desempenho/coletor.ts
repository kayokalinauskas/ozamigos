// A parte da gravação das estatísticas da sala que roda no PC de cada pessoa. Enquanto alguém grava
// (Ctrl+Shift+G), este PC mede a cada segundo o que transmite (uma linha por quem assiste) e o que assiste
// (uma linha por transmissão), mais o processador e a placa de vídeo, e manda tudo pelo servidor só para
// quem está gravando. Nada é salvo aqui e ninguém precisa aceitar nada: a sala só mostra o selo "Gravando".

import { cliente } from '../cliente';
import { noApp, ponte } from '../ponte';
import { AmostradorEnvio, AmostradorRecepcao, contadoresDoPc, medidorDaPagina, videoDoStream } from './amostradores';
import type { AmbienteDoEspectador, AmostraCaptura, AmostraEnvio, Pacote } from './tipos';

// O ambiente (PC, tela, versão) vai no primeiro pacote e de novo a cada tanto: quem grava pode ter começado depois.
const REPETIR_AMBIENTE_A_CADA = 30;

export class Coletor {
  private relogio: ReturnType<typeof setInterval> | null = null;
  private segundo = 0;
  private medindo = false;
  private readonly envios = new Map<string, AmostradorEnvio>(); // id de quem me assiste
  private readonly recebimentos = new Map<string, AmostradorRecepcao>(); // id de quem eu assisto
  private ambiente: AmbienteDoEspectador | null = null;
  private ambienteMandadoEm = -Infinity;

  get ligado() {
    return this.relogio !== null;
  }

  ligar(destino: (pacote: Pacote) => void) {
    if (this.relogio) return;
    this.segundo = 0;
    this.ambienteMandadoEm = -Infinity;
    contadoresDoPc.ligar();
    medidorDaPagina.ligar();
    void this.lerAmbiente();
    this.relogio = setInterval(() => void this.medir(destino), 1000);
  }

  desligar() {
    if (!this.relogio) return;
    clearInterval(this.relogio);
    this.relogio = null;
    for (const amostrador of this.recebimentos.values()) amostrador.parar();
    this.envios.clear();
    this.recebimentos.clear();
    medidorDaPagina.desligar();
    contadoresDoPc.desligar();
  }

  private async lerAmbiente() {
    const pc = (await ponte?.desempenho?.pc().catch(() => null)) ?? null;
    this.ambiente = {
      app: noApp ? `app ${ponte?.versao ?? '?'}` : 'navegador',
      navegador: navigator.userAgent,
      tela: `${screen.width}x${screen.height} @${devicePixelRatio}`,
      hz: null,
      nucleos: navigator.hardwareConcurrency ?? null,
      pc,
    };
  }

  /** Um amostrador por conexão: conexão nova (a pessoa voltou, a conexão foi refeita) = amostrador novo. */
  private acompanharConexoes() {
    const envios = cliente.envios();
    for (const { id, pc } of envios) {
      if (this.envios.get(id)?.pc !== pc) this.envios.set(id, new AmostradorEnvio(pc, id, false));
    }
    for (const id of this.envios.keys()) if (!envios.some((l) => l.id === id)) this.envios.delete(id);

    const recebimentos = cliente.recebimentos();
    for (const { id, pc } of recebimentos) {
      const atual = this.recebimentos.get(id);
      if (atual?.pc === pc) continue;
      atual?.parar();
      this.recebimentos.set(id, new AmostradorRecepcao(pc, id, false, () => videoDoStream(cliente.ler().videos[id])));
    }
    for (const [id, amostrador] of this.recebimentos) {
      if (recebimentos.some((l) => l.id === id)) continue;
      amostrador.parar();
      this.recebimentos.delete(id);
    }
  }

  private async medir(destino: (pacote: Pacote) => void) {
    if (this.medindo || !this.relogio) return;
    this.medindo = true;
    try {
      const t = ++this.segundo;
      this.acompanharConexoes();
      const pagina = medidorDaPagina.colher();
      const [envios, recepcoes, pc] = await Promise.all([
        Promise.all([...this.envios.values()].map((a) => a.amostrar(t))),
        Promise.all(
          [...this.recebimentos.entries()].map(async ([id, a]) => {
            const amostra = await a.amostrar(t, pagina);
            return amostra && { ...amostra, transmissor: id };
          }),
        ),
        contadoresDoPc.amostrar(t),
      ]);
      if (!this.relogio) return; // desligado durante a medição
      const envio: AmostraEnvio[] = [];
      let captura: AmostraCaptura | null = null;
      for (const resultado of envios) {
        if (!resultado) continue;
        envio.push(resultado.envio);
        captura ??= resultado.captura;
      }
      const { minhaTela, qualidade } = cliente.ler();
      const [video] = minhaTela?.getVideoTracks() ?? [];
      const ajustes = video?.getSettings();
      const pacote: Pacote = {
        transmissao: minhaTela
          ? { qualidade, fonte: `${cliente.descreverFonte()} · "${video?.label ?? '?'}" · captura ${ajustes?.width ?? '?'}x${ajustes?.height ?? '?'} @${ajustes?.frameRate ?? '?'}` }
          : null,
        envio,
        captura,
        recepcao: recepcoes.filter((r) => r !== null),
        pc,
        pagina: { t, ...pagina, janelaVisivel: document.visibilityState === 'visible' },
      };
      if (this.ambiente && t - this.ambienteMandadoEm >= REPETIR_AMBIENTE_A_CADA) {
        pacote.ambiente = this.ambiente;
        this.ambienteMandadoEm = t;
      }
      destino(pacote);
    } catch (erro) {
      console.error('Gravação da sala: falha ao medir', erro);
    } finally {
      this.medindo = false;
    }
  }
}

/**
 * Liga o lado de cada pessoa: enquanto outra pessoa grava as estatísticas da sala, mede e manda.
 * Chamado uma vez, na abertura da página. (Quem grava mede o próprio PC em gravadorDaSala.ts.)
 */
export function acompanharGravacaoDaSala() {
  const coletor = new Coletor();
  cliente.inscrever(() => {
    const { fase, gravacaoDaSala, meuId } = cliente.ler();
    const outraPessoaGrava = fase === 'sala' && gravacaoDaSala !== null && gravacaoDaSala.id !== meuId;
    if (outraPessoaGrava && !coletor.ligado) coletor.ligar((pacote) => cliente.mandarMedidas(pacote));
    else if (!outraPessoaGrava && coletor.ligado) coletor.desligar();
  });
}
