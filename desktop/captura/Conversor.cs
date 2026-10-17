using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.Mathematics;

namespace Ozamigos.Captura;

/// <summary>
/// Reduz o quadro capturado (BGRA, no tamanho da janela ou da tela) até caber no tamanho máximo, sem mudar a proporção,
/// e o converte para NV12 no processador de vídeo da placa; depois lê o NV12 para a memória, já sem o espaço de
/// alinhamento das linhas. Só a leitura final passa pelo processador (~2,4 ms por quadro 720p, medido na fase 2).
/// Quando o tamanho da imagem muda (a janela foi redimensionada), tudo é refeito no tamanho novo.
/// </summary>
sealed class Conversor(ID3D11Device dispositivo, ID3D11DeviceContext contexto, int larguraMaxima, int alturaMaxima, int fps) : IDisposable
{
    readonly ID3D11VideoDevice videoDevice = dispositivo.QueryInterface<ID3D11VideoDevice>();
    readonly ID3D11VideoContext1 videoContext = contexto.QueryInterface<ID3D11VideoContext1>();

    int entradaL, entradaA;
    ID3D11Texture2D? copia, nv12, legivel;
    ID3D11VideoProcessorEnumerator? enumerador;
    ID3D11VideoProcessor? processador;
    ID3D11VideoProcessorInputView? vistaDeEntrada;
    ID3D11VideoProcessorOutputView? vistaDeSaida;

    public int Largura { get; private set; }
    public int Altura { get; private set; }

    /// <summary>Converte a parte de cima à esquerda (largura × altura) da textura e escreve o NV12 em destino.</summary>
    public unsafe void Converter(ID3D11Texture2D textura, int largura, int altura, Span<byte> destino)
    {
        if (largura != entradaL || altura != entradaA) Refazer(largura, altura);
        contexto.CopySubresourceRegion(copia!, 0, 0, 0, 0, textura, 0, new Box(0, 0, 0, largura, altura, 1));
        videoContext.VideoProcessorBlt(processador!, vistaDeSaida!, 0, 1,
            [new VideoProcessorStream { Enable = true, InputSurface = vistaDeEntrada! }]).CheckError();
        contexto.CopyResource(legivel!, nv12!);
        var mapa = contexto.Map(legivel!, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
        try
        {
            byte* origem = (byte*)mapa.DataPointer;
            int passo = (int)mapa.RowPitch, posicao = 0;
            for (int y = 0; y < Altura + Altura / 2; y++) // as linhas de Y e, logo depois, as de UV
            {
                new ReadOnlySpan<byte>(origem + (long)y * passo, Largura).CopyTo(destino.Slice(posicao, Largura));
                posicao += Largura;
            }
        }
        finally
        {
            contexto.Unmap(legivel!, 0);
        }
    }

    /// <summary>O tamanho de saída para uma entrada: cabe no máximo, com a mesma proporção, nunca maior que a entrada, par.</summary>
    public static (int largura, int altura) TamanhoDeSaida(int largura, int altura, int larguraMaxima, int alturaMaxima)
    {
        double escala = Math.Min(1, Math.Min((double)larguraMaxima / largura, (double)alturaMaxima / altura));
        return (Math.Max(2, (int)Math.Round(largura * escala) & ~1), Math.Max(2, (int)Math.Round(altura * escala) & ~1));
    }

    void Refazer(int largura, int altura)
    {
        Soltar();
        entradaL = largura;
        entradaA = altura;
        (Largura, Altura) = TamanhoDeSaida(largura, altura, larguraMaxima, alturaMaxima);

        copia = dispositivo.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)largura, Height = (uint)altura, MipLevels = 1, ArraySize = 1, Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0), Usage = ResourceUsage.Default, BindFlags = BindFlags.RenderTarget | BindFlags.ShaderResource,
        });
        var conteudo = new VideoProcessorContentDescription
        {
            InputFrameFormat = VideoFrameFormat.Progressive,
            InputFrameRate = new Rational((uint)fps, 1), InputWidth = (uint)largura, InputHeight = (uint)altura,
            OutputFrameRate = new Rational((uint)fps, 1), OutputWidth = (uint)Largura, OutputHeight = (uint)Altura,
            Usage = VideoUsage.PlaybackNormal,
        };
        enumerador = videoDevice.CreateVideoProcessorEnumerator(conteudo);
        processador = videoDevice.CreateVideoProcessor(enumerador, 0);
        // A tela é RGB completo (0–255); o vídeo sai em BT.709 de faixa limitada (16–235), o que a página declara no
        // VideoFrame e o que o codificador e quem assiste esperam. Sem dizer, cada placa escolhe um.
        videoContext.VideoProcessorSetStreamColorSpace1(processador, 0, ColorSpaceType.RgbFullG22NoneP709);
        videoContext.VideoProcessorSetOutputColorSpace1(processador, ColorSpaceType.YcbcrStudioG22LeftP709);
        vistaDeEntrada = videoDevice.CreateVideoProcessorInputView(copia, enumerador,
            new VideoProcessorInputViewDescription { ViewDimension = VideoProcessorInputViewDimension.Texture2D });
        nv12 = dispositivo.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)Largura, Height = (uint)Altura, MipLevels = 1, ArraySize = 1, Format = Format.NV12,
            SampleDescription = new SampleDescription(1, 0), Usage = ResourceUsage.Default, BindFlags = BindFlags.RenderTarget,
        });
        vistaDeSaida = videoDevice.CreateVideoProcessorOutputView(nv12, enumerador,
            new VideoProcessorOutputViewDescription { ViewDimension = VideoProcessorOutputViewDimension.Texture2D });
        legivel = dispositivo.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)Largura, Height = (uint)Altura, MipLevels = 1, ArraySize = 1, Format = Format.NV12,
            SampleDescription = new SampleDescription(1, 0), Usage = ResourceUsage.Staging, CPUAccessFlags = CpuAccessFlags.Read,
        });
    }

    void Soltar()
    {
        vistaDeSaida?.Dispose();
        vistaDeEntrada?.Dispose();
        processador?.Dispose();
        enumerador?.Dispose();
        legivel?.Dispose();
        nv12?.Dispose();
        copia?.Dispose();
        vistaDeSaida = null;
        vistaDeEntrada = null;
        processador = null;
        enumerador = null;
        legivel = nv12 = copia = null;
    }

    public void Dispose()
    {
        Soltar();
        videoContext.Dispose();
        videoDevice.Dispose();
    }
}
