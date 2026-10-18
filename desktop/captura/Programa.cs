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
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool SetProcessInformation(IntPtr processo, int classe, ref EstadoDeEconomia info, uint tamanho);

    [StructLayout(LayoutKind.Sequential)]
    struct EstadoDeEconomia { public uint Version, ControlMask, StateMask; }

    /// <summary>
    /// Este processo não tem janela: para o Windows 11, ele é "invisível" e perde o relógio fino (o Sleep(1) vira o
    /// tique de 15,6 ms) e pode ir para os núcleos de economia. Os dois atrasariam cada quadro. A mesma marca que o app
    /// recebe do auxiliar de som (Relogio.cs), aqui no próprio processo; no Windows 10, não faz nada.
    /// </summary>
    static void SemEconomiaDeEnergia()
    {
        const uint IGNORAR_RELOGIO = 0x4, VELOCIDADE = 0x1; // PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION, _EXECUTION_SPEED
        // No ControlMask e fora do StateMask: "esta regra de economia, não aplique".
        var estado = new EstadoDeEconomia { Version = 1, ControlMask = IGNORAR_RELOGIO | VELOCIDADE, StateMask = 0 };
        SetProcessInformation(GetCurrentProcess(), 4 /* ProcessPowerThrottling */, ref estado, (uint)Marshal.SizeOf<EstadoDeEconomia>());
    }

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
        SemEconomiaDeEnergia();
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

        // O jogo não pode atrasar a captura: o processo e o laço vão acima do normal, e o trabalho dele na placa (pouco:
        // reduzir, converter e copiar um quadro) passa na frente na fila dela, quando o Windows deixa.
        try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.AboveNormal; } catch { }
        Thread.CurrentThread.Priority = ThreadPriority.Highest;
        string prioridadeNaPlaca;
        using (var dxgi = dispositivo.QueryInterface<IDXGIDevice>()) prioridadeNaPlaca = dxgi.SetGPUThreadPriority(7).Success ? "alta" : "normal";

        using var captura = new Wgc(dispositivo, janela, int.Parse(ponto[0]), int.Parse(ponto[1]));
        using var conversor = new Conversor(dispositivo, contexto, larguraMaxima, alturaMaxima, fps);
        Console.Error.WriteLine("pronto");
        Console.Error.WriteLine($"placa: {placa.Description1.Description}; borda {(captura.BordaTirada ? "tirada" : "do Windows")}; prioridade na placa {prioridadeNaPlaca}");

        using var saida = new Saida();
        byte[] quadro = []; // o último quadro (o que se repete com a imagem parada)
        long relogioBase = Stopwatch.GetTimestamp();
        double epocaBase = (DateTime.UtcNow - DateTime.UnixEpoch).TotalMilliseconds;
        double EmMs(long momento) => epocaBase + (momento - relogioBase) * 1000.0 / Stopwatch.Frequency;

        // O laço olha o Windows a cada ~1 ms e manda cada quadro assim que ele chega, sem passar do fps pedido: cada
        // envio marca a vez do próximo um intervalo depois (contado da vez marcada, não da hora em que chegou), e um
        // quadro pode ir até 10% do intervalo adiantado. Assim, um jogo a 60 com a captura a 60, fora de fase, não perde
        // quadros, e a média fica no fps pedido. Antes, num ritmo fixo de 1/fps, o quadro esperava até o próximo tique
        // (meio intervalo, em média) e, fora de fase, um saía pulado e o seguinte repetido.
        var relogio = Stopwatch.StartNew();
        long intervalo = Stopwatch.Frequency / fps, folga = intervalo / 10;
        long proximaVez = 0, ultimaEscrita = 0;
        IntPtr guardado = IntPtr.Zero; // o quadro mais novo do Windows, esperando a vez de ir para a placa
        ID3D11Texture2D? texturaGuardada = null;
        Wgc.Tamanho conteudoGuardado = default;
        long capturadoGuardado = 0;
        uint numero = 0;
        long novos = 0, repetidos = 0, somaDoAuxiliar = 0, pulados = 0, atrasados = 0, voltas = 0;
        long ultimoSegundo = 0, novosAnt = 0, repetidosAnt = 0, auxiliarAnt = 0, puladosAnt = 0, atrasadosAnt = 0, voltasAnt = 0;
        (long ticks, long escritos, long descartados) saidaAnt = (0, 0, 0);
        try
        {
            while (!fim && !saida.Fechada && (segundos == 0 || relogio.Elapsed.TotalSeconds < segundos))
            {
                bool escreveu = false;
                voltas++;
                // 1. O que a placa já terminou vai para a saída, na ordem.
                if (quadro.Length != conversor.TamanhoDoQuadro && conversor.Largura > 0) quadro = new byte[conversor.TamanhoDoQuadro];
                while (conversor.TentarLer(quadro, out long capturado, out long enviado))
                {
                    long lido = Stopwatch.GetTimestamp();
                    "OZQ1"u8.CopyTo(quadro);
                    BitConverter.TryWriteBytes(quadro.AsSpan(4), (ushort)conversor.Largura);
                    BitConverter.TryWriteBytes(quadro.AsSpan(6), (ushort)conversor.Altura);
                    BitConverter.TryWriteBytes(quadro.AsSpan(8), numero++);
                    BitConverter.TryWriteBytes(quadro.AsSpan(16), EmMs(capturado));
                    saida.Mandar(quadro);
                    somaDoAuxiliar += lido - enviado;
                    ultimaEscrita = lido;
                    novos++;
                    escreveu = true;
                }

                // 2. Um quadro novo do Windows fica guardado (o anterior, se ainda não foi, sai pulado: o fps passou do pedido).
                IntPtr novo = captura.MaisNovo(out ID3D11Texture2D? textura, out Wgc.Tamanho conteudo);
                if (novo != IntPtr.Zero)
                {
                    if (guardado != IntPtr.Zero)
                    {
                        texturaGuardada?.Dispose();
                        Wgc.Fechar(guardado);
                        pulados++;
                    }
                    guardado = novo;
                    texturaGuardada = textura;
                    conteudoGuardado = conteudo;
                    capturadoGuardado = Stopwatch.GetTimestamp(); // o momento em que o Windows o entregou (o laço olha a cada ~1 ms)
                }

                // 3. Chegou a vez: o guardado vai para a placa (reduzir, converter e copiar para leitura).
                long inicio = Stopwatch.GetTimestamp();
                if (guardado != IntPtr.Zero && inicio >= proximaVez - folga)
                {
                    try
                    {
                        var descricao = texturaGuardada!.Description;
                        int largura = Math.Min(conteudoGuardado.Largura, (int)descricao.Width), altura = Math.Min(conteudoGuardado.Altura, (int)descricao.Height);
                        if (largura >= 2 && altura >= 2)
                        {
                            // Parado por um tempo (imagem sem mudar), a vez recomeça de agora: sem rajada para "compensar".
                            if (conversor.Enviar(texturaGuardada, largura, altura, capturadoGuardado, inicio)) proximaVez = Math.Max(proximaVez, inicio - folga) + intervalo;
                            else atrasados++; // as três leituras ainda na fila da placa: este fica de fora
                        }
                    }
                    finally
                    {
                        texturaGuardada?.Dispose();
                        Wgc.Fechar(guardado);
                        guardado = IntPtr.Zero;
                        texturaGuardada = null;
                    }
                }

                // 4. A imagem parada: o último quadro de novo a cada 100 ms (com a mesma imagem, sem passar pela placa).
                if (!escreveu && ultimaEscrita != 0 && conversor.Pendentes == 0 && guardado == IntPtr.Zero
                    && (inicio - ultimaEscrita) * 1000.0 / Stopwatch.Frequency >= REPETIR_DEPOIS_MS)
                {
                    BitConverter.TryWriteBytes(quadro.AsSpan(8), numero++);
                    BitConverter.TryWriteBytes(quadro.AsSpan(16), EmMs(inicio));
                    saida.Mandar(quadro);
                    ultimaEscrita = inicio;
                    repetidos++;
                }

                // 5. Uma vez por segundo: as medidas, a janela que fechou e a placa que reiniciou.
                long segundo = (long)relogio.Elapsed.TotalSeconds;
                if (segundo != ultimoSegundo)
                {
                    ultimoSegundo = segundo;
                    if (janela != IntPtr.Zero && !IsWindow(janela))
                    {
                        Console.Error.WriteLine("fechou");
                        return 3;
                    }
                    // O driver da placa reiniciou (ou ela foi desligada): o dispositivo não serve mais, e o Windows não
                    // manda quadros. Sem isto, a página ficaria repetindo a última imagem; saindo, o app troca para a
                    // captura do Chromium.
                    if (dispositivo.DeviceRemovedReason.Failure)
                    {
                        Console.Error.WriteLine($"erro: a placa de vídeo reiniciou ({dispositivo.DeviceRemovedReason})");
                        return 4;
                    }
                    long n = novos - novosAnt;
                    // msConversao: da ida para a placa até o NV12 lido (a placa e a espera pela volta seguinte do laço);
                    // msSaida: escrever um quadro para o app, na thread da saída (o cano só esvazia quando o app lê);
                    // descartados: os que não couberam na fila da saída (o app atrasou).
                    double msAuxiliar = n > 0 ? (somaDoAuxiliar - auxiliarAnt) * 1000.0 / Stopwatch.Frequency / n : 0;
                    var medidasDaSaida = saida.Medidas;
                    long escritos = medidasDaSaida.escritos - saidaAnt.escritos;
                    double msSaida = escritos > 0 ? (medidasDaSaida.ticks - saidaAnt.ticks) * 1000.0 / Stopwatch.Frequency / escritos : 0;
                    long descartados = medidasDaSaida.descartados - saidaAnt.descartados;
                    saidaAnt = medidasDaSaida;
                    Console.Error.WriteLine(FormattableString.Invariant(
                        $"{{\"s\":{segundo},\"novos\":{n},\"repetidos\":{repetidos - repetidosAnt},\"pulados\":{pulados - puladosAnt},\"atrasados\":{atrasados - atrasadosAnt},\"msConversao\":{msAuxiliar:0.00},\"msSaida\":{msSaida:0.00},\"descartados\":{descartados},\"voltas\":{voltas - voltasAnt},\"largura\":{conversor.Largura},\"altura\":{conversor.Altura},\"processadorMs\":{Process.GetCurrentProcess().TotalProcessorTime.TotalMilliseconds:0}}}"));
                    novosAnt = novos;
                    repetidosAnt = repetidos;
                    auxiliarAnt = somaDoAuxiliar;
                    voltasAnt = voltas;
                    puladosAnt = pulados;
                    atrasadosAnt = atrasados;
                }

                Thread.Sleep(1); // com o timeBeginPeriod(1), ~1 ms
            }
        }
        finally
        {
            texturaGuardada?.Dispose();
            if (guardado != IntPtr.Zero) Wgc.Fechar(guardado);
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
