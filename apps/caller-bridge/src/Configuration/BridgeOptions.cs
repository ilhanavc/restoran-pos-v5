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

    /// <summary>Number of phone lines on the C812A device (1..4). Default 1 for MVP.</summary>
    public int LineCount { get; set; } = 1;

    /// <summary>Use mock device (no hardware). Forced true on non-Windows.</summary>
    public bool UseMockDevice { get; set; }

    /// <summary>Mock device emits a synthetic call every N seconds when set (dev only).</summary>
    public int? MockEmitEverySeconds { get; set; }
}
