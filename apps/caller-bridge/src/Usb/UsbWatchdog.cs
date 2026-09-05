using Microsoft.Extensions.Options;
using RestoranPos.CallerBridge.Configuration;

namespace RestoranPos.CallerBridge.Usb;

/// <summary>Outcome of a single watchdog evaluation.</summary>
public enum WatchdogDecision
{
    /// <summary>Device present (or poll gated off) — no action.</summary>
    Healthy,

    /// <summary>A silent USB break was detected — escalate to service restart.</summary>
    Disconnected,
}

/// <summary>
/// K2/K3 (ADR-016 §12 Amd4) — presence-poll watchdog + restart escalation.
///
/// Pilot strategy is RESTART-ONLY (K6): on a detected break the watchdog logs and calls
/// <see cref="Microsoft.Extensions.Hosting.IHostApplicationLifetime.StopApplication"/> for a
/// clean host stop; the Windows Service recovery policy (Amd2: failure=restart/5s×3) then
/// restarts the process, which re-registers the device from scratch. In-process re-register
/// (Free+reload) is deliberately NOT wired here — the reserved <see cref="BridgeOptions"/>
/// fields let it be added later once the DLL's Free+reload behaviour is confirmed on hardware.
///
/// Decision is presence-centric to avoid the seldom-call false positive (K2 rationale): a quiet
/// phone is not a dead device. Callback activity (<see cref="RecordNativeActivity"/>) is recorded
/// only as a supporting positive-liveness hint and never drives the disconnect decision (K2b).
/// </summary>
public sealed class UsbWatchdog
{
    // Two consecutive absent polls (~2 intervals) before declaring a sustained disconnect. A
    // single absent reading escalates only when it is a present→absent→present cycle (below),
    // which is an unambiguous drop/re-enumerate event; the threshold guards the steady-absent
    // path against a lone transient enumeration gap.
    private const int AbsentThreshold = 2;

    private readonly IDevicePresenceProbe _probe;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly BridgeOptions _options;
    private readonly ILogger<UsbWatchdog> _logger;

    private bool? _wasPresent;
    private int _consecutiveAbsent;
    private bool _escalated;
    private string _lastReason = "unknown";
    private long _lastNativeActivityUtcTicks;

    public UsbWatchdog(
        IDevicePresenceProbe probe,
        IHostApplicationLifetime lifetime,
        IOptions<BridgeOptions> options,
        ILogger<UsbWatchdog> logger)
    {
        _probe = probe;
        _lifetime = lifetime;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// K2b — opportunistic positive-liveness beat. Called from the device's caller-id and signal
    /// callbacks. Supporting hint only; never affects the disconnect decision.
    /// </summary>
    public void RecordNativeActivity() =>
        Interlocked.Exchange(ref _lastNativeActivityUtcTicks, DateTimeOffset.UtcNow.UtcTicks);

    /// <summary>
    /// Runs the periodic presence-poll loop until <paramref name="ct"/> is cancelled or a break
    /// escalates. No-ops (with a log) when resilience is off or no hardware-id is configured.
    /// </summary>
    public async Task RunAsync(CancellationToken ct)
    {
        if (!_options.UsbResilienceEnabled)
        {
            _logger.LogInformation("USB dayanıklılığı kapalı (UsbResilienceEnabled=false) — watchdog çalışmıyor");
            return;
        }

        if (string.IsNullOrWhiteSpace(_options.DeviceHardwareId))
        {
            _logger.LogInformation(
                "Cihaz varlık yoklaması devre dışı (DeviceHardwareId boş) — yalnız K1 önleme aktif");
            return;
        }

        var interval = TimeSpan.FromSeconds(Math.Max(5, _options.WatchdogIntervalSeconds));
        _logger.LogInformation(
            "USB watchdog başladı (aralık={Interval}s hardwareId={HardwareId})",
            interval.TotalSeconds, _options.DeviceHardwareId);

        using var timer = new PeriodicTimer(interval);
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
            {
                await TickAsync(ct);
                if (_escalated)
                {
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // graceful shutdown
        }
    }

    /// <summary>One poll cycle: evaluate presence and escalate on a detected break.</summary>
    public async Task TickAsync(CancellationToken ct)
    {
        if (_escalated)
        {
            return;
        }

        var decision = await EvaluateAsync(ct);
        if (decision == WatchdogDecision.Disconnected)
        {
            Escalate(_lastReason);
        }
    }

    /// <summary>
    /// Probes presence once and returns the decision, updating internal state. Gated to Healthy
    /// (without probing) when resilience is off or no hardware-id is set.
    /// </summary>
    public async Task<WatchdogDecision> EvaluateAsync(CancellationToken ct)
    {
        if (!_options.UsbResilienceEnabled || string.IsNullOrWhiteSpace(_options.DeviceHardwareId))
        {
            return WatchdogDecision.Healthy;
        }

        var present = await _probe.IsPresentAsync(_options.DeviceHardwareId, ct);
        return Observe(present);
    }

    // Pure decision logic over the presence sequence — unit tested directly.
    private WatchdogDecision Observe(bool present)
    {
        if (present)
        {
            var recoveredCycle = _wasPresent == false; // saw it absent, now back = drop/re-enumerate
            _consecutiveAbsent = 0;
            _wasPresent = true;

            if (recoveredCycle)
            {
                _lastReason = "device-reconnect-cycle";
                _logger.LogWarning("Cihaz yok→var geçişi algılandı (yeniden numaralandırma)");
                return WatchdogDecision.Disconnected;
            }

            return WatchdogDecision.Healthy;
        }

        _consecutiveAbsent++;
        _wasPresent = false;
        _logger.LogWarning("Cihaz varlık yoklaması: YOK (ardışık={Count})", _consecutiveAbsent);

        if (_consecutiveAbsent >= AbsentThreshold)
        {
            _lastReason = $"device-absent-x{_consecutiveAbsent}";
            return WatchdogDecision.Disconnected;
        }

        return WatchdogDecision.Healthy;
    }

    private void Escalate(string reason)
    {
        if (_escalated)
        {
            return;
        }

        _escalated = true;
        _logger.LogWarning(
            "USB kopması tespit edildi — servis yeniden başlatmaya yükseltiliyor (reason={Reason})",
            reason);
        _lifetime.StopApplication();
    }
}
