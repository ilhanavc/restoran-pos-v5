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

    [Fact]
    public async Task Worker_DoesNotCrash_WhenDeviceStartFails()
    {
        // C12-ROB-01 — StartAsync interop-throw'u (eksik/yanlış cid.dll) host'u
        // SESSİZCE öldürmemeli: Worker yakalar + loglar, ExecuteAsync fırlatmaz.
        var device = new Mock<ICallerIdDevice>();
        device.Setup(d => d.StartAsync(It.IsAny<CancellationToken>()))
              .ThrowsAsync(new FileNotFoundException("cid.dll bulunamadı"));
        var api = new Mock<IBridgeApiClient>();

        var worker = new CallerBridgeWorker(
            device.Object, api.Object, NullLogger<CallerBridgeWorker>.Instance);
        using var cts = new CancellationTokenSource();

        // Guard yakaladığından fırlatmamalı. Fix'siz: ExecuteAsync StartAsync-throw'u
        // yayar → BackgroundService.StartAsync throw → burası patlar (kırmızı).
        var ex = await Record.ExceptionAsync(() => worker.StartAsync(cts.Token));
        Assert.Null(ex);

        await worker.StopAsync(CancellationToken.None);

        // Cihaz sağır kaldığından API'ye hiç POST gitmez.
        api.Verify(
            a => a.PostIncomingAsync(It.IsAny<IncomingCallEvent>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }
}
