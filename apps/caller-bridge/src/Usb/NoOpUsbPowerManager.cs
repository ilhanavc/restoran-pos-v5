namespace RestoranPos.CallerBridge.Usb;

/// <summary>
/// No-op power manager used on non-Windows hosts and in unit tests. Selective-suspend is a
/// Windows-only concept, so there is nothing to apply — this keeps the worker wiring uniform.
/// </summary>
public sealed class NoOpUsbPowerManager : IUsbPowerManager
{
    private readonly ILogger<NoOpUsbPowerManager> _logger;

    public NoOpUsbPowerManager(ILogger<NoOpUsbPowerManager> logger) => _logger = logger;

    public Task ApplyResilienceSettingsAsync(string? deviceHardwareId, CancellationToken ct)
    {
        _logger.LogInformation("USB güç yönetimi atlandı (Windows dışı/mock ortam — no-op)");
        return Task.CompletedTask;
    }
}
