using System.Diagnostics;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace Ozamigos.Captura;

/// <summary>
/// OzamigosCaptura.exe (--janela HWND | --tela X,Y) [--fps 30] [--largura 1280] [--altura 720] [--segundos N]
///
/// A captura de vídeo do app (1.2.18 em diante), no lugar da do Chromium: captura a janela ou a tela pelo Windows
/// (Windows Graphics Capture), reduz e converte para NV12 no processador de vídeo da placa e escreve cada quadro na
/// saída padrão. O app passa os quadros à página, que monta a trilha de vídeo do WebRTC (como o som do PC). O Chromium
/// copia o quadro inteiro para a memória antes de reduzir e nunca deixa a cópia passar de metade do tempo: com o jogo
/// pesado, isso o prendia em ~21 fps (no Path of Exile, esta captura deu 28–30).
///
/// Cada quadro: um cabeçalho de 24 bytes ("OZQ1", largura e altura em u16, o número do quadro em u32, 4 de reserva e o
/// momento da captura em ms desde 1970, f64) e o NV12 (largura × altura × 1,5 bytes). Só sai quadro quando a imagem
/// muda; parada, o último é repetido a cada 100 ms (com a tela parada, quem assiste contaria congelamentos).
///
/// Na saída de erro: "pronto" quando a captura começou, uma linha JSON por segundo com as medidas, "fechou" se a
/// janela foi fechada, e "erro: …" se não deu para capturar. Termina quando a entrada padrão fecha (o app fechou ou
/// parou a transmissão), como o auxiliar de som; com --segundos (bancada), depois desse tempo.
/// </summary>
static class Programa
{
    const double REPETIR_DEPOIS_MS = 100; // o mesmo piso de 10 fps da captura do Chromium (FPS_MINIMO_DA_CAPTURA)

    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint periodo);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr janela);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr contexto);

    static volatile bool fim;

    static int Main(string[] argumentos)
    {
        try
        {
            return Capturar(argumentos);
        }
        catch (Exception erro)
        {
            Console.Error.WriteLine($"erro: {erro.Message}");
            return 1;
        }
    }

    static int Capturar(string[] argumentos)
    {
        int fps = Numero(argumentos, "--fps", 30);
        int larguraMaxima = Numero(argumentos, "--largura", 1280);
        int alturaMaxima = Numero(argumentos, "--altura", 720);
        int segundos = Numero(argumentos, "--segundos", 0);
        IntPtr janela = (IntPtr)long.Parse(Texto(argumentos, "--janela", "0"));
        string[] ponto = Texto(argumentos, "--tela", "0,0").Split(',');
        // A tela vem como um ponto em pixels de verdade (o app converte de DIP): sem isto, o Windows trocaria os
        // números para um processo que não conhece a escala de cada tela.
        SetProcessDpiAwarenessContext((IntPtr)(-4)); // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
        timeBeginPeriod(1);

        if (segundos == 0)
        {
            // A entrada fechou: o app parou a transmissão ou fechou (ele nunca deixa este processo sozinho).
            new Thread(() =>
            {
                using var entrada = Console.OpenStandardInput();
                var lixo = new byte[64];
                try { while (entrada.Read(lixo) > 0) { } } catch (IOException) { }
                fim = true;
            }) { IsBackground = true, Name = "entrada" }.Start();
        }

        using var fabrica = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
        fabrica.EnumAdapters1(0, out IDXGIAdapter1 placa).CheckError();
        D3D11.D3D11CreateDevice(placa, DriverType.Unknown, DeviceCreationFlags.BgraSupport | DeviceCreationFlags.VideoSupport,
            [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0], out ID3D11Device dispositivo, out ID3D11DeviceContext contexto).CheckError();
        // O pool da captura usa o dispositivo na thread dele.
        using (var multithread = dispositivo.QueryInterface<ID3D11Multithread>()) multithread.SetMultithreadProtected(true);

        using var captura = new Wgc(dispositivo, janela, int.Parse(ponto[0]), int.Parse(ponto[1]));
        using var conversor = new Conversor(dispositivo, contexto, larguraMaxima, alturaMaxima, fps);
        Console.Error.WriteLine("pronto");
        Console.Error.WriteLine($"placa: {placa.Description1.Description}; borda {(captura.BordaTirada ? "tirada" : "do Windows")}");

        using var saida = Console.OpenStandardOutput();
        byte[] quadro = [];
        int tamanhoDoQuadro = 0;
        long relogioBase = Stopwatch.GetTimestamp();
        double epocaBase = (DateTime.UtcNow - DateTime.UnixEpoch).TotalMilliseconds;

        var relogio = Stopwatch.StartNew();
        long intervalo = Stopwatch.Frequency / fps;
        long proximo = Stopwatch.GetTimestamp(), ultimaEscrita = 0;
        uint numero = 0;
        long novos = 0, repetidos = 0, somaDaConversao = 0;
        long ultimoSegundo = 0, novosAnt = 0, repetidosAnt = 0, conversaoAnt = 0;
        while (!fim && (segundos == 0 || relogio.Elapsed.TotalSeconds < segundos))
        {
            long agora = Stopwatch.GetTimestamp();
            if (agora < proximo)
            {
                int ms = (int)((proximo - agora) * 1000 / Stopwatch.Frequency);
                if (ms > 1) Thread.Sleep(ms - 1); else Thread.SpinWait(200);
                continue;
            }
            proximo = Math.Max(proximo + intervalo, agora - intervalo); // atrasou muito (o PC travou): não tenta compensar
            long inicio = Stopwatch.GetTimestamp();

            bool escrever = false;
            IntPtr novo = captura.MaisNovo(out ID3D11Texture2D? textura, out Wgc.Tamanho conteudo);
            if (novo != IntPtr.Zero)
            {
                try
                {
                    var descricao = textura!.Description;
                    int largura = Math.Min(conteudo.Largura, (int)descricao.Width), altura = Math.Min(conteudo.Altura, (int)descricao.Height);
                    if (largura >= 2 && altura >= 2)
                    {
                        var (saidaL, saidaA) = Conversor.TamanhoDeSaida(largura, altura, larguraMaxima, alturaMaxima);
                        int tamanho = 24 + saidaL * saidaA * 3 / 2;
                        if (tamanho != tamanhoDoQuadro)
                        {
                            quadro = new byte[tamanho];
                            tamanhoDoQuadro = tamanho;
                        }
                        conversor.Converter(textura, largura, altura, quadro.AsSpan(24));
                        BitConverter.TryWriteBytes(quadro.AsSpan(4), (ushort)conversor.Largura);
                        BitConverter.TryWriteBytes(quadro.AsSpan(6), (ushort)conversor.Altura);
                        "OZQ1"u8.CopyTo(quadro);
                        somaDaConversao += Stopwatch.GetTimestamp() - inicio;
                        novos++;
                        escrever = true;
                    }
                }
                finally
                {
                    textura?.Dispose();
                    Wgc.Fechar(novo);
                }
            }
            else if (tamanhoDoQuadro > 0 && (inicio - ultimaEscrita) * 1000.0 / Stopwatch.Frequency >= REPETIR_DEPOIS_MS)
            {
                repetidos++;
                escrever = true;
            }

            if (escrever)
            {
                BitConverter.TryWriteBytes(quadro.AsSpan(8), numero++);
                BitConverter.TryWriteBytes(quadro.AsSpan(16), epocaBase + (inicio - relogioBase) * 1000.0 / Stopwatch.Frequency);
                try
                {
                    saida.Write(quadro);
                    saida.Flush();
                }
                catch (IOException)
                {
                    break; // o app fechou a saída
                }
                ultimaEscrita = inicio;
            }

            long segundo = (long)relogio.Elapsed.TotalSeconds;
            if (segundo != ultimoSegundo)
            {
                ultimoSegundo = segundo;
                if (janela != IntPtr.Zero && !IsWindow(janela))
                {
                    Console.Error.WriteLine("fechou");
                    return 3;
                }
                long n = novos - novosAnt;
                double msConversao = n > 0 ? (somaDaConversao - conversaoAnt) * 1000.0 / Stopwatch.Frequency / n : 0;
                Console.Error.WriteLine(FormattableString.Invariant(
                    $"{{\"s\":{segundo},\"novos\":{n},\"repetidos\":{repetidos - repetidosAnt},\"msConversao\":{msConversao:0.00},\"largura\":{conversor.Largura},\"altura\":{conversor.Altura},\"processadorMs\":{Process.GetCurrentProcess().TotalProcessorTime.TotalMilliseconds:0}}}"));
                novosAnt = novos;
                repetidosAnt = repetidos;
                conversaoAnt = somaDaConversao;
            }
        }
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
