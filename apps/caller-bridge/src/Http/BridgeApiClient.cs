using System.Net.Http.Json;
using Microsoft.Extensions.Options;
using RestoranPos.CallerBridge.Configuration;
using RestoranPos.CallerBridge.Devices;
using RestoranPos.CallerBridge.Logging;

namespace RestoranPos.CallerBridge.Http;

/// <summary>
/// Thin HTTP client for POST /bridge/caller-id/incoming.
/// Auth: X-Bridge-Token header (shared secret, tenant-bound on API side).
/// </summary>
public sealed class BridgeApiClient : IBridgeApiClient
{
    private readonly HttpClient _http;
    private readonly ILogger<BridgeApiClient> _logger;
    private readonly BridgeOptions _options;

    public BridgeApiClient(
        HttpClient http,
        ILogger<BridgeApiClient> logger,
        IOptions<BridgeOptions> options)
    {
        _http = http;
        _logger = logger;
        _options = options.Value;

        if (string.IsNullOrWhiteSpace(_options.ApiBaseUrl))
            throw new InvalidOperationException("Bridge:ApiBaseUrl is required.");
        if (string.IsNullOrWhiteSpace(_options.BridgeToken))
            throw new InvalidOperationException("Bridge:BridgeToken is required.");

        _http.BaseAddress = new Uri(_options.ApiBaseUrl.TrimEnd('/') + "/");
        _http.DefaultRequestHeaders.Add("X-Bridge-Token", _options.BridgeToken);
        _http.Timeout = TimeSpan.FromSeconds(10);
    }

    public async Task<bool> PostIncomingAsync(IncomingCallEvent evt, CancellationToken ct)
    {
        // API contract: { rawPhone, lineNumber, receivedAt } — body keys are camelCase.
        var body = new
        {
            rawPhone = evt.RawPhone,
            lineNumber = evt.LineNumber,
            receivedAt = evt.ReceivedAt.ToUniversalTime().ToString("O"),
        };

        var masked = PhoneMasking.Mask(evt.RawPhone);
        try
        {
            using var resp = await _http.PostAsJsonAsync("bridge/caller-id/incoming", body, ct);
            if (resp.IsSuccessStatusCode)
            {
                _logger.LogInformation("Incoming call posted (phone={Masked} line={Line})", masked, evt.LineNumber);
                return true;
            }

            _logger.LogWarning(
                "Bridge POST non-success (status={Status} phone={Masked})",
                (int)resp.StatusCode, masked);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Bridge POST failed (phone={Masked})", masked);
            return false;
        }
    }
}
