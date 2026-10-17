using System.Runtime.InteropServices;

namespace Ozamigos.Som;

/// <summary>
/// OzamigosSom.exe --atalhos
///
/// Os atalhos globais do app (mudo, som desligado, apertar para falar), com o jogo na frente. Lê na entrada padrão
/// uma linha por configuração, "mudo=17,16,77 surdo=17,16,68 falar=5" (as teclas virtuais do Windows de cada
/// atalho; vazio desliga), e escreve na saída padrão "mudo", "surdo", "falar 1" e "falar 0".
///
/// Pergunta ao Windows o estado das teclas (GetAsyncKeyState) a cada ~10 ms, em vez de registrar o atalho: o
/// RegisterHotKey (e o globalShortcut do Electron) toma a tecla para si, e o jogo deixaria de recebê-la; e não conta
/// quando a tecla é solta, o que o "apertar para falar" precisa. Também lê os botões laterais do mouse.
/// Entrada padrão fechada = o app fechou: termina junto.
/// </summary>
static class Atalhos
{
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int tecla);

    [DllImport("winmm.dll")]
    static extern uint timeBeginPeriod(uint periodo);

    const int MAXIMO_DE_TECLAS = 4;
    static readonly string[] NOMES = ["mudo", "surdo", "falar"];

    public static int Rodar()
    {
        var atalhos = new Dictionary<string, int[]>();
        var trava = new object();
        var fim = new ManualResetEventSlim();
        new Thread(() =>
        {
            try
            {
                string? linha;
                while ((linha = Console.In.ReadLine()) != null)
                {
                    var novos = Ler(linha);
                    lock (trava) atalhos = novos;
                }
            }
            catch (IOException)
            {
                // cano quebrado também é fim
            }
            fim.Set();
        }) { IsBackground = true }.Start();

        timeBeginPeriod(1); // sem isso, o Sleep(10) dormiria 15,6 ms
        var saida = Console.Out;
        var apertados = new Dictionary<string, bool>();
        Console.Error.WriteLine("pronto");
        while (!fim.Wait(10))
        {
            Dictionary<string, int[]> agora;
            lock (trava) agora = atalhos;
            foreach (var nome in NOMES)
            {
                bool antes = apertados.GetValueOrDefault(nome);
                bool apertado = agora.TryGetValue(nome, out var teclas) && teclas.Length > 0 && teclas.All(Apertada);
                if (apertado == antes) continue;
                apertados[nome] = apertado;
                // Mudo e som desligado trocam ao apertar; apertar para falar conta também quando solta.
                if (nome == "falar") saida.WriteLine(apertado ? "falar 1" : "falar 0");
                else if (apertado) saida.WriteLine(nome);
                saida.Flush();
            }
        }
        return 0;
    }

    static bool Apertada(int tecla) => (GetAsyncKeyState(tecla) & 0x8000) != 0;

    /// <summary>"mudo=17,16,77 falar=5": o que não for um atalho conhecido, com 1 a 4 teclas de 1 a 254, fica de fora.</summary>
    static Dictionary<string, int[]> Ler(string linha)
    {
        var atalhos = new Dictionary<string, int[]>();
        foreach (var parte in linha.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var pedacos = parte.Split('=', 2);
            if (pedacos.Length != 2 || !NOMES.Contains(pedacos[0])) continue;
            var teclas = new List<int>();
            foreach (var texto in pedacos[1].Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                if (int.TryParse(texto, out var tecla) && tecla is >= 1 and <= 254) teclas.Add(tecla);
            }
            if (teclas.Count is > 0 and <= MAXIMO_DE_TECLAS) atalhos[pedacos[0]] = [.. teclas];
        }
        return atalhos;
    }
}
