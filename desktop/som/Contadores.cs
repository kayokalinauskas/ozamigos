using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace Ozamigos.Som;

/// <summary>
/// OzamigosSom.exe --contadores
///
/// Para o teste de desempenho: a cada segundo, uma linha JSON na saída padrão com o uso do processador
/// (o PC inteiro) e de cada motor da placa de vídeo (3D, codificação e decodificação de vídeo, cópia),
/// no total e por processo. São os mesmos contadores do Gerenciador de Tarefas, lidos pelo nome em
/// inglês (PdhAddEnglishCounter), que funciona em Windows de qualquer idioma. Só lê; não muda nada.
/// Termina quando o app fecha a entrada padrão.
/// </summary>
static partial class Contadores
{
    const uint PDH_FMT_DOUBLE = 0x00000200;
    const uint PDH_FMT_NOCAP100 = 0x00008000;
    const int PDH_MORE_DATA = unchecked((int)0x800007D2);

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern int PdhOpenQueryW(string? fonte, IntPtr usuario, out IntPtr consulta);

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern int PdhAddEnglishCounterW(IntPtr consulta, string caminho, IntPtr usuario, out IntPtr contador);

    [DllImport("pdh.dll")]
    static extern int PdhCollectQueryData(IntPtr consulta);

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern int PdhGetFormattedCounterArrayW(IntPtr contador, uint formato, ref uint tamanho, out uint quantidade, IntPtr itens);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ItemFormatado
    {
        public IntPtr Nome;
        public uint Estado;
        public double Valor;
    }

    // "pid_1234_luid_0x00000000_0x0000D1F2_phys_0_eng_3_engtype_VideoEncode"
    [GeneratedRegex(@"^pid_(\d+)_luid_(\w+)_(\w+)_phys_(\d+)_eng_(\d+)_engtype_(.+)$")]
    private static partial Regex NomeDoMotor();

    public static int Rodar()
    {
        if (PdhOpenQueryW(null, IntPtr.Zero, out var consulta) != 0) return Falhar("sem-pdh");
        if (PdhAddEnglishCounterW(consulta, @"\Processor(_Total)\% Processor Time", IntPtr.Zero, out var processador) != 0) return Falhar("sem-processador");
        bool temPlaca = PdhAddEnglishCounterW(consulta, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out var motores) == 0;
        bool temMemoria = PdhAddEnglishCounterW(consulta, @"\GPU Adapter Memory(*)\Dedicated Usage", IntPtr.Zero, out var memoria) == 0;

        var fim = new ManualResetEventSlim();
        new Thread(() =>
        {
            try
            {
                Console.OpenStandardInput().CopyTo(Stream.Null);
            }
            catch (IOException)
            {
                // cano quebrado também é fim
            }
            fim.Set();
        }) { IsBackground = true }.Start();

        PdhCollectQueryData(consulta); // os contadores de taxa precisam de duas coletas
        Console.Error.WriteLine("pronto");
        var saida = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        while (!fim.Wait(1000))
        {
            if (PdhCollectQueryData(consulta) != 0) continue;
            var json = new StringBuilder("{");
            var cpu = Ler(processador).FirstOrDefault().Valor;
            json.Append("\"cpu\":").Append(Numero(cpu));
            if (temPlaca) AnexarMotores(json, Ler(motores));
            if (temMemoria)
            {
                var maior = Ler(memoria).Select((item) => item.Valor).DefaultIfEmpty(0).Max();
                json.Append(",\"memoriaDaPlacaMB\":").Append(Numero(maior / 1048576));
            }
            json.Append('}');
            saida.WriteLine(json.ToString());
        }
        return 0;
    }

    /// <summary>
    /// "motores": o uso de cada tipo de motor, como no Gerenciador de Tarefas (a soma dos processos em cada
    /// motor, e o motor mais ocupado de cada tipo). "porProcesso": quanto cada processo usa de cada tipo.
    /// </summary>
    static void AnexarMotores(StringBuilder json, List<(string Nome, double Valor)> itens)
    {
        var porMotor = new Dictionary<(string Placa, string Motor, string Tipo), double>();
        var porProcesso = new Dictionary<string, Dictionary<string, double>>();
        foreach (var (nome, valor) in itens)
        {
            var partes = NomeDoMotor().Match(nome);
            if (!partes.Success) continue;
            var pid = partes.Groups[1].Value;
            var tipo = partes.Groups[6].Value;
            var motor = (partes.Groups[2].Value + partes.Groups[3].Value, partes.Groups[5].Value, tipo);
            porMotor[motor] = porMotor.GetValueOrDefault(motor) + valor;
            if (valor < 0.05) continue;
            if (!porProcesso.TryGetValue(pid, out var tipos)) porProcesso[pid] = tipos = [];
            tipos[tipo] = tipos.GetValueOrDefault(tipo) + valor;
        }
        json.Append(",\"motores\":{");
        json.Append(string.Join(",", porMotor.GroupBy((m) => m.Key.Tipo).Select((g) => $"\"{Texto(g.Key)}\":{Numero(Math.Min(100, g.Max((m) => m.Value)))}")));
        json.Append("},\"porProcesso\":{");
        json.Append(string.Join(",", porProcesso.Select((p) =>
            $"\"{p.Key}\":{{{string.Join(",", p.Value.Select((t) => $"\"{Texto(t.Key)}\":{Numero(t.Value)}"))}}}")));
        json.Append('}');
    }

    static List<(string Nome, double Valor)> Ler(IntPtr contador)
    {
        var resultado = new List<(string, double)>();
        uint tamanho = 0;
        int codigo = PdhGetFormattedCounterArrayW(contador, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref tamanho, out _, IntPtr.Zero);
        if (codigo != PDH_MORE_DATA || tamanho == 0) return resultado;
        var memoria = Marshal.AllocHGlobal((int)tamanho);
        try
        {
            if (PdhGetFormattedCounterArrayW(contador, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref tamanho, out var quantidade, memoria) != 0) return resultado;
            int passo = Marshal.SizeOf<ItemFormatado>();
            for (int i = 0; i < quantidade; i++)
            {
                var item = Marshal.PtrToStructure<ItemFormatado>(memoria + i * passo);
                if (item.Estado != 0) continue; // PDH_CSTATUS_VALID_DATA / NEW_DATA = 0
                resultado.Add((Marshal.PtrToStringUni(item.Nome) ?? "", item.Valor));
            }
        }
        finally
        {
            Marshal.FreeHGlobal(memoria);
        }
        return resultado;
    }

    static string Numero(double valor) => Math.Round(valor, 1).ToString(CultureInfo.InvariantCulture);

    static string Texto(string valor) => valor.Replace("\\", "").Replace("\"", "");

    static int Falhar(string motivo)
    {
        Console.Error.WriteLine(motivo);
        return 4;
    }
}
