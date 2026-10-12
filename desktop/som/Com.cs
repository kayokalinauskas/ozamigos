using System.Runtime.InteropServices;

namespace Ozamigos.Som;

/// <summary>
/// O mínimo de COM para falar com o áudio do Windows. As interfaces são chamadas direto pela
/// tabela de métodos (vtable), por índice: assim o .exe pode ser enxugado (trimmed) sem quebrar.
/// Os índices seguem a ordem dos métodos nos cabeçalhos do Windows (mmdeviceapi.h, audioclient.h,
/// audiopolicy.h); 0, 1 e 2 são sempre QueryInterface, AddRef e Release.
/// </summary>
static unsafe class Com
{
    public static readonly Guid IID_IUnknown = new("00000000-0000-0000-C000-000000000046");
    public static readonly Guid IID_IAgileObject = new("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90");
    public static readonly Guid IID_IActivateAudioInterfaceCompletionHandler = new("41D949AB-9862-444A-80F6-C261334DA5EB");
    public static readonly Guid IID_IAudioClient = new("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
    public static readonly Guid IID_IAudioCaptureClient = new("C8ADBD64-E71E-48A0-A4DE-185C395CD317");
    public static readonly Guid CLSID_MMDeviceEnumerator = new("BCDE0395-E52F-467C-8E3D-C4579291692E");
    public static readonly Guid IID_IMMDeviceEnumerator = new("A95664D2-9614-4F35-A746-DE8DB63617E6");
    public static readonly Guid IID_IAudioSessionManager2 = new("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    public static readonly Guid IID_IAudioSessionControl2 = new("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D");

    public const uint CLSCTX_ALL = 23;

    [DllImport("ole32.dll")]
    static extern int CoInitializeEx(IntPtr reservado, uint modelo);

    [DllImport("ole32.dll")]
    public static extern int CoCreateInstance(in Guid clsid, IntPtr externo, uint contexto, in Guid iid, out IntPtr objeto);

    /// <summary>Cada thread que usa COM precisa se registrar; MTA = sem dono, qualquer thread chama.</summary>
    public static void IniciarThread() => CoInitializeEx(IntPtr.Zero, 0);

    public static void* Metodo(IntPtr objeto, int indice) => (*(void***)objeto)[indice];

    public static int QueryInterface(IntPtr objeto, Guid iid, out IntPtr resultado)
    {
        IntPtr r;
        int hr = ((delegate* unmanaged[Stdcall]<IntPtr, Guid*, IntPtr*, int>)Metodo(objeto, 0))(objeto, &iid, &r);
        resultado = r;
        return hr;
    }

    public static void Release(IntPtr objeto)
    {
        if (objeto != IntPtr.Zero) ((delegate* unmanaged[Stdcall]<IntPtr, uint>)Metodo(objeto, 2))(objeto);
    }

    public static void Checar(int hr, string onde)
    {
        if (hr < 0) throw new COMException($"{onde} falhou (0x{hr:X8})", hr);
    }
}
