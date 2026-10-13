// Os ajustes de voz que a pessoa escolhe na engrenagem, guardados no navegador (como os volumes).
import { lembrado, lembradoNumero, lembrar } from '../armazenamento';

/** RNNoise: a rede neural que tira o ruído (padrão). Navegador: a supressão do próprio Chrome. */
export type Supressao = 'rnnoise' | 'navegador' | 'nenhuma';

export type AjustesDeVoz = {
  entrada: string; // deviceId do microfone; '' = o padrão do Windows
  saida: string; // deviceId da saída de áudio; '' = o padrão do Windows
  volumeEntrada: number; // % (0–200)
  volumeSaida: number; // % (0–200)
  sensibilidadeAutomatica: boolean;
  limiarDb: number; // sensibilidade manual: o microfone abre acima disso (-100 a 0 dB)
  supressao: Supressao;
  cancelarEco: boolean;
  ganhoAutomatico: boolean;
};

export const AJUSTES_PADRAO: AjustesDeVoz = {
  entrada: '',
  saida: '',
  volumeEntrada: 100,
  volumeSaida: 100,
  sensibilidadeAutomatica: true,
  limiarDb: -50,
  supressao: 'rnnoise',
  cancelarEco: true,
  ganhoAutomatico: true,
};

const CHAVE = 'ozamigos-voz';
const limitar = (n: unknown, min: number, max: number, padrao: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao);
const texto = (s: unknown) => (typeof s === 'string' ? s.slice(0, 200) : '');
const sim = (b: unknown, padrao: boolean) => (typeof b === 'boolean' ? b : padrao);

/** Lê o que foi guardado; o que faltar ou vier estranho volta para o padrão. */
export function lerAjustes(): AjustesDeVoz {
  let salvo: Record<string, unknown> = {};
  try {
    salvo = JSON.parse(lembrado(CHAVE) || '{}');
  } catch {
    // guardado de um jeito que não dá para ler: fica o padrão
  }
  const p = AJUSTES_PADRAO;
  return {
    entrada: texto(salvo.entrada),
    saida: texto(salvo.saida),
    volumeEntrada: limitar(salvo.volumeEntrada, 0, 200, p.volumeEntrada),
    volumeSaida: limitar(salvo.volumeSaida, 0, 200, p.volumeSaida),
    sensibilidadeAutomatica: sim(salvo.sensibilidadeAutomatica, p.sensibilidadeAutomatica),
    limiarDb: limitar(salvo.limiarDb, -100, 0, p.limiarDb),
    supressao: salvo.supressao === 'navegador' || salvo.supressao === 'nenhuma' ? salvo.supressao : 'rnnoise',
    cancelarEco: sim(salvo.cancelarEco, p.cancelarEco),
    ganhoAutomatico: sim(salvo.ganhoAutomatico, p.ganhoAutomatico),
  };
}

export function guardarAjustes(ajustes: AjustesDeVoz): void {
  lembrar(CHAVE, JSON.stringify(ajustes));
}

// O volume e o "silenciar para mim" de cada amigo ficam pelo nome: o id muda a cada vez que a pessoa entra.
export const volumeDaVozDe = (nome: string) => limitar(lembradoNumero(`ozamigos-voz-volume:${nome}`, 100), 0, 200, 100);
export const guardarVolumeDaVozDe = (nome: string, volume: number) => lembrar(`ozamigos-voz-volume:${nome}`, volume === 100 ? '' : String(volume));
export const silenciadoParaMim = (nome: string) => lembrado(`ozamigos-voz-silenciado:${nome}`) === 'sim';
export const guardarSilenciadoParaMim = (nome: string, silenciado: boolean) => lembrar(`ozamigos-voz-silenciado:${nome}`, silenciado ? 'sim' : '');

// Microfone e fone desligados continuam assim na próxima vez, como no Discord.
export const mudoGuardado = () => lembrado('ozamigos-voz-mudo') === 'sim';
export const surdoGuardado = () => lembrado('ozamigos-voz-surdo') === 'sim';
export const guardarMudo = (mudo: boolean) => lembrar('ozamigos-voz-mudo', mudo ? 'sim' : '');
export const guardarSurdo = (surdo: boolean) => lembrar('ozamigos-voz-surdo', surdo ? 'sim' : '');
