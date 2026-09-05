using System.Management;
using System.Runtime.Versioning;

namespace RestoranPos.CallerBridge.Usb;

/// <summary>
/// K2a (ADR-016 §12 Amd4) Windows implementation. Enumerates <c>Win32_PnPEntity</c> via WMI and
/// checks whether any device id contains the configured hardware-id fragment. Portable across
/// machines (no vendor SDK dependency) and produces no false positives — a quiet phone still
/// shows the device as present.
///
/// Doğrulanmamış: whether selective-suspend drops the C812A from PnP enumeration (probe catches
/// it) or keeps it present-but-asleep (only K1 prevention helps) is decided empirically by the
/// first pilot (Açık soru 5). The WMI query itself is compile-correct and documented.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WmiDevicePresenceProbe : IDevicePresenceProbe
{
    private readonly ILogger<WmiDevicePresenceProbe> _logger;

    public WmiDevicePresenceProbe(ILogger<WmiDevicePresenceProbe> logger) => _logger = logger;

    public Task<bool> IsPresentAsync(string deviceHardwareId, CancellationToken ct)
    {
        // WMI is synchronous; run off the watchdog timer thread so a slow query never stalls it.
        return Task.Run(() => QueryPresent(deviceHardwareId), ct);
    }

    private bool QueryPresent(string deviceHardwareId)
    {
        try
        {
            // Match on PNPDeviceID / DeviceID substring (VID_xxxx&PID_yyyy fragment).
            using var searcher = new ManagementObjectSearcher(
                "SELECT DeviceID, PNPDeviceID FROM Win32_PnPEntity");
            using var results = searcher.Get();

            foreach (var mo in results)
            {
                using (mo)
                {
                    var pnpId = mo["PNPDeviceID"] as string ?? string.Empty;
                    var deviceId = mo["DeviceID"] as string ?? string.Empty;
                    if (pnpId.Contains(deviceHardwareId, StringComparison.OrdinalIgnoreCase)
                        || deviceId.Contains(deviceHardwareId, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
            }

            return false;
        }
        catch (Exception ex)
        {
            // Never throw (contract): a probe error is "unknown", which the watchdog treats as
            // present to avoid a false disconnect escalation on a transient WMI hiccup.
            _logger.LogWarning(ex, "Cihaz varlık yoklaması (WMI) hata verdi — bilinmiyor sayılıyor");
            return true;
        }
    }
}
