using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using RestoranPos.CallerBridge.Configuration;
using RestoranPos.CallerBridge.Devices;
using RestoranPos.CallerBridge.Http;
using RestoranPos.CallerBridge.Workers;
using Xunit;

namespace RestoranPos.CallerBridge.Tests;

public class CallerBridgeWorkerTests
{
    private static IOptions<BridgeOptions> Opts() => Options.Create(new BridgeOptions
    {
        ApiBaseUrl = "http://localhost",
        BridgeToken = "t",
        LineCount = 1,
        UseMockDevice = true,
    });

    [Fact]
    public async Task Worker_ForwardsCall_FromDeviceToApi()
    {
        var device = new MockCallerIdDevice(NullLogger<MockCallerIdDevice>.Instance, Opts());
        var api = new Mock<IBridgeApiClient>();
        api.Setup(a => a.PostIncomingAsync(It.IsAny<IncomingCallEvent>(), It.IsAny<CancellationToken>()))
           .ReturnsAsync(true);

        var worker = new CallerBridgeWorker(device, api.Object, NullLogger<CallerBridgeWorker>.Instance);
        using var cts = new CancellationTokenSource();

        var run = worker.StartAsync(cts.Token);
        await run;

        device.EmitForTest("05551234567", 1);

        // Give the channel reader a brief moment to drain.
        await Task.Delay(150);

        await worker.StopAsync(CancellationToken.None);

        api.Verify(a => a.PostIncomingAsync(
                It.Is<IncomingCallEvent>(e => e.RawPhone == "05551234567" && e.LineNumber == 1),
                It.IsAny<CancellationToken>()),
            Times.AtLeastOnce);
    }

    [Fact]
    public async Task Worker_DropsEvents_WhenApiFails_WithoutCrash()
    {
        var device = new MockCallerIdDevice(NullLogger<MockCallerIdDevice>.Instance, Opts());
        var api = new Mock<IBridgeApiClient>();
        api.Setup(a => a.PostIncomingAsync(It.IsAny<IncomingCallEvent>(), It.IsAny<CancellationToken>()))
           .ReturnsAsync(false);

        var worker = new CallerBridgeWorker(device, api.Object, NullLogger<CallerBridgeWorker>.Instance);
        using var cts = new CancellationTokenSource();

        await worker.StartAsync(cts.Token);

        device.EmitForTest("05551234567");
        device.EmitForTest("05559876543");

        await Task.Delay(150);
        await worker.StopAsync(CancellationToken.None);

        api.Verify(a => a.PostIncomingAsync(It.IsAny<IncomingCallEvent>(), It.IsAny<CancellationToken>()),
            Times.AtLeast(2));
    }
}
