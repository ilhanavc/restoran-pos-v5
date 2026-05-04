namespace RestoranPos.CallerBridge.Devices;

/// <summary>
/// Raw incoming-call payload emitted by the device layer.
/// Phone number is NOT normalized here — the API normalizes it.
/// </summary>
public sealed record IncomingCallEvent(
    string RawPhone,
    int? LineNumber,
    DateTimeOffset ReceivedAt);
