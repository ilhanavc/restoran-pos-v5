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

    // USB selective-suspend setting addressed by GUID, NOT the SUB_USB / USBSELECTIVESUSPEND
    // friendly aliases. S120 pilot (restoran PC) proved those aliases are not registered on every
    // Windows build → "Invalid Parameters" (exitCode=1). GUIDs are locale/edition-independent and
    // always resolve. Subgroup = "USB settings", setting = "USB selective suspend".
    private const string UsbSubgroupGuid = "2a737441-1930-4402-8d77-b2bebba308a3";
    private const string UsbSelectiveSuspendGuid = "48e6b7a6-50f5-4782-a5d4-53bb8f07e226";

    private readonly ILogger<WindowsUsbPowerManager> _logger;

    public WindowsUsbPowerManager(ILogger<WindowsUsbPowerManager> logger) => _logger = logger;

    public async Task ApplyResilienceSettingsAsync(string? deviceHardwareId, CancellationToken ct)
    {
        // K1a — global: clear USB selective-suspend on the active scheme for both AC and DC,
        // then activate the scheme so the change takes effect. Addressed by GUID (see above).
        var acOk = await RunPowerCfgAsync(
            "AC selective-suspend kapat",
            $"/SETACVALUEINDEX SCHEME_CURRENT {UsbSubgroupGuid} {UsbSelectiveSuspendGuid} 0", ct);
        var dcOk = await RunPowerCfgAsync(
            "DC selective-suspend kapat",
            $"/SETDCVALUEINDEX SCHEME_CURRENT {UsbSubgroupGuid} {UsbSelectiveSuspendGuid} 0", ct);
        var activeOk = await RunPowerCfgAsync(
            "aktif güç şemasını uygula",
            "/SETACTIVE SCHEME_CURRENT", ct);

        // Success is logged ONLY when every step actually succeeded — the earlier unconditional
        // "disabled" line was misleading (S120 pilot: it claimed success while powercfg exited 1).
        if (acOk && dcOk && activeOk)
        {
            _logger.LogInformation(
                "USB selective-suspend devre dışı bırakıldı (kapsam=global, şema=SCHEME_CURRENT)");
        }
        else
        {
            _logger.LogWarning(
                "USB selective-suspend KAPATILAMADI (ac={AcOk} dc={DcOk} active={ActiveOk}) — best-effort, servis devam ediyor (K2 watchdog + K3 restart telafi eder)",
                acOk, dcOk, activeOk);
        }

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

    /// <summary>Runs one powercfg invocation. Returns true only on a clean exit (code 0).</summary>
    private async Task<bool> RunPowerCfgAsync(string what, string arguments, CancellationToken ct)
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
                return false;
            }

            await process.WaitForExitAsync(ct);
            if (process.ExitCode != 0)
            {
                _logger.LogWarning(
                    "powercfg başarısız ({What}) exitCode={ExitCode} — best-effort, servis devam ediyor",
                    what, process.ExitCode);
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            // Best-effort (K1): never fatal — watchdog (K2) + restart recovery (K3) compensate.
            _logger.LogWarning(ex, "powercfg çağrısı hata verdi ({What}) — best-effort, atlanıyor", what);
            return false;
        }
    }
}
