using System.Runtime.InteropServices;

namespace Ozamigos.Som;

/// <summary>Foto dos processos abertos: quem é pai de quem, o nome do .exe e quando começou.</summary>
static class Processos
{
    public readonly record struct Processo(uint Pid, uint Pai, string Nome, long Criado);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32W
    {
        public uint dwSize, cntUsage, th32ProcessID;
        public nint th32DefaultHeapID;
        public uint th32ModuleID, cntThreads, th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("kernel32.dll")]
    static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern int Process32FirstW(IntPtr foto, ref PROCESSENTRY32W entrada);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern int Process32NextW(IntPtr foto, ref PROCESSENTRY32W entrada);

    [DllImport("kernel32.dll")]
    static extern IntPtr OpenProcess(uint acesso, int herdar, uint pid);

    [DllImport("kernel32.dll")]
    static extern int GetProcessTimes(IntPtr processo, out long criado, out long saiu, out long kernel, out long usuario);

    [DllImport("kernel32.dll")]
    static extern int CloseHandle(IntPtr alca);

    public static Dictionary<uint, Processo> Listar()
    {
        var processos = new Dictionary<uint, Processo>();
        var foto = CreateToolhelp32Snapshot(0x2, 0); // TH32CS_SNAPPROCESS
        if (foto == IntPtr.Zero || foto == new IntPtr(-1)) return processos;
        try
        {
            var entrada = new PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>() };
            for (int ok = Process32FirstW(foto, ref entrada); ok != 0; ok = Process32NextW(foto, ref entrada))
            {
                uint pid = entrada.th32ProcessID;
                processos[pid] = new Processo(pid, entrada.th32ParentProcessID, entrada.szExeFile, Criacao(pid));
            }
        }
        finally
        {
            CloseHandle(foto);
        }
        return processos;
    }

    /// <summary>Quando o processo começou (0 se o Windows não deixar saber).</summary>
    static long Criacao(uint pid)
    {
        var processo = OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if (processo == IntPtr.Zero) return 0;
        try
        {
            return GetProcessTimes(processo, out long criado, out _, out _, out _) != 0 ? criado : 0;
        }
        finally
        {
            CloseHandle(processo);
        }
    }

    /// <summary>
    /// O pai de verdade. O Windows reaproveita números de processo: se o "pai" começou depois
    /// do filho, é outro programa que ganhou o número de um pai que já fechou.
    /// </summary>
    public static bool PaiDe(Dictionary<uint, Processo> processos, uint pid, out uint pai)
    {
        pai = 0;
        if (!processos.TryGetValue(pid, out var filho) || filho.Pai == pid || !processos.TryGetValue(filho.Pai, out var candidato)) return false;
        if (candidato.Criado != 0 && filho.Criado != 0 && candidato.Criado > filho.Criado) return false;
        pai = candidato.Pid;
        return true;
    }
}
