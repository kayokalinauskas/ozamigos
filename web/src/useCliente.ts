import { useEffect, useState, useSyncExternalStore } from 'react';
import { cliente } from './cliente';
import { lembradoNumero, lembrar } from './armazenamento';

/** O estado do cliente; o componente redesenha quando ele muda. */
export function useCliente() {
  return useSyncExternalStore(cliente.inscrever, cliente.ler);
}

/** Um número que o navegador lembra entre uma visita e outra (volumes, por exemplo). */
export function useNumeroLembrado(chave: string, padrao: number) {
  const [valor, setValor] = useState(() => lembradoNumero(chave, padrao));
  useEffect(() => {
    lembrar(chave, String(valor));
  }, [chave, valor]);
  return [valor, setValor] as const;
}
