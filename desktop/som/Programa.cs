namespace Ozamigos.Som;

/// <summary>
/// OzamigosSom.exe --excluir-pid 1234 --excluir-nome Discord.exe,DiscordPTB.exe
///
/// Captura o som de todos os programas, menos os excluídos (e os filhos deles), e escreve a
/// mistura na saída padrão. O app para Windows liga este programa sozinho, escondido, quando
/// alguém transmite com som; quando o app fecha a entrada padrão, ele termina.
/// Na saída de erro: "pronto" quando começou, "sem-suporte" se o Windows for antigo demais.
/// </summary>
static class Programa
{
    static int Main(string[] argumentos)
    {
        if (argumentos.Contains("--contadores")) return Contadores.Rodar(); // teste de desempenho (veja Contadores.cs)
        if (argumentos.Contains("--relogio")) return Relogio.Rodar(argumentos); // captura sem cair para ~21 fps (veja Relogio.cs)

        var pidsExcluidos = new HashSet<uint> { (uint)Environment.ProcessId };
        var nomesExcluidos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < argumentos.Length - 1; i++)
        {
            if (argumentos[i] == "--excluir-pid" && uint.TryParse(argumentos[i + 1], out var pid)) pidsExcluidos.Add(pid);
            if (argumentos[i] == "--excluir-nome") nomesExcluidos.UnionWith(argumentos[i + 1].Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries));
        }

        Com.IniciarThread();
        // Teste rápido: o Windows sabe capturar por processo? (Windows 10 2004+ e Windows 11)
        var teste = Ativacao.Ativar((uint)Environment.ProcessId, incluir: false, out int erro);
        if (teste == IntPtr.Zero)
        {
            Console.Error.WriteLine($"sem-suporte 0x{erro:X8}");
            return 3;
        }
        Com.Release(teste);

        var fim = new ManualResetEventSlim();
        // Entrada padrão fechada = o app fechou (ou travou): termina junto.
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

        var misturador = new Misturador();
        var gerente = new Gerente(misturador, pidsExcluidos, nomesExcluidos);
        gerente.Atualizar();
        misturador.Iniciar(Console.OpenStandardOutput(), fim);
        Console.Error.WriteLine("pronto");
        while (!fim.Wait(2000)) gerente.Atualizar();
        gerente.Encerrar();
        return 0;
    }
}
