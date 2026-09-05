using System.Diagnostics;
using System.Runtime.Versioning;

namespace RestoranPos.CallerBridge.Usb;

/// <summary>
/// K1 (ADR-016 §12 Amd4) Windows implementation. Disables USB selective-suspend via powercfg on
/// the active power scheme (global, portable — K1a). Runs under the LocalSystem service account
/// (Amd2), which has the rights powercfg needs. All calls are best-effort: any failure is logged
/// and swallowed so a hardened/locked-down machine never blocks the bridge from starting.
///
/// Doğrulanmamış: whether disabling selective-suspend actually cures the silent-miss on the
/// physical CIDShow C812A is only proven on restaurant hardware (go/no-go gate). The powercfg
/// invocations themselves are compile-correct and use documented switches.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsUsbPowerManager : IUsbPowerManager
{
    private const string PowerCfg = "powercfg";

    private readonly ILogger<WindowsUsbPowerManager> _logger;

    public WindowsUsbPowerManager(ILogger<WindowsUsbPowerManager> logger) => _logger = logger;

    public async Task ApplyResilienceSettingsAsync(string? deviceHardwareId, CancellationToken ct)
    {
        // K1a — global: clear USB selective-suspend on the active scheme for both AC and DC,
        // then activate the scheme so the change takes effect.
        await RunPowerCfgAsync(
            "AC selective-suspend kapat",
            "/setacvalueindex SCHEME_CURRENT SUB_USB USBSELECTIVESUSPEND 0", ct);
        await RunPowerCfgAsync(
            "DC selective-suspend kapat",
            "/setdcvalueindex SCHEME_CURRENT SUB_USB USBSELECTIVESUSPEND 0", ct);
        await RunPowerCfgAsync(
            "aktif güç şemasını uygula",
            "/setactive SCHEME_CURRENT", ct);

        _logger.LogInformation(
            "USB selective-suspend devre dışı bırakıldı (kapsam=global, şema=SCHEME_CURRENT)");

        // K1b — per-device targeting is only meaningful with a hardware-id. The SetupDi registry
        // flag write is deferred until the id is confirmed on hardware (Açık soru 4); until then
        // the global scheme above is the effective cure. We log intent so the pilot log shows it.
        if (!string.IsNullOrWhiteSpace(deviceHardwareId))
        {
            _logger.LogInformation(
                "Cihaza-özel güç yönetimi kapatma atlandı (hardware-id={HardwareId} — SetupDi hedefleme donanım teyidi sonrası, K1b)",
                deviceHardwareId);
        }
    }

    private async Task RunPowerCfgAsync(string what, string arguments, CancellationToken ct)
    {
        try
        {
            var psi = new ProcessStartInfo(PowerCfg, arguments)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var process = Process.Start(psi);
            if (process is null)
            {
                _logger.LogWarning("powercfg başlatılamadı ({What}) — best-effort, atlanıyor", what);
                return;
            }

            await process.WaitForExitAsync(ct);
            if (process.ExitCode != 0)
            {
                _logger.LogWarning(
                    "powercfg başarısız ({What}) exitCode={ExitCode} — best-effort, servis devam ediyor",
                    what, process.ExitCode);
            }
        }
        catch (Exception ex)
        {
            // Best-effort (K1): never fatal — watchdog (K2) + restart recovery (K3) compensate.
            _logger.LogWarning(ex, "powercfg çağrısı hata verdi ({What}) — best-effort, atlanıyor", what);
        }
    }
}
