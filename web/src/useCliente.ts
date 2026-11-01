import { useCallback, useState, useSyncExternalStore } from 'react';
import { cliente } from './cliente';
import { voz } from './voz/voz';
import { lembradoNumero, lembrar } from './armazenamento';

/** O estado do cliente; o componente redesenha quando ele muda. */
export function useCliente() {
  return useSyncExternalStore(cliente.inscrever, cliente.ler);
}

/** O estado da voz (microfone, fone, quem fala); separado do cliente para o anel de quem fala não redesenhar os vídeos. */
export function useVoz() {
  return useSyncExternalStore(voz.inscrever, voz.ler);
}

/**
 * Um número que o navegador lembra entre uma visita e outra (volumes, por exemplo). Só grava quando a pessoa muda o
 * valor: se a chave mudar (a mesma transmissão reconhecida pela conta), lê o da chave nova, sem gravar o da antiga
 * por cima dele.
 */
export function useNumeroLembrado(chave: string, padrao: number) {
  const [guardado, setGuardado] = useState(() => ({ chave, valor: lembradoNumero(chave, padrao) }));
  const valor = guardado.chave === chave ? guardado.valor : lembradoNumero(chave, padrao);
  const setValor = useCallback(
    (novo: number) => {
      lembrar(chave, String(novo));
      setGuardado({ chave, valor: novo });
    },
    [chave],
  );
  return [valor, setValor] as const;
}
