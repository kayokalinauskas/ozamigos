import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, X } from 'lucide-react';
import type { MensagemDoChat } from '../cliente';

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** A área de transferência só aceita PNG: a imagem é redesenhada nesse formato na hora de copiar. */
async function emPng(url: string): Promise<Blob> {
  const imagem = await createImageBitmap(await (await fetch(url)).blob());
  const tela = new OffscreenCanvas(imagem.width, imagem.height);
  tela.getContext('2d')!.drawImage(imagem, 0, 0);
  imagem.close();
  return tela.convertToBlob({ type: 'image/png' });
}

/** Uma imagem do chat em tamanho grande, por cima de tudo. Esc ou um clique fora fecham. */
export function VisualizadorDeImagem({ mensagem, aoFechar }: { mensagem: MensagemDoChat; aoFechar: () => void }) {
  const imagem = mensagem.imagem!;
  const fechar = useRef<HTMLButtonElement>(null);
  const [copia, setCopia] = useState<'' | 'copiada' | 'falhou'>('');
  const autor = mensagem.minha ? 'Você' : mensagem.nome;

  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // o Esc fecha a imagem, não o chat
      aoFechar();
    };
    addEventListener('keydown', tecla, true);
    return () => {
      removeEventListener('keydown', tecla, true);
      antes?.focus(); // volta para onde estava (o campo do chat)
    };
  }, [aoFechar]);

  // A imagem saiu da memória com a janela aberta (chegaram imagens demais depois dela).
  useEffect(() => {
    if (!imagem.url) aoFechar();
  }, [imagem.url, aoFechar]);

  async function copiar() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': emPng(imagem.url!) })]);
      setCopia('copiada');
    } catch {
      setCopia('falhou');
    }
    setTimeout(() => setCopia(''), 2000);
  }

  const rotuloDaCopia = copia === 'copiada' ? 'Copiada' : copia === 'falhou' ? 'Não deu para copiar' : 'Copiar imagem';
  const momento = new Date(mensagem.momento);
  const arquivo = `ozamigos-${autor}-${momento.toISOString().slice(0, 16).replace(/[-:T]/g, '')}.webp`.replace(/[^\w.-]+/g, '_');

  return createPortal(
    <div className="visualizador" role="dialog" aria-modal="true" aria-label={`Imagem de ${autor}`} onClick={aoFechar}>
      <header onClick={(e) => e.stopPropagation()}>
        <span className="visualizador-autor">
          {autor} <time dateTime={momento.toISOString()}>{hora.format(momento)}</time>
          <small>
            {imagem.largura}×{imagem.altura}
          </small>
        </span>
        <button type="button" className="botao botao-fantasma botao-pequeno" aria-label={rotuloDaCopia} title={rotuloDaCopia} onClick={() => void copiar()}>
          {copia === 'copiada' ? <Check size={14} /> : <Copy size={14} />}
          <span className="rotulo">{rotuloDaCopia}</span>
        </button>
        <a className="botao botao-fantasma botao-pequeno" href={imagem.url ?? undefined} download={arquivo} aria-label="Salvar imagem" title="Salvar imagem">
          <Download size={14} /> <span className="rotulo">Salvar imagem</span>
        </a>
        <button type="button" ref={fechar} className="botao-icone" aria-label="Fechar a imagem" onClick={aoFechar}>
          <X size={20} />
        </button>
      </header>
      <div className="visualizador-quadro">
        {imagem.url && <img src={imagem.url} alt={`Imagem de ${autor}`} width={imagem.largura} height={imagem.altura} onClick={(e) => e.stopPropagation()} />}
      </div>
    </div>,
    document.body,
  );
}
