using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using RestoranPos.CallerBridge.Configuration;
using RestoranPos.CallerBridge.Devices;
using RestoranPos.CallerBridge.Http;
using Xunit;

namespace RestoranPos.CallerBridge.Tests;

/// <summary>
/// Contract-regression guard for the HTTP layer (ADR-016 §12 Amendment 2, Session 85).
/// The API <c>bridgeCallerIdRouter</c> chains <c>requireBridgeToken</c> +
/// <c>requireTenantHeader</c>, so every POST MUST carry BOTH <c>X-Bridge-Token</c> AND
/// <c>X-Tenant-Id</c> or it returns 400. The shipped client originally sent only the token
/// — this fixture fails if that silent contract break ever returns.
/// </summary>
public class BridgeApiClientTests
{
    // Captures the outgoing request so we can assert on headers + resolved URI.
    private sealed class RecordingHandler : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            return Task.FromResult(new HttpResponseMessage());
        }
    }

    private static BridgeOptions ValidOptions() => new()
    {
        ApiBaseUrl = "https://restoranpos.org/api",
        BridgeToken = "test-bridge-token",
        TenantId = "e94739ac-1111-2222-3333-444455556666",
        LineCount = 1,
    };

    [Fact]
    public async Task PostIncoming_SendsBothAuthHeaders_ToApiStrippedPath()
    {
        var handler = new RecordingHandler();
        var opts = ValidOptions();
        var client = new BridgeApiClient(
            new HttpClient(handler), NullLogger<BridgeApiClient>.Instance, Options.Create(opts));

        var ok = await client.PostIncomingAsync(
            new IncomingCallEvent("05551234567", 1, DateTimeOffset.UtcNow), CancellationToken.None);

        Assert.True(ok);
        Assert.NotNull(handler.LastRequest);

        // Both auth headers required — this is the regression the amendment locks in.
        Assert.True(handler.LastRequest!.Headers.TryGetValues("X-Tenant-Id", out var tenant));
        Assert.Equal(opts.TenantId, Assert.Single(tenant!));
        Assert.True(handler.LastRequest.Headers.TryGetValues("X-Bridge-Token", out var token));
        Assert.Equal(opts.BridgeToken, Assert.Single(token!));

        // Nginx strips the /api prefix (deploy.md §1) → API sees /bridge/caller-id/incoming.
        // Guards the config trap where a bare-domain ApiBaseUrl would 404 into the SPA.
        Assert.Equal(
            "https://restoranpos.org/api/bridge/caller-id/incoming",
            handler.LastRequest.RequestUri!.ToString());
    }

    [Fact]
    public void Ctor_Throws_WhenTenantIdMissing()
    {
        var opts = ValidOptions();
        opts.TenantId = string.Empty;

        var ex = Assert.Throws<InvalidOperationException>(() => new BridgeApiClient(
            new HttpClient(new RecordingHandler()),
            NullLogger<BridgeApiClient>.Instance,
            Options.Create(opts)));

        Assert.Contains("TenantId", ex.Message);
    }
}
