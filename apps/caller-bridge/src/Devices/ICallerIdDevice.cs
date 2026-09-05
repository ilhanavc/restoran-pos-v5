namespace RestoranPos.CallerBridge.Devices;

/// <summary>
/// Abstraction over the caller-id hardware. Two impls: real CIDShow (Windows P/Invoke)
/// and a mock device used in dev/test (and on non-Windows hosts).
/// </summary>
public interface ICallerIdDevice : IAsyncDisposable
{
    /// <summary>Raised once per inbound ring with raw phone digits and line number.</summary>
    event EventHandler<IncomingCallEvent>? CallReceived;

    /// <summary>
    /// K2b (ADR-016 §12 Amd4) — raised on ANY native callback (caller-id or signal) as a
    /// positive-liveness beat. Carries no payload (KVKK: no phone data); the watchdog uses it
    /// only as a supporting hint, never as a disconnect decision input.
    /// </summary>
    event EventHandler? NativeActivity;

    /// <summary>Open device (allocate handle, start polling).</summary>
    Task StartAsync(CancellationToken ct);

    /// <summary>Close device gracefully.</summary>
    Task StopAsync(CancellationToken ct);
}
