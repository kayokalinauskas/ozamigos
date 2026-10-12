using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace Ozamigos.Som;

/// <summary>
/// Abre a captura do som de um processo (e dos filhos dele) com ActivateAudioInterfaceAsync,
/// o recurso de "loopback de processo" do Windows 10 2004+ e do Windows 11.
/// A função é assíncrona: o Windows chama de volta um objeto COM nosso quando termina.
/// </summary>
static unsafe class Ativacao
{
    const string DispositivoDeLoopbackDeProcesso = "VAD\\Process_Loopback";

    [DllImport("Mmdevapi.dll", ExactSpelling = true)]
    static extern int ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string caminho, in Guid iid, IntPtr parametros, IntPtr aoTerminar, out IntPtr operacao);

    sealed class Pedido
    {
        public readonly ManualResetEventSlim Pronto = new();
        public IntPtr Cliente;
        public int Erro;
    }

    // O objeto COM que recebe o "terminou": [ponteiro da tabela][GCHandle do Pedido].
    // A tabela tem QueryInterface, AddRef, Release e ActivateCompleted, nessa ordem.
    static readonly IntPtr* Tabela = CriarTabela();

    static IntPtr* CriarTabela()
    {
        var tabela = (IntPtr*)NativeMemory.Alloc((nuint)(4 * sizeof(IntPtr)));
        tabela[0] = (IntPtr)(delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)&QueryInterface;
        tabela[1] = (IntPtr)(delegate* unmanaged[Stdcall]<IntPtr, uint>)&AddRef;
        tabela[2] = (IntPtr)(delegate* unmanaged[Stdcall]<IntPtr, uint>)&Release;
        tabela[3] = (IntPtr)(delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int>)&AoTerminar;
        return tabela;
    }

    // IAgileObject avisa o Windows que pode nos chamar de qualquer thread.
    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    static int QueryInterface(IntPtr eu, Guid* iid, IntPtr* resultado)
    {
        if (*iid == Com.IID_IUnknown || *iid == Com.IID_IActivateAudioInterfaceCompletionHandler || *iid == Com.IID_IAgileObject)
        {
            *resultado = eu;
            return 0;
        }
        *resultado = IntPtr.Zero;
        return unchecked((int)0x80004002); // E_NOINTERFACE
    }

    // A memória do objeto nunca é liberada (são 16 bytes por captura aberta): assim o Windows
    // pode soltá-lo quando quiser, sem risco de chamar memória já devolvida.
    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    static uint AddRef(IntPtr eu) => 1;

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    static uint Release(IntPtr eu) => 1;

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    static int AoTerminar(IntPtr eu, IntPtr operacao)
    {
        try
        {
            var pedido = (Pedido)GCHandle.FromIntPtr(((IntPtr*)eu)[1]).Target!;
            int hrDaAtivacao;
            IntPtr ativada;
            // IActivateAudioInterfaceAsyncOperation::GetActivateResult
            int hr = ((delegate* unmanaged[Stdcall]<IntPtr, int*, IntPtr*, int>)Com.Metodo(operacao, 3))(operacao, &hrDaAtivacao, &ativada);
            if (hr >= 0 && hrDaAtivacao >= 0 && ativada != IntPtr.Zero)
            {
                if (Com.QueryInterface(ativada, Com.IID_IAudioClient, out var cliente) >= 0) pedido.Cliente = cliente;
                Com.Release(ativada);
            }
            pedido.Erro = hr < 0 ? hr : hrDaAtivacao;
            pedido.Pronto.Set();
        }
        catch
        {
            // nunca deixar exceção escapar para o Windows
        }
        return 0;
    }

    /// <summary>
    /// Devolve um IAudioClient que captura o som de <paramref name="pid"/> e dos filhos dele
    /// (incluir) ou de tudo, menos ele e os filhos (excluir). Zero se não deu.
    /// </summary>
    public static IntPtr Ativar(uint pid, bool incluir, out int erro)
    {
        // AUDIOCLIENT_ACTIVATION_PARAMS: tipo (1 = loopback de processo), processo alvo, modo (0 incluir, 1 excluir).
        var parametros = (int*)NativeMemory.AllocZeroed(12);
        parametros[0] = 1;
        parametros[1] = (int)pid;
        parametros[2] = incluir ? 0 : 1;
        // PROPVARIANT do tipo VT_BLOB (65) apontando para os parâmetros.
        var variante = (byte*)NativeMemory.AllocZeroed(24);
        *(ushort*)variante = 65;
        *(uint*)(variante + 8) = 12;
        *(IntPtr*)(variante + 16) = (IntPtr)parametros;

        var pedido = new Pedido();
        var alca = GCHandle.Alloc(pedido);
        var objeto = (IntPtr*)NativeMemory.Alloc((nuint)(2 * sizeof(IntPtr)));
        objeto[0] = (IntPtr)Tabela;
        objeto[1] = GCHandle.ToIntPtr(alca);

        int hr = ActivateAudioInterfaceAsync(DispositivoDeLoopbackDeProcesso, Com.IID_IAudioClient, (IntPtr)variante, (IntPtr)objeto, out var operacao);
        if (hr < 0)
        {
            alca.Free();
            NativeMemory.Free(variante);
            NativeMemory.Free(parametros);
            erro = hr;
            return IntPtr.Zero;
        }
        if (!pedido.Pronto.Wait(5000))
        {
            // O Windows ainda pode responder: a memória fica reservada para não quebrar quando ele responder.
            Com.Release(operacao);
            erro = unchecked((int)0x800705B4); // tempo esgotado
            return IntPtr.Zero;
        }
        Com.Release(operacao);
        alca.Free();
        NativeMemory.Free(variante);
        NativeMemory.Free(parametros);
        erro = pedido.Erro;
        return pedido.Cliente;
    }
}
