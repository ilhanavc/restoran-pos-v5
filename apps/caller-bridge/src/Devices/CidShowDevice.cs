using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Extensions.Options;
using RestoranPos.CallerBridge.Configuration;
using RestoranPos.CallerBridge.Logging;

namespace RestoranPos.CallerBridge.Devices;

/// <summary>
/// Real CIDShow C812A device wrapper (ADR-016 §12 Amendment 3).
///
/// The vendor <c>cid.dll</c> exposes a SINGLE export — <c>SetEvents(callerIdCb, signalCb)</c>
/// (cdecl, BSTR strings) — and PUSHES each inbound call through the caller-id callback on its
/// own thread. There is NO polling API; the earlier cidOpen/cidIsRing/cidGetCallerNumber
/// surface was fabricated and would throw <c>EntryPointNotFoundException</c>. The signature
/// model mirrors the v3 StoreBridge helper that drove this same hardware (behavioural
/// reference, not copied).
///
/// Placement: <c>cid.dll</c> ships per-arch under <c>cidshow_x64\</c> / <c>cidshow_x86\</c>
/// next to the executable (vendor convention). Copy from the CIDShow SDK; not committed
/// (license/binary).
///
/// Doğrulanmamış: the cdecl/BSTR shape is inferred from vendor examples and is NOT yet
/// confirmed on physical hardware — the first real call is the true test. This class only
/// raises the RAW number; all normalize/filter/dedupe happen API-side (ADR-016 A2.4).
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class CidShowDevice : ICallerIdDevice
{
    private readonly ILogger<CidShowDevice> _logger;
    private readonly BridgeOptions _options;

    // Rooted for the service lifetime — the native side keeps these pointers and will call
    // into freed memory if the GC collects them mid-run.
    private CallerIdCallback? _callerIdHandler;
    private SignalCallback? _signalHandler;
    private SetEventsDelegate? _setEvents;
    private nint _libHandle;

    public CidShowDevice(ILogger<CidShowDevice> logger, IOptions<BridgeOptions> options)
    {
        _logger = logger;
        _options = options.Value;
    }

    public event EventHandler<IncomingCallEvent>? CallReceived;

    // ─── cid.dll interop (cdecl, BSTR) — mirrors the v3 StoreBridge signatures ─────────
    // The DLL pushes calls via these callbacks; we never poll.

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void CallerIdCallback(
        [MarshalAs(UnmanagedType.BStr)] string deviceSerial,
        [MarshalAs(UnmanagedType.BStr)] string line,
        [MarshalAs(UnmanagedType.BStr)] string phoneNumber,
        [MarshalAs(UnmanagedType.BStr)] string dateTime,
        [MarshalAs(UnmanagedType.BStr)] string other);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SignalCallback(
        [MarshalAs(UnmanagedType.BStr)] string deviceModel,
        [MarshalAs(UnmanagedType.BStr)] string deviceSerial,
        int signal1,
        int signal2,
        int signal3,
        int signal4);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SetEventsDelegate(CallerIdCallback callerIdEvent, SignalCallback signalEvent);

    // ──────────────────────────────────────────────────────────────────────────────────

    public Task StartAsync(CancellationToken ct)
    {
        var dllPath = ResolveDllPath();
        if (!File.Exists(dllPath))
        {
            throw new FileNotFoundException(
                $"cid.dll bulunamadı: {dllPath}. CIDShow SDK'dan cidshow_x64\\cid.dll (32-bit ise cidshow_x86\\cid.dll) servis klasörünün altına kopyalayın.");
        }

        _libHandle = NativeLibrary.Load(dllPath);
        var setEventsPtr = NativeLibrary.GetExport(_libHandle, "SetEvents");
        _setEvents = Marshal.GetDelegateForFunctionPointer<SetEventsDelegate>(setEventsPtr);

        // Assign to fields FIRST so the delegates stay rooted before the native side stores them.
        _callerIdHandler = OnCallerId;
        _signalHandler = OnSignal;
        _setEvents(_callerIdHandler, _signalHandler);

        _logger.LogInformation(
            "CidShowDevice registered SetEvents (dll={DllPath} linesConfigured={LineCount})",
            dllPath, _options.LineCount);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct)
    {
        if (_libHandle != 0)
        {
            NativeLibrary.Free(_libHandle);
            _libHandle = 0;
        }
        _setEvents = null;
        _callerIdHandler = null;
        _signalHandler = null;
        _logger.LogInformation("CidShowDevice closed");
        return Task.CompletedTask;
    }

    private static string ResolveDllPath()
    {
        var rel = Environment.Is64BitProcess ? "cidshow_x64\\cid.dll" : "cidshow_x86\\cid.dll";
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, rel));
    }

    // Fired by cid.dll on a native thread when a call arrives. MUST NOT throw into native code.
    private void OnCallerId(string deviceSerial, string line, string phoneNumber, string dateTime, string other)
    {
        try
        {
            var raw = phoneNumber?.Trim() ?? string.Empty;
            if (raw.Length == 0)
            {
                _logger.LogWarning("CidShow callback with empty phone (line={Line})", line);
                return;
            }

            var lineNo = int.TryParse(line, out var parsed) ? parsed : (int?)null;

            // Raw number → API (normalize/filter/dedupe are server-side, ADR-016 A2.4).
            // Log stays masked (KVKK — CLAUDE.md:125); the raw number leaves only via the HTTP body.
            _logger.LogInformation("Ring detected (phone={Masked} line={Line})", PhoneMasking.Mask(raw), lineNo);
            CallReceived?.Invoke(this, new IncomingCallEvent(raw, lineNo, DateTimeOffset.UtcNow));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "CidShow caller-id callback error (suppressed to protect the native caller)");
        }
    }

    // C12-B-01 — cid.dll'in gönderdiği ring/line/bağlantı sinyalleri (pilot'ta
    // No-op'tu → USB-durum görünmezdi). Loglanır: (a) C12-A-01 donanım smoke'unda
    // signal-semantiğini teyit için veri, (b) USB-durum değişimleri izlenebilir
    // (health görünürlük ilk adımı). PII yok — sayısal metadata + cihaz kimliği,
    // telefon değil. Tam USB-recovery (re-register) signal-semantik donanım
    // teyidi sonrası ayrı iş.
    private void OnSignal(string deviceModel, string deviceSerial, int signal1, int signal2, int signal3, int signal4)
    {
        // Native thread'den PUSH edilir → exception native call stack'e sızmamalı
        // (OnCallerId ile aynı savunma; sızarsa process crash → ROB-01 worker
        // korumasını atlar).
        try
        {
            _logger.LogInformation(
                "CidShow signal (model={Model} serial={Serial} s1={S1} s2={S2} s3={S3} s4={S4})",
                deviceModel, deviceSerial, signal1, signal2, signal3, signal4);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "CidShow signal callback error (suppressed to protect the native caller)");
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync(CancellationToken.None).ConfigureAwait(false);
    }
}
