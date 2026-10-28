import { useState } from 'react';

// Iniciais do nome sobre uma cor que depende só do nome: a mesma pessoa tem sempre a mesma cor.
const CORES = ['#ff7a45', '#f759ab', '#9254de', '#597ef7', '#36cfc9', '#73d13d', '#ffc53d', '#ff4d4f'];

function corDe(nome: string): string {
  let soma = 0;
  for (const letra of nome) soma = (soma * 31 + letra.codePointAt(0)!) >>> 0;
  return CORES[soma % CORES.length];
}

// Por caractere visível, não por unidade UTF-16: "Família 🎮" cortava o emoji ao meio e mostrava um caractere inválido.
const segmentador = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
function caracteres(texto: string): string[] {
  return segmentador ? Array.from(segmentador.segment(texto), (s) => s.segment) : Array.from(texto);
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean).map(caracteres);
  const letras = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? ['?']).slice(0, 2).join('');
  return letras.toUpperCase();
}

type Props = { nome: string; foto?: string | null; tamanho?: number; aoVivo?: boolean; falando?: boolean; quadrado?: boolean };

/**
 * falando: o anel verde de quem está falando na voz (vale mais que o vermelho de ao vivo). foto: a da conta, servida
 * pelo próprio servidor (/api/fotos); sem ela, ou se não carregar, as iniciais. quadrado: o ícone de um servidor salvo.
 */
export function Avatar({ nome, foto, tamanho = 36, aoVivo = false, falando = false, quadrado = false }: Props) {
  const [falhou, setFalhou] = useState<string | null>(null);
  const comFoto = Boolean(foto) && falhou !== foto;
  return (
    <span
      className={['avatar', quadrado && 'quadrado', comFoto && 'com-foto', aoVivo && 'ao-vivo', falando && 'falando'].filter(Boolean).join(' ')}
      // Com foto, sem a cor das iniciais por trás: ela vazava na borda da imagem (o serrilhado do recorte).
      style={{ width: tamanho, height: tamanho, background: comFoto ? undefined : corDe(nome), fontSize: tamanho * 0.38 }}
      aria-hidden="true"
    >
      {comFoto ? <img src={foto!} alt="" width={tamanho} height={tamanho} draggable={false} onError={() => setFalhou(foto!)} /> : iniciais(nome)}
    </span>
  );
}
