namespace Ozamigos.Som;

/// <summary>
/// Decide quais programas capturar. O Windows só sabe "incluir um programa e os filhos dele"
/// ou "excluir um programa e os filhos dele", um por vez. Para deixar de fora mais de um
/// (o Ozamigos e o Discord), capturamos, um a um, cada programa que está tocando som, menos os excluídos.
/// </summary>
sealed unsafe class Gerente
{
    const int SessaoExpirada = 2;

    readonly Misturador misturador;
    readonly HashSet<uint> pidsExcluidos;
    readonly HashSet<string> nomesExcluidos;
    readonly Dictionary<uint, Captura> capturas = [];
    readonly Dictionary<uint, DateTime> falhas = [];
    readonly IntPtr enumerador;

    public Gerente(Misturador misturador, HashSet<uint> pidsExcluidos, HashSet<string> nomesExcluidos)
    {
        this.misturador = misturador;
        this.pidsExcluidos = pidsExcluidos;
        this.nomesExcluidos = nomesExcluidos;
        Com.Checar(Com.CoCreateInstance(Com.CLSID_MMDeviceEnumerator, IntPtr.Zero, Com.CLSCTX_ALL, Com.IID_IMMDeviceEnumerator, out enumerador),
            "MMDeviceEnumerator");
    }

    /// <summary>Roda a cada 2 segundos: abre a captura de quem começou a tocar e fecha a de quem sumiu.</summary>
    public void Atualizar()
    {
        var processos = Processos.Listar();
        var filhos = new Dictionary<uint, List<uint>>();
        foreach (var processo in processos.Values)
        {
            if (!Processos.PaiDe(processos, processo.Pid, out uint pai)) continue;
            if (!filhos.TryGetValue(pai, out var lista)) filhos[pai] = lista = [];
            lista.Add(processo.Pid);
        }

        bool Excluido(uint pid) =>
            pidsExcluidos.Contains(pid) || (processos.TryGetValue(pid, out var p) && nomesExcluidos.Contains(p.Nome));

        IEnumerable<uint> Ancestrais(uint pid)
        {
            var vistos = new HashSet<uint> { pid };
            while (Processos.PaiDe(processos, pid, out uint pai) && vistos.Add(pai))
            {
                yield return pai;
                pid = pai;
            }
        }

        bool TemDescendenteExcluido(uint pid)
        {
            var fila = new Queue<uint>([pid]);
            var vistos = new HashSet<uint> { pid };
            while (fila.TryDequeue(out var atual))
            {
                if (!filhos.TryGetValue(atual, out var lista)) continue;
                foreach (var filho in lista)
                {
                    if (!vistos.Add(filho)) continue;
                    if (Excluido(filho)) return true;
                    fila.Enqueue(filho);
                }
            }
            return false;
        }

        // Capturar um programa leva junto os filhos dele. Então ficam de fora: os excluídos, os filhos
        // de excluídos e quem tem um excluído entre os descendentes (não dá para separar o som).
        var candidatos = PidsTocandoSom()
            .Where(pid => pid != 0 && processos.ContainsKey(pid))
            .Where(pid => !Excluido(pid) && !Ancestrais(pid).Any(Excluido) && !TemDescendenteExcluido(pid))
            .ToHashSet();
        // Se o pai já é capturado, o filho vem junto: capturar os dois dobraria o som.
        var alvo = candidatos.Where(pid => !Ancestrais(pid).Any(candidatos.Contains)).ToHashSet();

        foreach (var (pid, captura) in capturas.ToArray())
        {
            // Continua se o programa ainda toca som e é o mesmo (o Windows reaproveita números de processo).
            if (alvo.Contains(pid) && processos[pid].Criado == captura.Criado) continue;
            captura.Fechar();
            capturas.Remove(pid);
            Console.Error.WriteLine($"parou de capturar {captura.Nome} ({pid})");
        }
        foreach (var pid in falhas.Keys.Where(pid => !processos.ContainsKey(pid)).ToArray()) falhas.Remove(pid);
        foreach (var pid in alvo)
        {
            if (capturas.ContainsKey(pid)) continue;
            if (falhas.TryGetValue(pid, out var quando) && DateTime.UtcNow - quando < TimeSpan.FromSeconds(30)) continue;
            var nome = processos[pid].Nome;
            var captura = Captura.Abrir(pid, nome, processos[pid].Criado);
            if (captura is null)
            {
                falhas[pid] = DateTime.UtcNow;
                continue;
            }
            capturas[pid] = captura;
            Console.Error.WriteLine($"capturando {nome} ({pid})");
        }
        misturador.Definir([.. capturas.Values]);
    }

    public void Encerrar()
    {
        misturador.Definir([]);
        foreach (var captura in capturas.Values) captura.Fechar();
        capturas.Clear();
    }

    /// <summary>Os processos com uma sessão de áudio em qualquer saída de som ativa (caixa, fone, HDMI...).</summary>
    HashSet<uint> PidsTocandoSom()
    {
        var pids = new HashSet<uint>();
        IntPtr colecao;
        // IMMDeviceEnumerator::EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
        if (((delegate* unmanaged[Stdcall]<IntPtr, int, uint, IntPtr*, int>)Com.Metodo(enumerador, 3))(enumerador, 0, 1, &colecao) < 0) return pids;
        try
        {
            uint dispositivos;
            ((delegate* unmanaged[Stdcall]<IntPtr, uint*, int>)Com.Metodo(colecao, 3))(colecao, &dispositivos); // GetCount
            for (uint d = 0; d < dispositivos; d++)
            {
                IntPtr dispositivo;
                if (((delegate* unmanaged[Stdcall]<IntPtr, uint, IntPtr*, int>)Com.Metodo(colecao, 4))(colecao, d, &dispositivo) < 0) continue; // Item
                try
                {
                    SessoesDe(dispositivo, pids);
                }
                finally
                {
                    Com.Release(dispositivo);
                }
            }
        }
        finally
        {
            Com.Release(colecao);
        }
        return pids;
    }

    static void SessoesDe(IntPtr dispositivo, HashSet<uint> pids)
    {
        var iid = Com.IID_IAudioSessionManager2;
        IntPtr gerente;
        // IMMDevice::Activate(IAudioSessionManager2)
        if (((delegate* unmanaged[Stdcall]<IntPtr, Guid*, uint, IntPtr, IntPtr*, int>)Com.Metodo(dispositivo, 3))(
            dispositivo, &iid, Com.CLSCTX_ALL, IntPtr.Zero, &gerente) < 0) return;
        IntPtr sessoes = IntPtr.Zero;
        try
        {
            // IAudioSessionManager2::GetSessionEnumerator
            if (((delegate* unmanaged[Stdcall]<IntPtr, IntPtr*, int>)Com.Metodo(gerente, 5))(gerente, &sessoes) < 0) return;
            int total;
            ((delegate* unmanaged[Stdcall]<IntPtr, int*, int>)Com.Metodo(sessoes, 3))(sessoes, &total); // GetCount
            for (int i = 0; i < total; i++)
            {
                IntPtr controle;
                if (((delegate* unmanaged[Stdcall]<IntPtr, int, IntPtr*, int>)Com.Metodo(sessoes, 4))(sessoes, i, &controle) < 0) continue; // GetSession
                IntPtr controle2 = IntPtr.Zero;
                try
                {
                    int estado;
                    ((delegate* unmanaged[Stdcall]<IntPtr, int*, int>)Com.Metodo(controle, 3))(controle, &estado); // GetState
                    if (estado == SessaoExpirada || Com.QueryInterface(controle, Com.IID_IAudioSessionControl2, out controle2) < 0) continue;
                    uint pid;
                    // IAudioSessionControl2::GetProcessId
                    if (((delegate* unmanaged[Stdcall]<IntPtr, uint*, int>)Com.Metodo(controle2, 14))(controle2, &pid) >= 0) pids.Add(pid);
                }
                finally
                {
                    Com.Release(controle2);
                    Com.Release(controle);
                }
            }
        }
        finally
        {
            Com.Release(sessoes);
            Com.Release(gerente);
        }
    }
}
