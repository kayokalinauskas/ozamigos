using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using SharpGen.Runtime;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.Mathematics;
using Vortice.MediaFoundation;

namespace Ozamigos.Captura;

/// <summary>
/// OzamigosCaptura.exe --segundos 20 --saida captura.h265 [--monitor 0] [--mbps 4] [--fps 30]
///
/// Fase 1 da captura própria, só para medir: duplica a tela pelo Windows (DXGI Desktop Duplication, a mesma origem da
/// captura do Chromium), copia o quadro dentro da placa de vídeo, reduz para 720p e converte para NV12 no processador de
/// vídeo da placa, e entrega a textura ao codificador H.265 da placa (Media Foundation), sem nenhum quadro passar pelo
/// processador. O Chromium copia a tela inteira para a memória antes de reduzir, e com o jogo pesado isso o prende em
/// ~21 fps. Escreve uma linha JSON por segundo na saída padrão.
/// </summary>
static class Programa
{
    // GUIDs do Media Foundation (mfapi.h, codecapi.h).
    static readonly Guid CategoriaCodificador = new("f79eac7d-e545-4387-bdee-d647d7bde42a");
    static readonly Guid TipoVideo = new("73646976-0000-0010-8000-00aa00389b71");
    static readonly Guid FormatoNv12 = new("3231564e-0000-0010-8000-00aa00389b71");
    static readonly Guid FormatoHevc = new("43564548-0000-0010-8000-00aa00389b71");
    static readonly Guid TipoPrincipal = new("48eba18e-f8c9-4687-bf11-0a74c9f96a8f");
    static readonly Guid Subtipo = new("f7e34c9a-42e8-4714-b74b-cb29d72c35e5");
    static readonly Guid TamanhoDoQuadro = new("1652c33d-d6b2-4012-b834-72030849a37d");
    static readonly Guid TaxaDeQuadros = new("c459a2e8-3d2c-4e44-b132-fee5156c7bb0");
    static readonly Guid BitrateMedio = new("20332624-fb0d-4d9e-bd0d-cbf6786c102e");
    static readonly Guid Entrelacamento = new("e2724bb8-e676-4806-b4b2-a8d6efb44ccd");
    static readonly Guid ProporcaoDoPixel = new("c6376a1e-8d0a-4027-be45-6d9a0ad39bb6");
    static readonly Guid DestravarAssincrono = new("e5666d6b-3422-4eb6-a421-da7db1f8e207");
    static readonly Guid BaixaLatencia = new("9c27891a-ed7a-40e1-88e8-b22727a024ee");
    static readonly Guid NomeDoMft = new("314ffbae-5b41-4c95-9c19-4e7d586face3");

    // Ajustes do codificador pela ICodecAPI (codecapi.h). A Vortice não traz essa interface: é chamada pelo índice da
    // vtable (0–2 são as do IUnknown; SetValue é a 9).
    static readonly Guid InterfaceCodecApi = new("901db4c7-31ce-41a2-85dc-8fa0bf41b8da");
    static readonly Guid ModoDeBaixaLatencia = new("9c27891a-ed7a-40e1-88e8-b22727a024ee"); // CODECAPI_AVLowLatencyMode (VT_BOOL)
    static readonly Guid ControleDeTaxa = new("1c0608e9-370c-4710-8a58-cb6181c42423"); // CODECAPI_AVEncCommonRateControlMode (VT_UI4)
    static readonly Guid QuadrosB = new("8d390aac-dc5c-4200-b57f-814d04babab2"); // CODECAPI_AVEncMPVDefaultBPictureCount (VT_UI4)
    static readonly Guid BitrateMedioDoCodec = new("ee5fb25c-c713-40d1-9d58-c0d7241e250f"); // CODECAPI_AVEncCommonMeanBitRate (VT_UI4)

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct Variante
    {
        [FieldOffset(0)] public ushort Tipo;
        [FieldOffset(8)] public uint Ui4;
        [FieldOffset(8)] public short Booleano;
    }

    /// <summary>Um ajuste da ICodecAPI. Devolve o HRESULT (0 = aceito): cada placa aceita um conjunto diferente.</summary>
    static unsafe int AjustarCodec(IntPtr transform, Guid ajuste, Variante valor)
    {
        Guid iid = InterfaceCodecApi;
        if (Marshal.QueryInterface(transform, in iid, out IntPtr codecApi) != 0) return -1;
        try
        {
            var vtable = *(IntPtr**)codecApi;
            var setValue = (delegate* unmanaged[Stdcall]<IntPtr, Guid*, Variante*, int>)vtable[9];
            return setValue(codecApi, &ajuste, &valor);
        }
        finally
        {
            Marshal.Release(codecApi);
        }
    }

    static Variante Inteiro(uint v) => new() { Tipo = 19, Ui4 = v }; // VT_UI4
    static Variante Sim() => new() { Tipo = 11, Booleano = -1 }; // VT_BOOL, VARIANT_TRUE

    [DllImport("winmm.dll")]
    static extern uint timeBeginPeriod(uint periodo);

    const int ANEL = 4; // texturas NV12 em rodízio: o codificador lê uma enquanto a próxima é preparada

    static int Main(string[] argumentos)
    {
        int segundos = Numero(argumentos, "--segundos", 20);
        int monitor = Numero(argumentos, "--monitor", 0);
        int mbps = Numero(argumentos, "--mbps", 4);
        int fps = Numero(argumentos, "--fps", 30);
        int largura = Numero(argumentos, "--largura", 1280);
        int altura = Numero(argumentos, "--altura", 720);
        string arquivo = Texto(argumentos, "--saida", "captura.h265");
        timeBeginPeriod(1);

        MediaFactory.MFStartup(true).CheckError();
        using var fabrica = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
        fabrica.EnumAdapters1(0, out IDXGIAdapter1 placa).CheckError();
        placa.EnumOutputs((uint)monitor, out IDXGIOutput saidaDeVideo).CheckError();
        using var saida1 = saidaDeVideo.QueryInterface<IDXGIOutput1>();
        D3D11.D3D11CreateDevice(placa, DriverType.Unknown, DeviceCreationFlags.BgraSupport | DeviceCreationFlags.VideoSupport,
            [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0], out ID3D11Device dispositivo, out ID3D11DeviceContext contexto).CheckError();
        using (var multithread = dispositivo.QueryInterface<ID3D11Multithread>()) multithread.SetMultithreadProtected(true);

        IDXGIOutputDuplication duplicacao = saida1.DuplicateOutput(dispositivo);
        var modo = duplicacao.Description.ModeDescription;
        int L = (int)modo.Width, A = (int)modo.Height;
        Console.Error.WriteLine($"tela {L}x{A} -> {largura}x{altura} @ {fps} fps, H.265 {mbps} Mbps, placa: {placa.Description1.Description}");

        // A cópia do quadro da tela (a duplicação devolve o quadro emprestado: precisa ser solto logo).
        using var copia = dispositivo.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)L, Height = (uint)A, MipLevels = 1, ArraySize = 1, Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0), Usage = ResourceUsage.Default, BindFlags = BindFlags.RenderTarget | BindFlags.ShaderResource,
        });

        // O processador de vídeo da placa: reduz e converte de BGRA para NV12, o formato do codificador.
        using var videoDevice = dispositivo.QueryInterface<ID3D11VideoDevice>();
        using var videoContext = contexto.QueryInterface<ID3D11VideoContext>();
        var conteudo = new VideoProcessorContentDescription
        {
            InputFrameFormat = VideoFrameFormat.Progressive,
            InputFrameRate = new Rational((uint)fps, 1), InputWidth = (uint)L, InputHeight = (uint)A,
            OutputFrameRate = new Rational((uint)fps, 1), OutputWidth = (uint)largura, OutputHeight = (uint)altura,
            Usage = VideoUsage.PlaybackNormal,
        };
        using var enumerador = videoDevice.CreateVideoProcessorEnumerator(conteudo);
        using var processador = videoDevice.CreateVideoProcessor(enumerador, 0);
        using var vistaDeEntrada = videoDevice.CreateVideoProcessorInputView(copia, enumerador,
            new VideoProcessorInputViewDescription { ViewDimension = VideoProcessorInputViewDimension.Texture2D });
        var anel = new ID3D11Texture2D[ANEL];
        var vistas = new ID3D11VideoProcessorOutputView[ANEL];
        for (int i = 0; i < ANEL; i++)
        {
            anel[i] = dispositivo.CreateTexture2D(new Texture2DDescription
            {
                Width = (uint)largura, Height = (uint)altura, MipLevels = 1, ArraySize = 1, Format = Format.NV12,
                SampleDescription = new SampleDescription(1, 0), Usage = ResourceUsage.Default, BindFlags = BindFlags.RenderTarget,
            });
            vistas[i] = videoDevice.CreateVideoProcessorOutputView(anel[i], enumerador,
                new VideoProcessorOutputViewDescription { ViewDimension = VideoProcessorOutputViewDimension.Texture2D });
        }

        // O codificador H.265 da placa.
        var entrada = new RegisterTypeInfo { GuidMajorType = TipoVideo, GuidSubtype = FormatoNv12 };
        var saidaTipo = new RegisterTypeInfo { GuidMajorType = TipoVideo, GuidSubtype = FormatoHevc };
        using var candidatos = MediaFactory.MFTEnumEx(CategoriaCodificador, (uint)(EnumFlag.EnumFlagHardware | EnumFlag.EnumFlagSortandfilter), entrada, saidaTipo);
        IMFActivate? ativador = null;
        foreach (var c in candidatos)
        {
            ativador = c;
            break;
        }
        if (ativador == null)
        {
            Console.Error.WriteLine("sem codificador H.265 na placa");
            return 2;
        }
        string nome = "?";
        try { nome = ativador.GetAllocatedString(NomeDoMft); } catch { }
        Console.Error.WriteLine($"codificador: {nome}");
        var codificador = ativador.ActivateObject<IMFTransform>();
        codificador.Attributes.Set(DestravarAssincrono, 1u).CheckError();
        codificador.Attributes.Set(BaixaLatencia, 1u);
        // Para transmissão ao vivo: soltar cada quadro assim que ele fica pronto, taxa constante e sem quadros B (que
        // dependem de quadros futuros). Sem a baixa latência, o codificador da AMD segurava 2 quadros (~67 ms).
        Console.Error.WriteLine("ajustes: baixa latência " + AjustarCodec(codificador.NativePointer, ModoDeBaixaLatencia, Sim())
            + ", CBR " + AjustarCodec(codificador.NativePointer, ControleDeTaxa, Inteiro(0))
            + ", sem quadros B " + AjustarCodec(codificador.NativePointer, QuadrosB, Inteiro(0))
            + ", bitrate " + AjustarCodec(codificador.NativePointer, BitrateMedioDoCodec, Inteiro((uint)(mbps * 1_000_000))) + " (0 = aceito)");
        var gerente = MediaFactory.MFCreateDXGIDeviceManager();
        gerente.ResetDevice(dispositivo).CheckError();
        codificador.ProcessMessage(TMessageType.MessageSetD3DManager, (UIntPtr)(nuint)gerente.NativePointer);

        var tipoSaida = MediaFactory.MFCreateMediaType();
        tipoSaida.Set(TipoPrincipal, TipoVideo);
        tipoSaida.Set(Subtipo, FormatoHevc);
        tipoSaida.Set(BitrateMedio, (uint)(mbps * 1_000_000));
        tipoSaida.Set(TamanhoDoQuadro, ((ulong)largura << 32) | (uint)altura);
        tipoSaida.Set(TaxaDeQuadros, ((ulong)fps << 32) | 1);
        tipoSaida.Set(Entrelacamento, 2u); // progressivo
        tipoSaida.Set(ProporcaoDoPixel, (1UL << 32) | 1);
        codificador.SetOutputType(0, tipoSaida, 0);
        var tipoEntrada = MediaFactory.MFCreateMediaType();
        tipoEntrada.Set(TipoPrincipal, TipoVideo);
        tipoEntrada.Set(Subtipo, FormatoNv12);
        tipoEntrada.Set(TamanhoDoQuadro, ((ulong)largura << 32) | (uint)altura);
        tipoEntrada.Set(TaxaDeQuadros, ((ulong)fps << 32) | 1);
        tipoEntrada.Set(Entrelacamento, 2u);
        tipoEntrada.Set(ProporcaoDoPixel, (1UL << 32) | 1);
        codificador.SetInputType(0, tipoEntrada, 0);
        codificador.ProcessMessage(TMessageType.MessageNotifyBeginStreaming, UIntPtr.Zero);
        codificador.ProcessMessage(TMessageType.MessageNotifyStartOfStream, UIntPtr.Zero);

        // ---- O laço do codificador (assíncrono: ele pede entrada e avisa quando tem saída) ----
        using var gravacao = File.Create(arquivo);
        var prontos = new BlockingCollection<(int indice, long numero, long momento)>(boundedCapacity: 2);
        var enviados = new ConcurrentDictionary<long, long>(); // número do quadro -> quando foi entregue ao codificador
        long codificados = 0, bytes = 0, somaDaCodificacao = 0;
        var fim = new CancellationTokenSource();
        var gerador = codificador.QueryInterface<IMFMediaEventGenerator>();
        var laco = new Thread(() =>
        {
            while (!fim.IsCancellationRequested)
            {
                using var evento = gerador.GetEvent(0);
                var tipo = (MediaEventTypes)evento.EventType;
                if (tipo == MediaEventTypes.TransformNeedInput)
                {
                    (int indice, long numero, long momento) quadro;
                    try { quadro = prontos.Take(fim.Token); } catch (OperationCanceledException) { break; }
                    using var bufferDaTextura = MediaFactory.MFCreateDXGISurfaceBuffer(typeof(ID3D11Texture2D).GUID, anel[quadro.indice], 0, false);
                    using var amostra = MediaFactory.MFCreateSample();
                    amostra.AddBuffer(bufferDaTextura);
                    amostra.SampleTime = quadro.numero * 10_000_000L / fps;
                    amostra.SampleDuration = 10_000_000L / fps;
                    enviados[amostra.SampleTime] = Stopwatch.GetTimestamp();
                    codificador.ProcessInput(0, amostra, 0);
                }
                else if (tipo == MediaEventTypes.TransformHaveOutput)
                {
                    var saida = new OutputDataBuffer { StreamID = 0 };
                    var r = codificador.ProcessOutput(ProcessOutputFlags.None, 1, ref saida, out _);
                    if (r.Failure || saida.Sample == null) continue;
                    using var amostra = saida.Sample;
                    using var buffer = amostra.ConvertToContiguousBuffer();
                    buffer.Lock(out IntPtr dados, out _, out int tamanho);
                    var copiaDosBytes = new byte[tamanho];
                    Marshal.Copy(dados, copiaDosBytes, 0, tamanho);
                    buffer.Unlock();
                    gravacao.Write(copiaDosBytes);
                    Interlocked.Add(ref bytes, tamanho);
                    Interlocked.Increment(ref codificados);
                    if (enviados.TryRemove(amostra.SampleTime, out long entregue))
                        Interlocked.Add(ref somaDaCodificacao, Stopwatch.GetTimestamp() - entregue);
                }
            }
        }) { IsBackground = true, Name = "codificador" };
        laco.Start();

        // ---- O laço da captura: a cada 1/fps, pega o quadro novo (se houver), reduz e entrega ----
        var relogio = Stopwatch.StartNew();
        long intervalo = Stopwatch.Frequency / fps;
        long proximo = Stopwatch.GetTimestamp();
        long numero = 0, capturados = 0, entregues = 0, somaDoPreparo = 0, perdidos = 0;
        long ultimoSegundo = 0, capAnt = 0, entAnt = 0, codAnt = 0, bytesAnt = 0, preparoAnt = 0, codifAnt = 0;
        bool temQuadro = false;
        while (relogio.Elapsed.TotalSeconds < segundos)
        {
            long agora = Stopwatch.GetTimestamp();
            if (agora < proximo)
            {
                int ms = (int)((proximo - agora) * 1000 / Stopwatch.Frequency);
                if (ms > 1) Thread.Sleep(ms - 1); else Thread.SpinWait(200);
                continue;
            }
            proximo += intervalo;
            long inicio = Stopwatch.GetTimestamp();

            var r = duplicacao.AcquireNextFrame(0, out _, out IDXGIResource? recurso);
            if (r.Success && recurso != null)
            {
                using (var textura = recurso.QueryInterface<ID3D11Texture2D>()) contexto.CopyResource(copia, textura);
                recurso.Dispose();
                duplicacao.ReleaseFrame();
                capturados++;
                temQuadro = true;
            }
            else if (r.Code == Vortice.DXGI.ResultCode.AccessLost.Code)
            {
                // A tela mudou de modo (um jogo em tela cheia exclusiva, por exemplo): abre a duplicação de novo.
                duplicacao.Dispose();
                duplicacao = saida1.DuplicateOutput(dispositivo);
                continue;
            }
            if (!temQuadro) continue;

            int indice = (int)(numero % ANEL);
            videoContext.VideoProcessorBlt(processador, vistas[indice], 0, 1,
                [new VideoProcessorStream { Enable = true, InputSurface = vistaDeEntrada }]).CheckError();
            contexto.Flush();
            somaDoPreparo += Stopwatch.GetTimestamp() - inicio;
            if (prontos.TryAdd((indice, numero, Stopwatch.GetTimestamp()))) entregues++;
            else perdidos++; // o codificador não acompanhou: o quadro é descartado
            numero++;

            long segundo = (long)relogio.Elapsed.TotalSeconds;
            if (segundo != ultimoSegundo)
            {
                ultimoSegundo = segundo;
                long cod = Interlocked.Read(ref codificados), byt = Interlocked.Read(ref bytes), cdf = Interlocked.Read(ref somaDaCodificacao);
                long novosEntregues = entregues - entAnt, novosCodificados = cod - codAnt;
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    s = segundo,
                    capturados = capturados - capAnt,
                    entregues = novosEntregues,
                    codificados = novosCodificados,
                    perdidos,
                    mbps = Math.Round((byt - bytesAnt) * 8 / 1e6, 2),
                    msPreparo = novosEntregues > 0 ? Math.Round((somaDoPreparo - preparoAnt) * 1000.0 / Stopwatch.Frequency / novosEntregues, 2) : 0,
                    msCodificacao = novosCodificados > 0 ? Math.Round((cdf - codifAnt) * 1000.0 / Stopwatch.Frequency / novosCodificados, 2) : 0,
                }));
                capAnt = capturados; entAnt = entregues; codAnt = cod; bytesAnt = byt; preparoAnt = somaDoPreparo; codifAnt = cdf;
            }
        }

        fim.Cancel();
        codificador.ProcessMessage(TMessageType.MessageNotifyEndOfStream, UIntPtr.Zero);
        laco.Join(1000);
        Console.Error.WriteLine($"fim: {numero} quadros entregues, {Interlocked.Read(ref codificados)} codificados, arquivo {arquivo}");
        return 0;
    }

    static int Numero(string[] a, string nome, int padrao)
    {
        int i = Array.IndexOf(a, nome);
        return i >= 0 && i + 1 < a.Length && int.TryParse(a[i + 1], out int v) ? v : padrao;
    }

    static string Texto(string[] a, string nome, string padrao)
    {
        int i = Array.IndexOf(a, nome);
        return i >= 0 && i + 1 < a.Length ? a[i + 1] : padrao;
    }
}
