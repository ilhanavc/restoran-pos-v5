namespace RestoranPos.CallerBridge.Usb;

/// <summary>
/// K1 (ADR-016 §12 Amd4) — prevention layer. Disables Windows USB selective-suspend so the
/// idle machine cannot silently power down the CIDShow device mid-ring.
///
/// Best-effort by contract: implementations MUST NOT throw on failure — a failed powercfg call
/// is logged, never fatal (K2/K3 watchdog compensates). Real impl is Windows-only; the mock /
/// non-Windows impl is a no-op so unit tests and Linux hosts stay clean.
/// </summary>
public interface IUsbPowerManager
{
    /// <summary>
    /// Apply resilience power settings once at startup (before the device opens).
    /// <paramref name="deviceHardwareId"/> null/empty → global scheme only (K1a); when present,
    /// the per-device flag is additionally cleared (K1b).
    /// </summary>
    Task ApplyResilienceSettingsAsync(string? deviceHardwareId, CancellationToken ct);
}
