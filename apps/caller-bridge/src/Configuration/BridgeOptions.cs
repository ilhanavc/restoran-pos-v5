namespace RestoranPos.CallerBridge.Configuration;

/// <summary>
/// Configuration bound from appsettings.json &quot;Bridge&quot; section.
/// </summary>
public sealed class BridgeOptions
{
    public const string SectionName = "Bridge";

    /// <summary>API base URL, e.g. https://api.restoran.example. No trailing slash.</summary>
    public string ApiBaseUrl { get; set; } = string.Empty;

    /// <summary>Shared bridge token sent as X-Bridge-Token; must match API tenant config.</summary>
    public string BridgeToken { get; set; } = string.Empty;

    /// <summary>
    /// Tenant UUID sent as X-Tenant-Id (API `requireTenantHeader` — ADR-016 Amd2, S85).
    /// REQUIRED: eksikse API POST /incoming 400 döner. Prod = bootstrap tenant UUID.
    /// </summary>
    public string TenantId { get; set; } = string.Empty;

    /// <summary>Number of phone lines on the C812A device (1..4). Default 1 for MVP.</summary>
    public int LineCount { get; set; } = 1;

    /// <summary>Use mock device (no hardware). Forced true on non-Windows.</summary>
    public bool UseMockDevice { get; set; }

    /// <summary>Mock device emits a synthetic call every N seconds when set (dev only).</summary>
    public int? MockEmitEverySeconds { get; set; }

    // ─── USB resilience (ADR-016 §12 Amendment 4, C12-USB-01) ──────────────────────────
    // Defense-in-depth against silent USB selective-suspend/disconnect. Pilot = RESTART-ONLY
    // (K6): watchdog detects a break and stops the host so Windows Service recovery restarts
    // the process. In-process re-register (K3) is NOT wired in the pilot — the fields below
    // are reserved so it can be enabled later without a config migration.

    /// <summary>Master switch for all USB-resilience layers (K4). false → every layer no-ops.</summary>
    public bool UsbResilienceEnabled { get; set; } = true;

    /// <summary>K1 — disable Windows USB selective-suspend programmatically at startup.</summary>
    public bool DisableUsbSelectiveSuspend { get; set; } = true;

    /// <summary>K2 — watchdog presence-poll interval in seconds.</summary>
    public int WatchdogIntervalSeconds { get; set; } = 60;

    /// <summary>
    /// K2c — proactive blind re-register cadence in minutes.
    /// RESERVED / pilot-disabled (K6): null keeps it off; the restart-only path never reads it.
    /// </summary>
    public int? ProactiveReRegisterMinutes { get; set; }

    /// <summary>
    /// K3 — max in-process re-register attempts before escalating.
    /// RESERVED / pilot-disabled (K6): restart-only path by-passes this. Kept for a future
    /// hardware-confirmed in-process recovery stage.
    /// </summary>
    public int MaxReRegisterAttempts { get; set; } = 3;

    /// <summary>
    /// K3 — cooldown between in-process re-register attempts in seconds.
    /// RESERVED / pilot-disabled (K6): see <see cref="MaxReRegisterAttempts"/>.
    /// </summary>
    public int ReRegisterCooldownSeconds { get; set; } = 30;

    /// <summary>
    /// K1b/K2a — CIDShow hardware-id (e.g. VID/PID fragment). When empty: presence-poll is
    /// disabled and K1 applies the global scheme only ([USER] fills it from Device Manager).
    /// </summary>
    public string? DeviceHardwareId { get; set; }
}
