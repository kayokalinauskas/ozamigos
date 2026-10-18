using System.Runtime.InteropServices;

namespace Ozamigos.Som;

/// <summary>
/// OzamigosSom.exe --relogio 1234
///
/// Pede ao Windows 11 que continue honrando o relógio fino (timeBeginPeriod) do processo 1234 (o app)
/// mesmo com as janelas dele tapadas, e termina. Sem isso, com o jogo na frente do Ozamigos, o Windows
/// passa o app para o tique padrão de 15,6 ms depois de uns segundos: a captura da tela, que pede um
/// quadro a cada 33 ms, só acorda no tique seguinte, a cada 46,9 ms, e fica presa em ~21 fps com a placa
/// folgada. Medido numa bancada (14/10/2026): 29–30 fps viravam 21–22 sem isto, e ficavam em 29–30 com.
/// A marca vale até o processo terminar; quem a põe pode ser outro processo do mesmo usuário.
/// </summary>
static class Relogio
{
    const int ProcessPowerThrottling = 4; // PROCESS_INFORMATION_CLASS
    const uint PROCESS_SET_INFORMATION = 0x0200;
    const uint PROCESS_POWER_THROTTLING_CURRENT_VERSION = 1;
    const uint PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION = 0x4;

    [StructLayout(LayoutKind.Sequential)]
    struct EstadoDeEconomia
    {
        public uint Version;
        public uint ControlMask;
        public uint StateMask;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint acesso, bool herdar, uint pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetProcessInformation(IntPtr processo, int classe, ref EstadoDeEconomia info, uint tamanho);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    /// <summary>
    /// A mesma marca, neste processo: sem janela, ele é "invisível" para o Windows 11, que ignora o timeBeginPeriod
    /// (o Sleep(1) do misturador virava o tique de 15,6 ms) e pode mandá-lo para os núcleos de economia.
    /// </summary>
    public static void MarcarEsteProcesso()
    {
        const uint VELOCIDADE = 0x1; // PROCESS_POWER_THROTTLING_EXECUTION_SPEED
        var estado = new EstadoDeEconomia
        {
            Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask = PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION | VELOCIDADE,
            StateMask = 0,
        };
        SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling, ref estado, (uint)Marshal.SizeOf<EstadoDeEconomia>());
    }

    public static int Rodar(string[] argumentos)
    {
        int i = Array.IndexOf(argumentos, "--relogio");
        if (i < 0 || i + 1 >= argumentos.Length || !uint.TryParse(argumentos[i + 1], out var pid)) return 2;
        var processo = OpenProcess(PROCESS_SET_INFORMATION, false, pid);
        if (processo == IntPtr.Zero)
        {
            Console.Error.WriteLine($"erro {Marshal.GetLastWin32Error()}");
            return 1;
        }
        // No ControlMask e fora do StateMask: "esta regra de economia, não aplique" (documentação do SetProcessInformation).
        var estado = new EstadoDeEconomia
        {
            Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask = PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
            StateMask = 0,
        };
        bool ok = SetProcessInformation(processo, ProcessPowerThrottling, ref estado, (uint)Marshal.SizeOf<EstadoDeEconomia>());
        int erro = Marshal.GetLastWin32Error(); // antes do CloseHandle, que pode sobrescrever
        CloseHandle(processo);
        // Windows 10 não conhece a regra (lá o relógio fino já vale com a janela tapada): não é erro.
        Console.Error.WriteLine(ok ? "pronto" : $"erro {erro}");
        return ok ? 0 : 1;
    }
}
