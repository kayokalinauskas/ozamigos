using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Ozamigos.Som;

/// <summary>
/// A cada 10 ms, soma o que chegou de cada captura e escreve na saída padrão:
/// 480 quadros de float32 estéreo intercalado (48 kHz). Sem nada tocando, sai silêncio,
/// e a faixa de áudio da transmissão continua viva.
/// </summary>
sealed class Misturador
{
    const int TaxaDeAmostragem = 48000;
    const int QuadrosPorBloco = 480;

    [DllImport("winmm.dll")]
    static extern uint timeBeginPeriod(uint milissegundos);

    volatile Captura[] capturas = [];

    public void Definir(Captura[] novas) => capturas = novas;

    public void Iniciar(Stream saida, ManualResetEventSlim fim)
    {
        new Thread(() => Rodar(saida, fim)) { IsBackground = true, Name = "misturador", Priority = ThreadPriority.AboveNormal }.Start();
    }

    void Rodar(Stream saida, ManualResetEventSlim fim)
    {
        timeBeginPeriod(1); // Thread.Sleep com precisão de 1 ms
        var mistura = new float[QuadrosPorBloco * 2];
        var bytes = new byte[mistura.Length * sizeof(float)];
        var relogio = Stopwatch.StartNew();
        long enviados = 0;
        while (!fim.IsSet)
        {
            long devidos = (long)(relogio.Elapsed.TotalSeconds * TaxaDeAmostragem);
            if (devidos - enviados > TaxaDeAmostragem / 5) enviados = devidos - QuadrosPorBloco; // ficou para trás (PC suspenso): pula
            while (enviados + QuadrosPorBloco <= devidos)
            {
                Array.Clear(mistura);
                foreach (var captura in capturas) captura.Anel.Misturar(mistura);
                for (int i = 0; i < mistura.Length; i++) mistura[i] = Math.Clamp(mistura[i], -1f, 1f);
                Buffer.BlockCopy(mistura, 0, bytes, 0, bytes.Length);
                try
                {
                    saida.Write(bytes);
                    saida.Flush();
                }
                catch (IOException)
                {
                    fim.Set(); // o app fechou o cano: acabou
                    return;
                }
                enviados += QuadrosPorBloco;
            }
            Thread.Sleep(1);
        }
    }
}
