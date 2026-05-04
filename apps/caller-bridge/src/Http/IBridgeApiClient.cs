using RestoranPos.CallerBridge.Devices;

namespace RestoranPos.CallerBridge.Http;

public interface IBridgeApiClient
{
    /// <summary>POST the incoming call to the API. Returns true on 2xx.</summary>
    Task<bool> PostIncomingAsync(IncomingCallEvent evt, CancellationToken ct);
}
