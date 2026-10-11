// Iniciais do nome sobre uma cor que depende só do nome: a mesma pessoa tem sempre a mesma cor.
const CORES = ['#ff7a45', '#f759ab', '#9254de', '#597ef7', '#36cfc9', '#73d13d', '#ffc53d', '#ff4d4f'];

function corDe(nome: string): string {
  let soma = 0;
  for (const letra of nome) soma = (soma * 31 + letra.codePointAt(0)!) >>> 0;
  return CORES[soma % CORES.length];
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const letras = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? '?').slice(0, 2);
  return letras.toUpperCase();
}

export function Avatar({ nome, tamanho = 36, aoVivo = false }: { nome: string; tamanho?: number; aoVivo?: boolean }) {
  return (
    <span
      className={aoVivo ? 'avatar ao-vivo' : 'avatar'}
      style={{ width: tamanho, height: tamanho, background: corDe(nome), fontSize: tamanho * 0.38 }}
      aria-hidden="true"
    >
      {iniciais(nome)}
    </span>
  );
}
