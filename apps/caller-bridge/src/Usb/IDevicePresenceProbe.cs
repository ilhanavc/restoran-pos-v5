namespace RestoranPos.CallerBridge.Usb;

/// <summary>
/// K2a (ADR-016 §12 Amd4) — portable liveness. Reports whether the CIDShow device with the
/// configured hardware-id is currently enumerated by the OS. Unlike callback-silence, this
/// produces NO false positives on quiet call hours (K2 rationale). Real impl is Windows-only
/// (WMI / SetupDi); the mock/non-Windows impl lets the watchdog be tested without hardware.
/// </summary>
public interface IDevicePresenceProbe
{
    /// <summary>
    /// True when a PnP device whose id contains <paramref name="deviceHardwareId"/> is present.
    /// Implementations MUST NOT throw — probe errors are treated as "unknown" by the caller.
    /// </summary>
    Task<bool> IsPresentAsync(string deviceHardwareId, CancellationToken ct);
}
