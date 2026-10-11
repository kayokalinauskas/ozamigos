// O navegador lembra nome, senha, qualidade e volumes para a pessoa não ajustar tudo de novo.
// Em aba anônima, ou com o armazenamento bloqueado, localStorage pode falhar: aí só não lembra.

export function lembrado(chave: string): string {
  try {
    return localStorage.getItem(chave) ?? '';
  } catch {
    return '';
  }
}

export function lembrar(chave: string, valor: string): void {
  try {
    if (valor) localStorage.setItem(chave, valor);
    else localStorage.removeItem(chave);
  } catch {
    // sem armazenamento: segue sem lembrar
  }
}

export function lembradoNumero(chave: string, padrao: number): number {
  const valor = Number.parseFloat(lembrado(chave));
  return Number.isFinite(valor) ? valor : padrao;
}
