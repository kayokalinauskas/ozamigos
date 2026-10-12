using System.Runtime.InteropServices;

namespace Ozamigos.Som;

/// <summary>A captura do som de um programa (e dos filhos dele), numa thread própria.</summary>
sealed unsafe class Captura
{
    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct WaveFormatEx
    {
        public ushort Tipo, Canais;
        public uint AmostrasPorSegundo, BytesPorSegundo;
        public ushort Alinhamento, BitsPorAmostra, Extra;
    }

    // AUDCLNT_STREAMFLAGS: LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY.
    // AUTOCONVERTPCM deixa o Windows converter o som do programa para o formato que pedimos.
    const uint Fluxo = 0x00020000 | 0x00040000 | 0x80000000 | 0x08000000;
    const uint BufferSilencioso = 0x2;

    [DllImport("kernel32.dll")]
    static extern IntPtr CreateEventW(IntPtr atributos, int manual, int inicial, IntPtr nome);

    [DllImport("kernel32.dll")]
    static extern uint WaitForSingleObject(IntPtr evento, uint milissegundos);

    [DllImport("kernel32.dll")]
    static extern int CloseHandle(IntPtr alca);

    public uint Pid { get; }
    public string Nome { get; }
    public Anel Anel { get; } = new();

    readonly Thread linha;
    readonly ManualResetEventSlim iniciou = new();
    volatile bool parar;
    bool funcionou;

    Captura(uint pid, string nome)
    {
        Pid = pid;
        Nome = nome;
        linha = new Thread(Rodar) { IsBackground = true, Name = $"captura {nome}", Priority = ThreadPriority.AboveNormal };
    }

    /// <summary>Abre a captura; devolve null se o Windows recusar.</summary>
    public static Captura? Abrir(uint pid, string nome)
    {
        var captura = new Captura(pid, nome);
        captura.linha.Start();
        captura.iniciou.Wait(7000);
        if (captura.funcionou) return captura;
        captura.parar = true;
        return null;
    }

    public void Fechar()
    {
        parar = true;
        linha.Join(1000);
    }

    void Rodar()
    {
        Com.IniciarThread();
        IntPtr cliente = IntPtr.Zero, captura = IntPtr.Zero, evento = IntPtr.Zero;
        try
        {
            cliente = Ativacao.Ativar(Pid, incluir: true, out int erro);
            if (cliente == IntPtr.Zero) throw new COMException($"ativação falhou (0x{erro:X8})", erro);

            // Pedimos sempre o mesmo formato (48 kHz, estéreo, 16 bits): o Windows converte.
            var formato = new WaveFormatEx
            {
                Tipo = 1,
                Canais = 2,
                AmostrasPorSegundo = 48000,
                BytesPorSegundo = 48000 * 4,
                Alinhamento = 4,
                BitsPorAmostra = 16,
            };
            // IAudioClient::Initialize(compartilhado, fluxo, buffer de 200 ms, 0, formato, sessão)
            Com.Checar(((delegate* unmanaged[Stdcall]<IntPtr, int, uint, long, long, WaveFormatEx*, Guid*, int>)Com.Metodo(cliente, 3))(
                cliente, 0, Fluxo, 2_000_000, 0, &formato, null), "Initialize");
            // IAudioClient::GetService(IAudioCaptureClient)
            var iid = Com.IID_IAudioCaptureClient;
            IntPtr servico;
            Com.Checar(((delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)Com.Metodo(cliente, 14))(cliente, &iid, &servico), "GetService");
            captura = servico;
            evento = CreateEventW(IntPtr.Zero, 0, 0, IntPtr.Zero);
            // IAudioClient::SetEventHandle e IAudioClient::Start
            Com.Checar(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int>)Com.Metodo(cliente, 13))(cliente, evento), "SetEventHandle");
            Com.Checar(((delegate* unmanaged[Stdcall]<IntPtr, int>)Com.Metodo(cliente, 10))(cliente), "Start");
            funcionou = true;
            iniciou.Set();

            var amostras = new float[4800 * 2];
            while (!parar)
            {
                WaitForSingleObject(evento, 100);
                while (!parar)
                {
                    uint proximo;
                    // IAudioCaptureClient::GetNextPacketSize
                    if (((delegate* unmanaged[Stdcall]<IntPtr, uint*, int>)Com.Metodo(captura, 5))(captura, &proximo) < 0) return;
                    if (proximo == 0) break;
                    byte* dados;
                    uint quadros, avisos;
                    ulong posicao, momento;
                    // IAudioCaptureClient::GetBuffer
                    if (((delegate* unmanaged[Stdcall]<IntPtr, byte**, uint*, uint*, ulong*, ulong*, int>)Com.Metodo(captura, 3))(
                        captura, &dados, &quadros, &avisos, &posicao, &momento) < 0) return;
                    int quantidade = (int)quadros * 2;
                    if (amostras.Length < quantidade) amostras = new float[quantidade];
                    if ((avisos & BufferSilencioso) != 0)
                    {
                        Array.Clear(amostras, 0, quantidade);
                    }
                    else
                    {
                        var pcm = (short*)dados;
                        for (int i = 0; i < quantidade; i++) amostras[i] = pcm[i] / 32768f;
                    }
                    // IAudioCaptureClient::ReleaseBuffer
                    ((delegate* unmanaged[Stdcall]<IntPtr, uint, int>)Com.Metodo(captura, 4))(captura, quadros);
                    Anel.Escrever(amostras.AsSpan(0, quantidade));
                }
            }
            ((delegate* unmanaged[Stdcall]<IntPtr, int>)Com.Metodo(cliente, 11))(cliente); // Stop
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"não foi possível capturar {Nome} ({Pid}): {e.Message}");
        }
        finally
        {
            iniciou.Set();
            Com.Release(captura);
            Com.Release(cliente);
            if (evento != IntPtr.Zero) CloseHandle(evento);
        }
    }
}

/// <summary>
/// Fila circular de amostras de uma captura. Quem captura escreve no ritmo do Windows;
/// o misturador lê no ritmo dele. Uma pequena reserva (20 ms) evita picotar, e o excesso
/// (mais de 100 ms) é descartado para o atraso não crescer.
/// </summary>
sealed class Anel
{
    const int Capacidade = 48000 * 2;
    const int Reserva = 960 * 2;
    const int Maximo = 4800 * 2;
    const int Alvo = 1920 * 2;

    readonly float[] dados = new float[Capacidade];
    readonly Lock trava = new();
    int inicio, quantidade;
    bool pronto;

    public void Escrever(ReadOnlySpan<float> amostras)
    {
        lock (trava)
        {
            foreach (var amostra in amostras)
            {
                if (quantidade == Capacidade)
                {
                    inicio = (inicio + 1) % Capacidade;
                    quantidade--;
                }
                dados[(inicio + quantidade) % Capacidade] = amostra;
                quantidade++;
            }
        }
    }

    /// <summary>Soma as amostras disponíveis na mistura (o que faltar fica em silêncio).</summary>
    public void Misturar(Span<float> mistura)
    {
        lock (trava)
        {
            if (!pronto)
            {
                if (quantidade < Reserva) return;
                pronto = true;
            }
            if (quantidade > Maximo)
            {
                int pular = quantidade - Alvo;
                inicio = (inicio + pular) % Capacidade;
                quantidade -= pular;
            }
            int n = Math.Min(quantidade, mistura.Length);
            for (int i = 0; i < n; i++) mistura[i] += dados[(inicio + i) % Capacidade];
            inicio = (inicio + n) % Capacidade;
            quantidade -= n;
            if (n < mistura.Length) pronto = false; // esvaziou: espera juntar a reserva de novo
        }
    }
}
