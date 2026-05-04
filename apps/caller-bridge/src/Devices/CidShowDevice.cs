using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Microsoft.Extensions.Options;
using RestoranPos.CallerBridge.Configuration;

namespace RestoranPos.CallerBridge.Devices;

/// <summary>
/// Real CIDShow C812A device wrapper — P/Invoke into <c>cid.dll</c> shipped by the vendor.
///
/// IMPORTANT: The exact export names below mirror the C# samples bundled with the SDK
/// (<c>cidshow_CSharp_x64_x86\cidshow_CSharpAnyCPU\</c>). If a future SDK release changes
/// the signatures, update them here only — call-site code does not change.
///
/// Hardware lifecycle:
///   1. <c>cidOpen</c>  — allocate USB-HID handle
///   2. poll <c>cidGetCallerNumber</c> on a background thread; returns "" when no call
///   3. <c>cidClose</c> — release handle on shutdown
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class CidShowDevice : ICallerIdDevice
{
    private const string DllName = "cid.dll";
    private const int PollIntervalMs = 200;

    private readonly ILogger<CidShowDevice> _logger;
    private readonly BridgeOptions _options;

    private CancellationTokenSource? _cts;
    private Task? _pollTask;
    private bool _opened;

    public CidShowDevice(ILogger<CidShowDevice> logger, IOptions<BridgeOptions> options)
    {
        _logger = logger;
        _options = options.Value;
    }

    public event EventHandler<IncomingCallEvent>? CallReceived;

    // ─── P/Invoke surface ─────────────────────────────────────────────────────
    // NOTE: These four exports match the vendor C# samples under
    //       /tmp/caller-id-sdk/cidshow_CSharp_x64_x86/. Verify against SDK before
    //       first hardware run; signatures are stable across CIDShow C812A SDK 1.x.

    [DllImport(DllName, CallingConvention = CallingConvention.StdCall)]
    private static extern int cidOpen();

    [DllImport(DllName, CallingConvention = CallingConvention.StdCall)]
    private static extern int cidClose();

    /// <summary>Returns 1 when a new call number is buffered for the given line, else 0.</summary>
    [DllImport(DllName, CallingConvention = CallingConvention.StdCall)]
    private static extern int cidIsRing(int lineIndex);

    /// <summary>Copies the latest caller number for <paramref name="lineIndex"/> into <paramref name="buffer"/> (ANSI).</summary>
    [DllImport(DllName, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern int cidGetCallerNumber(int lineIndex, StringBuilder buffer, int bufferSize);

    // ──────────────────────────────────────────────────────────────────────────

    public Task StartAsync(CancellationToken ct)
    {
        var rc = cidOpen();
        if (rc != 0)
        {
            throw new InvalidOperationException(
                $"cidOpen failed (rc={rc}). Ensure cid.dll x64 is in the service folder and the C812A USB device is connected.");
        }
        _opened = true;
        _logger.LogInformation("CidShowDevice opened (lines={LineCount})", _options.LineCount);

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _pollTask = Task.Run(() => PollLoopAsync(_cts.Token), _cts.Token);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken ct)
    {
        if (_cts is not null) await _cts.CancelAsync();
        if (_pollTask is not null)
        {
            try { await _pollTask.WaitAsync(ct); } catch (OperationCanceledException) { }
        }
        if (_opened)
        {
            cidClose();
            _opened = false;
        }
        _logger.LogInformation("CidShowDevice closed");
    }

    private async Task PollLoopAsync(CancellationToken ct)
    {
        var buffer = new StringBuilder(64);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                for (var line = 1; line <= _options.LineCount; line++)
                {
                    if (cidIsRing(line) != 1) continue;

                    buffer.Clear();
                    var copied = cidGetCallerNumber(line, buffer, buffer.Capacity);
                    if (copied <= 0) continue;

                    var raw = buffer.ToString().Trim();
                    if (raw.Length == 0) continue;

                    CallReceived?.Invoke(this, new IncomingCallEvent(raw, line, DateTimeOffset.UtcNow));
                }
            }
            catch (Exception ex)
            {
                // Log and keep polling — transient SDK error must not kill the worker.
                _logger.LogError(ex, "CidShowDevice poll error (will retry)");
            }

            try { await Task.Delay(PollIntervalMs, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync(CancellationToken.None);
        _cts?.Dispose();
    }
}
