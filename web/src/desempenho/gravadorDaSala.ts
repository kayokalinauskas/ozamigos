// A gravação das estatísticas da sala, no PC de quem grava (Ctrl+Shift+G). Junta as medidas que cada PC da sala
// manda a cada segundo (coletor.ts), mais as deste PC, numa GravacaoDaSala: quem transmite, quem assiste quem,
// e os trechos de cada transmissão. As linhas de cada segundo vão para um worker (trabalhadorDaSala.ts), que guarda
// tudo e gera os arquivos sem travar a página. A cada 30 s, salva sozinho o relatório para IA; no fim, também as
// páginas e os dados, em Documentos\Ozamigos\Estatísticas (no app) ou baixa os arquivos no fim (no navegador).

import { AJUSTES_DA_TRANSMISSAO, cliente } from '../cliente';
import { ponte } from '../ponte';
import { QUALIDADES, type Qualidade } from '../qualidade';
import { Coletor } from './coletor';
import { teste } from './gravacao';
import { LISTAS, type Linhas, type Meta, type Pedido, type Resposta } from './trabalhadorDaSala';
import { FORMATO_DA_SALA, SEGUNDOS_DESCARTADOS, type AmostraEnvio, type AmostraRecepcao, type GravacaoDaSala, type Pacote, type Trecho } from './tipos';

const SALVAR_A_CADA = 30_000;
// Sem pacote de alguém por esse tempo, a pessoa saiu ou caiu: o papel dela acaba e a transmissão fecha o trecho.
const SEGUNDOS_SEM_NOTICIA = 4;
// Uma hora com 4 pessoas são ~60 MB de dados: acima de 2 horas, a memória pesa no PC de quem grava.
const DURACAO_MAXIMA = 2 * 60 * 60;

type PapelAgora = { transmite: boolean; qualidade: Qualidade | null; espectadores: string[]; assiste: string[] };

export type EstadoDaGravacao = { gravando: boolean; inicio: number; pasta: string; salvoEm: string | null };

const rotulo = (q: Qualidade) => QUALIDADES[q].rotulo;
const lista = (nomes: string[]) => (nomes.length ? nomes.join(', ') : 'ninguém');
const doisDigitos = (n: number) => String(n).padStart(2, '0');

function nomeDaPasta(sala: string) {
  const d = new Date();
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())} ${doisDigitos(d.getHours())}h${doisDigitos(d.getMinutes())} - sala ${sala}`;
}

function baixar(nome: string, conteudo: string, tipo: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

class GravadorDaSala {
  private estado: EstadoDaGravacao = { gravando: false, inicio: 0, pasta: '', salvoEm: null };
  private readonly ouvintes = new Set<() => void>();
  // As listas de `g` só guardam as linhas que ainda não foram para o worker (veja mandarLinhas).
  private g: GravacaoDaSala | null = null;
  private trabalhador: Worker | null = null;
  private readonly esperando = new Map<number, (resposta: Resposta) => void>();
  private proximoPedido = 1;
  private readonly coletor = new Coletor();
  private inicioMs = 0;
  private relogio: ReturnType<typeof setInterval> | null = null;
  private salvador: ReturnType<typeof setInterval> | null = null;
  private desinscrever: (() => void) | null = null;
  private pedidoComId: string | null = null; // o id com que pedi ao servidor para gravar (muda ao reconectar)
  private salvando: Promise<void> | null = null;
  private readonly ultimos = new Map<string, { t: number; papel: PapelAgora }>();
  private readonly papeis = new Map<string, PapelAgora | null>();
  private readonly trechosAbertos = new Map<string, { trecho: Trecho; chave: string }>();
  private readonly anteriores = new Map<string, { altura: number | null; limite: string | null }>();

  inscrever = (ouvinte: () => void) => {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  };

  ler = () => this.estado;

  private mudar(parcial: Partial<EstadoDaGravacao>) {
    this.estado = { ...this.estado, ...parcial };
    this.ouvintes.forEach((ouvinte) => ouvinte());
  }

  /** O atalho: começa, ou para se já estiver gravando. */
  alternar() {
    if (this.estado.gravando) void this.parar();
    else this.iniciar();
  }

  iniciar() {
    const e = cliente.ler();
    if (this.estado.gravando || this.salvando || e.fase !== 'sala' || !e.meuId) return;
    if (e.gravacaoDaSala && e.gravacaoDaSala.id !== e.meuId) {
      cliente.avisar(`${e.gravacaoDaSala.nome} já está gravando as estatísticas desta sala.`, 'erro');
      return;
    }
    const fase = teste.ler().fase;
    if (fase === 'gravando' || fase === 'encerrando') {
      cliente.avisar('Termine o teste de desempenho antes de gravar a sala.', 'erro');
      return;
    }
    const pasta = nomeDaPasta(e.sala);
    this.g = {
      formato: FORMATO_DA_SALA,
      sala: e.sala,
      gravadoPor: cliente.nomeReal(e.meuId),
      inicio: new Date().toISOString(),
      duracao: 0,
      terminou: false,
      pessoas: [],
      papeis: [],
      trechos: {},
      envio: [],
      captura: [],
      recepcao: [],
      pcAmostras: [],
      pagina: [],
      acontecimentos: [],
      ajustes: { ...AJUSTES_DA_TRANSMISSAO },
      qualidades: { ...QUALIDADES },
    };
    try {
      this.trabalhador = new Worker(new URL('./trabalhadorDaSala.ts', import.meta.url), { type: 'module' });
    } catch (erro) {
      console.error('Gravação da sala: o worker não abriu', erro);
      cliente.avisar('Não foi possível começar a gravação da sala neste navegador.', 'erro');
      this.g = null;
      return;
    }
    this.trabalhador.onmessage = (evento: MessageEvent<Resposta>) => {
      this.esperando.get(evento.data.id)?.(evento.data);
      this.esperando.delete(evento.data.id);
    };
    this.inicioMs = performance.now();
    this.ultimos.clear();
    this.papeis.clear();
    this.trechosAbertos.clear();
    this.anteriores.clear();
    cliente.aoReceberMedidas = (de, pacote) => this.receber(de, pacote);
    cliente.aoRecusarGravacao = () => void this.parar('O servidor recusou: outra pessoa já grava a sala.', false);
    this.pedidoComId = e.meuId;
    cliente.gravarSala(true);
    this.coletor.ligar((pacote) => {
      const eu = cliente.ler().meuId;
      if (eu) this.receber(eu, pacote);
    });
    this.relogio = setInterval(() => this.acompanhar(), 1000);
    this.salvador = setInterval(() => void this.salvar(false), SALVAR_A_CADA);
    this.desinscrever = cliente.inscrever(() => this.conferirServidor());
    cliente.registrar('gravação da sala: começou');
    this.anotar('inicio', `${this.g.gravadoPor} começou a gravar as estatísticas da sala`);
    this.mudar({ gravando: true, inicio: Date.now(), pasta, salvoEm: null });
    cliente.avisar('Gravando as estatísticas da sala. Os arquivos são salvos sozinhos a cada 30 s; Ctrl+Shift+G de novo para parar.');
  }

  /** Caiu e voltou com outro id: pede de novo. Se outra pessoa começou a gravar nesse meio-tempo, para. */
  private conferirServidor() {
    if (!this.estado.gravando) return;
    const { fase, meuId, gravacaoDaSala } = cliente.ler();
    if (fase !== 'sala' || !meuId) return;
    if (gravacaoDaSala && gravacaoDaSala.id !== meuId && gravacaoDaSala.id !== this.pedidoComId) {
      void this.parar(`${gravacaoDaSala.nome} começou outra gravação enquanto você estava sem conexão.`, false);
      return;
    }
    if (!gravacaoDaSala && meuId !== this.pedidoComId) {
      this.pedidoComId = meuId;
      this.anotar('reconexao', `${this.g?.gravadoPor} reconectou ao servidor (a gravação continua); ao voltar, as conexões de vídeo dessa pessoa são refeitas`);
      cliente.gravarSala(true);
    }
  }

  private agora() {
    return Math.round((performance.now() - this.inicioMs) / 1000);
  }

  private anotar(tipo: string, texto: string, transmissao?: string) {
    this.g?.acontecimentos.push({ t: this.agora(), tipo, texto, ...(transmissao ? { transmissao } : {}) });
  }

  // ===== As medidas de cada segundo =====

  private receber(de: string, bruto: unknown) {
    const g = this.g;
    if (!g || !this.estado.gravando || !bruto || typeof bruto !== 'object') return;
    const p = bruto as Partial<Pacote>;
    const t = this.agora();
    const nome = cliente.nomeReal(de);
    const vetor = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

    let pessoa = g.pessoas.find((x) => x.nome === nome);
    if (!pessoa) {
      pessoa = { nome, ambiente: null, fontes: [] };
      g.pessoas.push(pessoa);
    }
    if (p.ambiente) pessoa.ambiente = p.ambiente;
    const transmissao = p.transmissao && p.transmissao.qualidade in QUALIDADES ? p.transmissao : null;
    if (transmissao?.fonte && !pessoa.fontes.includes(transmissao.fonte)) pessoa.fontes.push(transmissao.fonte);

    const envio = vetor(p.envio).map((e) => ({ ...e, t, espectador: cliente.nomeReal(e.espectador), simulado: false, transmissor: nome }));
    const recepcao = vetor(p.recepcao).map((r) => ({ ...r, t, espectador: nome, simulado: false, transmissor: cliente.nomeReal(r.transmissor) }));
    g.envio.push(...envio);
    g.recepcao.push(...recepcao);
    if (p.captura && transmissao) g.captura.push({ ...p.captura, t, pessoa: nome });
    if (p.pc) g.pcAmostras.push({ ...p.pc, t, pessoa: nome });
    if (p.pagina) {
      g.pagina.push({ ...p.pagina, t, pessoa: nome });
      if (p.pagina.msTarefaMaior >= 100) this.anotar('tarefa-longa', `${nome}: a interface travou ${p.pagina.msTarefaMaior} ms`);
    }
    this.ultimos.set(nome, {
      t,
      papel: {
        transmite: Boolean(transmissao),
        qualidade: transmissao?.qualidade ?? null,
        espectadores: [...new Set(envio.map((e) => e.espectador))].sort(),
        assiste: [...new Set(recepcao.map((r) => r.transmissor))].sort(),
      },
    });
    this.detectar(envio, recepcao);
  }

  /** Acontecimentos que valem uma linha: resolução que caiu, limite do codificador, congelamento. */
  private detectar(envio: (AmostraEnvio & { transmissor: string })[], recepcao: (AmostraRecepcao & { transmissor: string })[]) {
    for (const e of envio) {
      const chave = `${e.transmissor} → ${e.espectador}`;
      const antes = this.anteriores.get(chave);
      if (antes?.altura && e.altura && e.altura !== antes.altura) {
        this.anotar('resolucao', `${chave}: resolução ${antes.altura}p → ${e.altura}p (limite: ${e.limite ?? '?'})`, e.transmissor);
      }
      if (antes && e.limite !== antes.limite && e.limite && e.limite !== 'none') {
        this.anotar('limite', `${chave}: o codificador passou a ser limitado por ${e.limite}`, e.transmissor);
      }
      this.anteriores.set(chave, { altura: e.altura, limite: e.limite });
    }
    for (const r of recepcao) {
      if (r.congelamentos > 0) this.anotar('congelamento', `${r.espectador} vendo ${r.transmissor}: imagem congelou ${r.msCongelado} ms`, r.transmissor);
    }
  }

  // ===== Papéis e trechos, uma vez por segundo =====

  private acompanhar() {
    const g = this.g;
    if (!g) return;
    const t = this.agora();
    for (const [nome, ultimo] of this.ultimos) {
      const papel = t - ultimo.t > SEGUNDOS_SEM_NOTICIA ? null : ultimo.papel;
      if (!papel) this.ultimos.delete(nome);
      this.registrarPapel(nome, papel, t);
      this.acompanharTrecho(nome, papel, t);
    }
    g.duracao = t;
    this.mandarLinhas();
    if (t >= DURACAO_MAXIMA) void this.parar('A gravação da sala parou sozinha depois de 2 horas.');
  }

  /** As linhas novas vão para o worker, e a página esquece delas: a memória fica com ele. */
  private mandarLinhas() {
    const g = this.g;
    if (!g || !this.trabalhador) return;
    const novas = {} as Linhas;
    for (const lista of LISTAS) {
      (novas as Record<string, unknown[]>)[lista] = g[lista];
      (g as Record<string, unknown>)[lista] = [];
    }
    const meta = Object.fromEntries(Object.entries(g).filter(([chave]) => !(LISTAS as string[]).includes(chave))) as Meta;
    this.trabalhador.postMessage({ tipo: 'linhas', meta, novas } satisfies Pedido);
  }

  private gerar(final: boolean): Promise<Record<string, string>> {
    const trabalhador = this.trabalhador;
    if (!trabalhador) return Promise.reject(new Error('sem worker'));
    this.mandarLinhas();
    const id = this.proximoPedido++;
    return new Promise((resolver, rejeitar) => {
      this.esperando.set(id, (resposta) => (resposta.tipo === 'arquivos' ? resolver(resposta.arquivos) : rejeitar(new Error(resposta.mensagem))));
      trabalhador.postMessage({ tipo: 'gerar', id, final } satisfies Pedido);
    });
  }

  private registrarPapel(nome: string, papel: PapelAgora | null, t: number) {
    const anterior = this.papeis.get(nome);
    if (JSON.stringify(anterior ?? null) === JSON.stringify(papel)) return;
    this.papeis.set(nome, papel);
    if (papel) this.g!.papeis.push({ t, pessoa: nome, ...papel });
    // Quem começa a assistir abre um codificador novo em quem transmite (congela-ao-entrar procura isto).
    for (const quem of papel?.espectadores ?? []) {
      if (!anterior?.espectadores.includes(quem)) this.anotar('espectador', `${quem} está assistindo ${nome}`, nome);
    }
    for (const quem of anterior?.espectadores ?? []) {
      if (!papel?.espectadores.includes(quem)) this.anotar('espectador', `${quem} parou de assistir ${nome}`, nome);
    }
    if (!papel) this.anotar('papel', `${nome} parou de mandar medidas (saiu da sala, ou a conexão com o servidor caiu ou o servidor reiniciou)`);
    else if (papel.transmite !== (anterior?.transmite ?? false) || papel.qualidade !== (anterior?.qualidade ?? null) || !anterior) {
      this.anotar(
        'papel',
        papel.transmite
          ? `${nome} transmite em ${rotulo(papel.qualidade!)}`
          : anterior?.transmite
            ? `${nome} parou de transmitir`
            : `${nome} está na sala sem transmitir`,
      );
    }
    if (papel && JSON.stringify(papel.assiste) !== JSON.stringify(anterior?.assiste ?? [])) {
      this.anotar('papel', `${nome} assiste: ${lista(papel.assiste)}`);
    }
  }

  /** Um trecho novo a cada mudança de qualidade, de quantas pessoas assistem ou de quantas transmissões a pessoa assiste. */
  private acompanharTrecho(nome: string, papel: PapelAgora | null, t: number) {
    const aberto = this.trechosAbertos.get(nome);
    const chave = papel?.transmite && papel.espectadores.length ? `${papel.qualidade}|${papel.espectadores.length}|${papel.assiste.length}` : null;
    if (aberto && aberto.chave === chave) {
      aberto.trecho.fim = t;
      return;
    }
    if (aberto) {
      aberto.trecho.fim = t;
      this.trechosAbertos.delete(nome);
    }
    if (!chave || !papel) return; // sem ninguém assistindo, não há o que medir
    const trechos = (this.g!.trechos[nome] ??= []);
    const n = papel.espectadores.length;
    const trecho: Trecho = {
      indice: trechos.length,
      nome: `${rotulo(papel.qualidade!)} · ${n} assistindo${papel.assiste.length ? ` · também assiste ${papel.assiste.length}` : ''}`,
      inicio: t,
      fim: t,
      qualidade: papel.qualidade!,
      espectadores: n,
      simulados: 0,
      aquecimento: false,
      descartarAte: t + SEGUNDOS_DESCARTADOS,
      assistindo: papel.assiste.length,
    };
    trechos.push(trecho);
    this.trechosAbertos.set(nome, { trecho, chave });
  }

  // ===== Salvar e parar =====

  private salvar(final: boolean): Promise<void> {
    if (this.salvando) return this.salvando.then(() => (final ? this.salvar(true) : undefined));
    const g = this.g;
    if (!g) return Promise.resolve();
    this.salvando = (async () => {
      try {
        g.duracao = this.agora();
        g.terminou = final;
        const arquivos = await this.gerar(final);
        const salvar = ponte?.estatisticas?.salvar;
        if (salvar) {
          const caminho = await salvar(this.estado.pasta, arquivos);
          if (caminho) this.mudar({ salvoEm: caminho });
        } else if (final) {
          const prefixo = `ozamigos ${this.estado.pasta}`;
          for (const [nome, conteudo] of Object.entries(arquivos)) {
            baixar(`${prefixo} - ${nome}`, conteudo, nome.endsWith('.json') ? 'application/json' : nome.endsWith('.md') ? 'text/markdown' : 'text/html');
          }
        }
      } catch (erro) {
        console.error('Gravação da sala: falha ao salvar', erro);
        if (final) cliente.avisar('Não foi possível salvar as estatísticas da sala.', 'erro');
      } finally {
        this.salvando = null;
      }
    })();
    return this.salvando;
  }

  /** motivo: quando não foi a pessoa que parou. avisarServidor = false quando a gravação já não é desta pessoa. */
  async parar(motivo?: string, avisarServidor = true) {
    if (!this.estado.gravando || !this.g) return;
    if (this.relogio) clearInterval(this.relogio);
    if (this.salvador) clearInterval(this.salvador);
    this.relogio = this.salvador = null;
    this.coletor.desligar();
    this.desinscrever?.();
    this.desinscrever = null;
    cliente.aoReceberMedidas = null;
    cliente.aoRecusarGravacao = null;
    if (avisarServidor) cliente.gravarSala(false);
    const t = this.agora();
    for (const { trecho } of this.trechosAbertos.values()) trecho.fim = t;
    this.trechosAbertos.clear();
    for (const nome of Object.keys(this.g.trechos)) this.g.trechos[nome] = this.g.trechos[nome].filter((tr) => tr.fim > tr.inicio);
    this.anotar('fim', motivo ?? `${this.g.gravadoPor} parou a gravação`);
    cliente.registrar('gravação da sala: terminou');
    this.mudar({ gravando: false });
    await this.salvar(true);
    const { pasta, salvoEm } = this.estado;
    const abrir = ponte?.estatisticas?.abrirPasta;
    if (motivo) cliente.avisar(motivo, avisarServidor ? 'info' : 'erro');
    if (salvoEm && abrir) {
      // O caminho inteiro não cabe no aviso: o botão abre a pasta.
      cliente.avisar('Estatísticas da sala salvas em Documentos › Ozamigos › Estatísticas.', 'info', { rotulo: 'Abrir a pasta', executar: () => void abrir(pasta) });
    } else if (!ponte?.estatisticas) {
      cliente.avisar('Estatísticas da sala baixadas (veja a pasta de downloads).');
    }
    this.g = null;
    this.trabalhador?.terminate();
    this.trabalhador = null;
    this.esperando.clear();
  }
}

export const gravadorDaSala = new GravadorDaSala();
