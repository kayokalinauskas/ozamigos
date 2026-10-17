// A bandeja do chat: as imagens coladas, arrastadas ou escolhidas, já sendo preparadas enquanto a pessoa decide.
// Nada vai antes do Enter: um Ctrl+V sem querer (um print com algo pessoal) só aparece aqui, com o ✕ para desistir.
import { comprimir, type ImagemComprimida } from './compressor';
import { IMAGENS_POR_ENVIO } from './regras';

export type ItemDaBandeja = {
  chave: number;
  estado: 'preparando' | 'pronta' | 'erro';
  previa: string | null; // a imagem já comprimida (o que os amigos vão ver)
  imagem: ImagemComprimida | null;
  erro: string;
};

const ERROS = {
  'nao-e-imagem': 'Não deu para abrir: não é uma imagem, ou o formato não é aceito neste navegador.',
  'grande-demais': 'Arquivo grande demais (até 50 MB).',
  'sem-codificador': 'Este navegador não conseguiu preparar a imagem.',
} as const;

let itens: ItemDaBandeja[] = [];
let proximaChave = 1;
const ouvintes = new Set<() => void>();

function mudar(novos: ItemDaBandeja[]) {
  itens = novos;
  ouvintes.forEach((ouvinte) => ouvinte());
}

export const bandeja = {
  inscrever(ouvinte: () => void) {
    ouvintes.add(ouvinte);
    return () => void ouvintes.delete(ouvinte);
  },
  ler: () => itens,

  /** Põe as imagens na bandeja e começa a prepará-las. Devolve quantas ficaram de fora (o limite é por envio). */
  adicionar(arquivos: Iterable<File>): number {
    const imagens = [...arquivos].filter((arquivo) => arquivo.type.startsWith('image/') || arquivo.type === '');
    const cabem = Math.max(0, IMAGENS_POR_ENVIO - itens.length);
    for (const arquivo of imagens.slice(0, cabem)) {
      const item: ItemDaBandeja = { chave: proximaChave++, estado: 'preparando', previa: null, imagem: null, erro: '' };
      mudar([...itens, item]);
      void comprimir(arquivo).then((resultado) => {
        if (!itens.some((i) => i.chave === item.chave)) return; // tirado da bandeja enquanto preparava
        const pronto: ItemDaBandeja = resultado.ok
          ? { ...item, estado: 'pronta', imagem: resultado, previa: URL.createObjectURL(new Blob([resultado.bytes as BlobPart], { type: 'image/webp' })) }
          : { ...item, estado: 'erro', erro: ERROS[resultado.motivo] };
        mudar(itens.map((i) => (i.chave === item.chave ? pronto : i)));
      });
    }
    return imagens.length - Math.min(imagens.length, cabem);
  },

  remover(chave: number) {
    const item = itens.find((i) => i.chave === chave);
    if (item?.previa) URL.revokeObjectURL(item.previa);
    mudar(itens.filter((i) => i.chave !== chave));
  },

  preparando: () => itens.some((i) => i.estado === 'preparando'),

  /** As imagens prontas, na ordem. */
  prontas(): { imagem: ImagemComprimida; url: string }[] {
    return itens.filter((i) => i.estado === 'pronta' && i.imagem && i.previa).map((i) => ({ imagem: i.imagem!, url: i.previa! }));
  },

  /** Depois de mandar: as prévias das prontas viraram as imagens do chat (o cliente as solta da memória depois). */
  esvaziar() {
    mudar([]);
  },
};
