using System.Collections.Concurrent;
using System.Diagnostics;

namespace Ozamigos.Captura;

/// <summary>
/// Escreve os quadros na saída padrão numa thread própria. Escrever é o mais lento do caminho (~6 ms por quadro 720p:
/// o cano só esvazia quando o app lê), e o laço da captura ficava parado esperando; em 1080p a 60 fps, isso tomaria
/// quase todo o tempo dele. A fila tem dois quadros: com o app atrasado, o quadro que não cabe fica de fora (o atraso
/// não cresce) e conta em <see cref="Descartados"/>.
/// </summary>
sealed class Saida : IDisposable
{
    readonly Stream saida = Console.OpenStandardOutput();
    readonly BlockingCollection<byte[]> fila = new(boundedCapacity: 2);
    readonly ConcurrentBag<byte[]> livres = new();
    readonly Thread escritor;
    long somaDaEscrita, escritos, descartados;

    public Saida()
    {
        escritor = new Thread(Escrever) { IsBackground = true, Name = "saida", Priority = ThreadPriority.AboveNormal };
        escritor.Start();
    }

    /// <summary>O app fechou a saída (fechou ou parou a transmissão).</summary>
    public bool Fechada { get; private set; }

    /// <summary>Total de ticks gastos escrevendo, de quadros escritos e de quadros que ficaram de fora.</summary>
    public (long ticks, long escritos, long descartados) Medidas =>
        (Interlocked.Read(ref somaDaEscrita), Interlocked.Read(ref escritos), Interlocked.Read(ref descartados));

    /// <summary>Põe uma cópia do quadro na fila (o original continua com o chamador). Nunca espera.</summary>
    public void Mandar(byte[] quadro)
    {
        byte[]? copia = null;
        while (livres.TryTake(out var livre))
        {
            if (livre.Length == quadro.Length)
            {
                copia = livre;
                break;
            }
        }
        copia ??= new byte[quadro.Length]; // tamanho novo (a janela mudou): os de antes ficam para o coletor de lixo
        Buffer.BlockCopy(quadro, 0, copia, 0, quadro.Length);
        if (!fila.TryAdd(copia))
        {
            livres.Add(copia);
            Interlocked.Increment(ref descartados);
        }
    }

    void Escrever()
    {
        foreach (var quadro in fila.GetConsumingEnumerable())
        {
            long inicio = Stopwatch.GetTimestamp();
            try
            {
                saida.Write(quadro);
                saida.Flush();
            }
            catch (IOException)
            {
                Fechada = true;
                return;
            }
            Interlocked.Add(ref somaDaEscrita, Stopwatch.GetTimestamp() - inicio);
            Interlocked.Increment(ref escritos);
            livres.Add(quadro);
        }
    }

    public void Dispose()
    {
        fila.CompleteAdding();
        escritor.Join(500);
    }
}
