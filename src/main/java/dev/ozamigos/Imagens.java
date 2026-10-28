package dev.ozamigos;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Iterator;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;

/**
 * Reduz imagens vindas de fora (a miniatura das prévias de links, a foto do perfil) a um JPEG pequeno. Nada chega às
 * pessoas como veio: o JPEG é redesenhado aqui, sem metadados, e uma imagem gigante nem é aberta.
 */
final class Imagens {

    /** Imagens maiores que isso (em pixels) nem são abertas: uma "bomba" de 50000×50000 encheria a memória. */
    static final long PIXELS_NO_MAXIMO = 40_000_000;

    private Imagens() {}

    /**
     * A imagem com o lado maior em até {@code lado} (com {@code quadrado}, cortada no centro antes), em JPEG de até
     * {@code teto} bytes. Null: um formato que o Java não abre, grande demais, ou que não coube no teto.
     */
    static byte[] jpegReduzido(byte[] bytes, int lado, int teto, boolean quadrado) throws IOException {
        BufferedImage imagem;
        try (ImageInputStream entrada = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> leitores = ImageIO.getImageReaders(entrada);
            if (!leitores.hasNext()) {
                return null;
            }
            ImageReader leitor = leitores.next();
            try {
                leitor.setInput(entrada, true, true);
                int maior = Math.max(leitor.getWidth(0), leitor.getHeight(0));
                if ((long) leitor.getWidth(0) * leitor.getHeight(0) > PIXELS_NO_MAXIMO) {
                    return null;
                }
                // Lê já reduzida (pulando pixels), até o dobro do lado final, que a redução bicúbica de baixo acaba de
                // afinar. Inteira, uma imagem de 40 MP ocupava ~160 MB na memória do servidor (de 512 MB); assim, ~1 MB.
                ImageReadParam parametros = leitor.getDefaultReadParam();
                int passo = Math.max(1, maior / (lado * 2));
                parametros.setSourceSubsampling(passo, passo, 0, 0);
                imagem = leitor.read(0, parametros);
            } finally {
                leitor.dispose();
            }
        }
        if (quadrado) {
            int menor = Math.min(imagem.getWidth(), imagem.getHeight());
            imagem = imagem.getSubimage((imagem.getWidth() - menor) / 2, (imagem.getHeight() - menor) / 2, menor, menor);
        }
        double escala = Math.min(1.0, (double) lado / Math.max(imagem.getWidth(), imagem.getHeight()));
        int largura = Math.max(1, (int) Math.round(imagem.getWidth() * escala));
        int altura = Math.max(1, (int) Math.round(imagem.getHeight() * escala));
        BufferedImage pequena = new BufferedImage(largura, altura, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = pequena.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.drawImage(imagem, 0, 0, largura, altura, null);
        } finally {
            g.dispose();
        }
        for (float qualidade : new float[] {0.82f, 0.65f, 0.5f}) {
            byte[] jpeg = emJpeg(pequena, qualidade);
            if (jpeg.length <= teto) {
                return jpeg;
            }
        }
        return null;
    }

    private static byte[] emJpeg(BufferedImage imagem, float qualidade) throws IOException {
        ImageWriter escritor = ImageIO.getImageWritersByFormatName("jpeg").next();
        ByteArrayOutputStream saida = new ByteArrayOutputStream();
        try (MemoryCacheImageOutputStream destino = new MemoryCacheImageOutputStream(saida)) {
            escritor.setOutput(destino);
            ImageWriteParam parametros = escritor.getDefaultWriteParam();
            parametros.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            parametros.setCompressionQuality(qualidade);
            escritor.write(null, new IIOImage(imagem, null, null), parametros);
        } finally {
            escritor.dispose();
        }
        return saida.toByteArray();
    }
}
