using System.Runtime.InteropServices;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace Ozamigos.Captura;

/// <summary>
/// A captura do Windows (Windows Graphics Capture) de uma janela ou de uma tela, sem a projeção WinRT do .NET (que
/// pesaria ~20 MB no .exe): as interfaces são chamadas pelo índice da vtable, como os outros COM do app. 0–2 são as do
/// IUnknown e 3–5 as do IInspectable; os métodos de cada interface vêm depois, na ordem do windows.graphics.capture.idl
/// (conferidos, com os IIDs, no C:\Windows\System32\WinMetadata\Windows.Graphics.winmd em 17/10/2026).
/// Ao acrescentar uma chamada, confira o índice no .idl.
/// </summary>
sealed unsafe class Wgc : IDisposable
{
    static readonly Guid IidItem = new("79c3f95b-31f7-4ec2-a464-632ef5d30760"); // IGraphicsCaptureItem
    static readonly Guid IidInteropDoItem = new("3628e81b-3cac-4c60-b7f4-23ce0e0c3356"); // IGraphicsCaptureItemInterop
    static readonly Guid IidEstaticosDoPool2 = new("589b103f-6bbc-5df5-a991-02e28b3b66d5"); // IDirect3D11CaptureFramePoolStatics2
    static readonly Guid IidSessao2 = new("2c39ae40-7d2e-5044-804e-8b6799d4cf9e"); // IGraphicsCaptureSession2 (o cursor)
    static readonly Guid IidSessao3 = new("f2cdd966-22ae-5ea1-9596-3a289344c3be"); // IGraphicsCaptureSession3 (a borda amarela)
    static readonly Guid IidSessao5 = new("67c0ea62-1f85-5061-925a-239be0ac09cb"); // IGraphicsCaptureSession5 (o intervalo mínimo)
    static readonly Guid IidDispositivoWinRt = new("a37624ab-8d5f-4650-9d3e-9eae3d9bc670"); // IDirect3DDevice
    static readonly Guid IidAcessoDxgi = new("a9b3d012-3df2-4ee3-b8d1-8695f457d3c1"); // IDirect3DDxgiInterfaceAccess
    static readonly Guid IidFechavel = new("30d5a829-7fa4-4026-83bb-d75bae4ea99e"); // IClosable
    static readonly Guid IidTextura = new("6f15aaf2-d208-4e89-9ab4-489535d34f9c"); // ID3D11Texture2D
    const int BGRA8 = 87; // DirectXPixelFormat.B8G8R8A8UIntNormalized
    // Três: um com o programa (esperando a vez de ser enviado), e dois para o Windows escrever os seguintes.
    const int BUFFERS = 3;

    [StructLayout(LayoutKind.Sequential)]
    public struct Tamanho { public int Largura, Altura; }

    [StructLayout(LayoutKind.Sequential)]
    struct Ponto { public int X, Y; }

    [DllImport("combase.dll")] static extern int RoInitialize(int tipo);
    [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr classe, in Guid iid, out IntPtr fabrica);
    [DllImport("combase.dll", CharSet = CharSet.Unicode)] static extern int WindowsCreateString(string texto, int tamanho, out IntPtr hstring);
    [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr hstring);
    [DllImport("d3d11.dll")] static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dispositivoDxgi, out IntPtr dispositivo);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Ponto ponto, uint opcoes);

    IntPtr item, pool, sessao, dispositivoWinRt;
    Tamanho tamanhoDoPool;

    /// <summary>
    /// janela: o HWND; ou, sem janela, a tela que contém o ponto (em pixels de verdade, não em DIP). fps: o pedido, para
    /// o intervalo mínimo entre quadros do Windows.
    /// </summary>
    public Wgc(ID3D11Device dispositivo, IntPtr janela, int x, int y, int fps)
    {
        RoInitialize(1); // multithread; já iniciado responde S_FALSE
        IntPtr interop = Fabrica("Windows.Graphics.Capture.GraphicsCaptureItem", IidInteropDoItem);
        try
        {
            Guid iid = IidItem;
            IntPtr resultado;
            int r = janela != IntPtr.Zero
                ? ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, Guid*, IntPtr*, int>)Vtable(interop, 3))(interop, janela, &iid, &resultado) // CreateForWindow
                : ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, Guid*, IntPtr*, int>)Vtable(interop, 4))(interop, MonitorFromPoint(new Ponto { X = x, Y = y }, 1), &iid, &resultado); // CreateForMonitor
            Conferir(r, janela != IntPtr.Zero ? "CreateForWindow" : "CreateForMonitor");
            item = resultado;
        }
        finally
        {
            Marshal.Release(interop);
        }

        IntPtr inspecionavel;
        using (var dxgi = dispositivo.QueryInterface<IDXGIDevice>())
            Conferir(CreateDirect3D11DeviceFromDXGIDevice(dxgi.NativePointer, out inspecionavel), "CreateDirect3D11DeviceFromDXGIDevice");
        Conferir(Marshal.QueryInterface(inspecionavel, in IidDispositivoWinRt, out dispositivoWinRt), "IDirect3DDevice");
        Marshal.Release(inspecionavel);

        Tamanho tamanho;
        Conferir(((delegate* unmanaged[Stdcall]<IntPtr, Tamanho*, int>)Vtable(item, 7))(item, &tamanho), "get_Size");
        tamanhoDoPool = tamanho;
        // Free-threaded: os quadros ficam esperando no pool, e este programa os pega no ritmo dele (sem fila de mensagens).
        IntPtr estaticos = Fabrica("Windows.Graphics.Capture.Direct3D11CaptureFramePool", IidEstaticosDoPool2);
        try
        {
            IntPtr resultado;
            Conferir(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int, int, Tamanho, IntPtr*, int>)Vtable(estaticos, 6))(
                estaticos, dispositivoWinRt, BGRA8, BUFFERS, tamanho, &resultado), "CreateFreeThreaded");
            pool = resultado;
        }
        finally
        {
            Marshal.Release(estaticos);
        }
        IntPtr s;
        Conferir(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, IntPtr*, int>)Vtable(pool, 10))(pool, item, &s), "CreateCaptureSession");
        sessao = s;
        // O cursor vai junto (a duplicação da tela não o trazia). Sem a borda amarela em volta do que é capturado, onde o
        // Windows deixa (11 em diante): quem joga a veria o tempo todo. Um Windows que recusa só fica com a borda.
        Ajustar(IidSessao2, 7, 1); // put_IsCursorCaptureEnabled
        BordaTirada = Ajustar(IidSessao3, 7, 0) == 0; // put_IsBorderRequired
        // O Windows entrega no máximo um quadro a cada 1/60 s, arredondado para os quadros da tela: num monitor de 155 Hz,
        // um a cada três, 52 por segundo (medido: uma janela a 156 fps chegava a 52, e a captura a 60 fps também). Com
        // metade do intervalo pedido, sobra folga para o laço escolher sem copiar cada quadro da tela à toa. O Windows
        // 11 24H2 em diante; antes, fica o padrão (put_MinUpdateInterval, um TimeSpan em unidades de 100 ns).
        IntervaloMinimo = AjustarIntervalo(10_000_000L / fps / 2) == 0;
        Conferir(((delegate* unmanaged[Stdcall]<IntPtr, int>)Vtable(sessao, 6))(sessao), "StartCapture");
    }

    public bool BordaTirada { get; }
    public bool IntervaloMinimo { get; }

    int AjustarIntervalo(long cemNanossegundos)
    {
        if (Marshal.QueryInterface(sessao, in IidSessao5, out IntPtr versao) != 0) return -1;
        try
        {
            return ((delegate* unmanaged[Stdcall]<IntPtr, long, int>)Vtable(versao, 7))(versao, cemNanossegundos);
        }
        finally
        {
            Marshal.Release(versao);
        }
    }

    /// <summary>
    /// O quadro mais novo que chegou desde a última vez (os anteriores são descartados), ou null. O chamador precisa
    /// chamar <see cref="Fechar"/> no quadro. conteudo: o tamanho da imagem dentro da textura.
    /// (O SystemRelativeTime do quadro não serve de hora da captura: fica uns ms no futuro, é quando a tela vai mostrá-lo.)
    /// </summary>
    public IntPtr MaisNovo(out ID3D11Texture2D? textura, out Tamanho conteudo)
    {
        textura = null;
        conteudo = default;
        IntPtr ultimo = IntPtr.Zero;
        while (true)
        {
            IntPtr quadro;
            if (((delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)Vtable(pool, 7))(pool, &quadro) != 0 || quadro == IntPtr.Zero) break; // TryGetNextFrame
            if (ultimo != IntPtr.Zero) Fechar(ultimo);
            ultimo = quadro;
        }
        if (ultimo == IntPtr.Zero) return IntPtr.Zero;

        Tamanho c;
        ((delegate* unmanaged[Stdcall]<IntPtr, Tamanho*, int>)Vtable(ultimo, 8))(ultimo, &c); // get_ContentSize
        conteudo = c;
        IntPtr superficie;
        if (((delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)Vtable(ultimo, 6))(ultimo, &superficie) != 0) // get_Surface
        {
            Fechar(ultimo);
            return IntPtr.Zero;
        }
        try
        {
            if (Marshal.QueryInterface(superficie, in IidAcessoDxgi, out IntPtr acesso) != 0) { Fechar(ultimo); return IntPtr.Zero; }
            Guid iid = IidTextura;
            IntPtr ponteiro;
            int r = ((delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)Vtable(acesso, 3))(acesso, &iid, &ponteiro); // GetInterface
            Marshal.Release(acesso);
            if (r != 0) { Fechar(ultimo); return IntPtr.Zero; }
            textura = new ID3D11Texture2D(ponteiro);
        }
        finally
        {
            Marshal.Release(superficie);
        }

        // A janela mudou de tamanho: o pool passa a ter o tamanho novo (até lá, a imagem vem cortada ou com sobra).
        if (c.Largura > 0 && c.Altura > 0 && (c.Largura != tamanhoDoPool.Largura || c.Altura != tamanhoDoPool.Altura))
        {
            tamanhoDoPool = c;
            ((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int, int, Tamanho, int>)Vtable(pool, 6))(pool, dispositivoWinRt, BGRA8, BUFFERS, c); // Recreate
        }
        return ultimo;
    }

    /// <summary>Devolve o quadro ao pool (IClosable.Close) e solta a referência.</summary>
    public static void Fechar(IntPtr objeto)
    {
        if (Marshal.QueryInterface(objeto, in IidFechavel, out IntPtr fechavel) == 0)
        {
            ((delegate* unmanaged[Stdcall]<IntPtr, int>)Vtable(fechavel, 6))(fechavel);
            Marshal.Release(fechavel);
        }
        Marshal.Release(objeto);
    }

    public void Dispose()
    {
        if (sessao != IntPtr.Zero) Fechar(sessao);
        if (pool != IntPtr.Zero) Fechar(pool);
        if (item != IntPtr.Zero) Marshal.Release(item);
        if (dispositivoWinRt != IntPtr.Zero) Marshal.Release(dispositivoWinRt);
        sessao = pool = item = dispositivoWinRt = IntPtr.Zero;
    }

    /// <summary>Um "put" de booleano numa versão nova da sessão. Devolve o HRESULT (o Windows antigo não tem a interface).</summary>
    int Ajustar(Guid interfaceDaSessao, int indice, byte valor)
    {
        if (Marshal.QueryInterface(sessao, in interfaceDaSessao, out IntPtr versao) != 0) return -1;
        try
        {
            return ((delegate* unmanaged[Stdcall]<IntPtr, byte, int>)Vtable(versao, indice))(versao, valor);
        }
        finally
        {
            Marshal.Release(versao);
        }
    }

    static IntPtr Vtable(IntPtr objeto, int indice) => (*(IntPtr**)objeto)[indice];

    static IntPtr Fabrica(string classe, Guid iid)
    {
        Conferir(WindowsCreateString(classe, classe.Length, out IntPtr nome), "WindowsCreateString");
        try
        {
            Conferir(RoGetActivationFactory(nome, in iid, out IntPtr fabrica), $"RoGetActivationFactory({classe})");
            return fabrica;
        }
        finally
        {
            WindowsDeleteString(nome);
        }
    }

    static void Conferir(int hresult, string onde)
    {
        if (hresult < 0) throw new InvalidOperationException($"{onde} falhou: 0x{hresult:x8}");
    }
}
