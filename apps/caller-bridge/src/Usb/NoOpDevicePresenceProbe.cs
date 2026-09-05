namespace RestoranPos.CallerBridge.Usb;

/// <summary>
/// No-op probe for non-Windows hosts and unit tests. Always reports "present" so the watchdog
/// never escalates in environments without real hardware. Behavioural watchdog tests inject a
/// fake probe instead of this one.
/// </summary>
public sealed class NoOpDevicePresenceProbe : IDevicePresenceProbe
{
    public Task<bool> IsPresentAsync(string deviceHardwareId, CancellationToken ct) => Task.FromResult(true);
}
