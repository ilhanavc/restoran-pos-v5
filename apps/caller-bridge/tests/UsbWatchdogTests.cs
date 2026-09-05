using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using RestoranPos.CallerBridge.Configuration;
using RestoranPos.CallerBridge.Usb;
using Xunit;

namespace RestoranPos.CallerBridge.Tests;

/// <summary>
/// ADR-016 §12 Amd4 (C12-USB-01) watchdog decision + escalation logic. Hardware-free: a fake
/// presence probe drives present/absent sequences and a mocked lifetime records the restart
/// escalation. The real WMI probe and powercfg P/Invoke stay compile-correct but
/// Doğrulanmamış: (hardware-only, go/no-go gate).
/// </summary>
public class UsbWatchdogTests
{
    // Fake probe returning a scripted sequence of presence readings (last value repeats).
    private sealed class FakeProbe : IDevicePresenceProbe
    {
        private readonly Queue<bool> _readings;
        private bool _last = true;
        public int Calls { get; private set; }

        public FakeProbe(params bool[] readings) => _readings = new Queue<bool>(readings);

        public Task<bool> IsPresentAsync(string deviceHardwareId, CancellationToken ct)
        {
            Calls++;
            if (_readings.Count > 0)
            {
                _last = _readings.Dequeue();
            }
            return Task.FromResult(_last);
        }
    }

    private static IOptions<BridgeOptions> Opts(
        bool enabled = true, string? hardwareId = "VID_1234&PID_5678") =>
        Options.Create(new BridgeOptions
        {
            ApiBaseUrl = "http://localhost",
            BridgeToken = "t",
            UsbResilienceEnabled = enabled,
            DeviceHardwareId = hardwareId,
            WatchdogIntervalSeconds = 60,
        });

    private static (UsbWatchdog wd, Mock<IHostApplicationLifetime> life) Build(
        IDevicePresenceProbe probe, IOptions<BridgeOptions> opts)
    {
        var life = new Mock<IHostApplicationLifetime>();
        var wd = new UsbWatchdog(probe, life.Object, opts, NullLogger<UsbWatchdog>.Instance);
        return (wd, life);
    }

    [Fact]
    public async Task Evaluate_ReturnsHealthy_WhenDevicePresent()
    {
        var (wd, _) = Build(new FakeProbe(true), Opts());
        Assert.Equal(WatchdogDecision.Healthy, await wd.EvaluateAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Evaluate_ReturnsDisconnected_OnSustainedAbsent()
    {
        // Two consecutive absent readings cross the sustained-absent threshold.
        var (wd, _) = Build(new FakeProbe(false, false), Opts());
        Assert.Equal(WatchdogDecision.Healthy, await wd.EvaluateAsync(CancellationToken.None));
        Assert.Equal(WatchdogDecision.Disconnected, await wd.EvaluateAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Evaluate_ReturnsDisconnected_OnPresentAbsentPresentCycle()
    {
        // present → absent → present = drop/re-enumerate, escalate even below sustained threshold.
        var (wd, _) = Build(new FakeProbe(true, false, true), Opts());
        Assert.Equal(WatchdogDecision.Healthy, await wd.EvaluateAsync(CancellationToken.None));
        Assert.Equal(WatchdogDecision.Healthy, await wd.EvaluateAsync(CancellationToken.None));
        Assert.Equal(WatchdogDecision.Disconnected, await wd.EvaluateAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Evaluate_StaysHealthy_WhenDeviceRemainsPresent()
    {
        var (wd, _) = Build(new FakeProbe(true, true, true, true), Opts());
        for (var i = 0; i < 4; i++)
        {
            Assert.Equal(WatchdogDecision.Healthy, await wd.EvaluateAsync(CancellationToken.None));
        }
    }

    [Fact]
    public async Task Evaluate_DoesNotProbe_WhenResilienceDisabled()
    {
        var probe = new FakeProbe(false, false);
        var (wd, _) = Build(probe, Opts(enabled: false));
        Assert.Equal(WatchdogDecision.Healthy, await wd.EvaluateAsync(CancellationToken.None));
        Assert.Equal(0, probe.Calls);
    }

    [Fact]
    public async Task Evaluate_DoesNotProbe_WhenHardwareIdMissing()
    {
        var probe = new FakeProbe(false, false);
        var (wd, _) = Build(probe, Opts(hardwareId: null));
        Assert.Equal(WatchdogDecision.Healthy, await wd.EvaluateAsync(CancellationToken.None));
        Assert.Equal(0, probe.Calls);
    }

    [Fact]
    public async Task Tick_StopsApplication_OnDisconnect()
    {
        var (wd, life) = Build(new FakeProbe(false, false), Opts());
        await wd.TickAsync(CancellationToken.None); // healthy (1 absent)
        await wd.TickAsync(CancellationToken.None); // disconnected → escalate
        life.Verify(l => l.StopApplication(), Times.Once);
    }

    [Fact]
    public async Task Tick_EscalatesOnce_AndStopsProbing_AfterDisconnect()
    {
        var probe = new FakeProbe(false, false, false, false);
        var (wd, life) = Build(probe, Opts());
        await wd.TickAsync(CancellationToken.None);
        await wd.TickAsync(CancellationToken.None); // escalates here
        var callsAtEscalation = probe.Calls;
        await wd.TickAsync(CancellationToken.None); // no-op after escalation
        await wd.TickAsync(CancellationToken.None);

        life.Verify(l => l.StopApplication(), Times.Once);
        Assert.Equal(callsAtEscalation, probe.Calls); // no further probing once escalated
    }

    [Fact]
    public async Task Tick_DoesNotStopApplication_WhilePresent()
    {
        var (wd, life) = Build(new FakeProbe(true, true, true), Opts());
        for (var i = 0; i < 3; i++)
        {
            await wd.TickAsync(CancellationToken.None);
        }
        life.Verify(l => l.StopApplication(), Times.Never);
    }

    [Fact]
    public void RecordNativeActivity_DoesNotThrow_AndDoesNotEscalate()
    {
        // K2b — beat is a supporting hint only; it must never trigger a restart on its own.
        var (wd, life) = Build(new FakeProbe(true), Opts());
        wd.RecordNativeActivity();
        wd.RecordNativeActivity();
        life.Verify(l => l.StopApplication(), Times.Never);
    }

    [Fact]
    public async Task Run_ReturnsImmediately_WhenResilienceDisabled()
    {
        var probe = new FakeProbe(false, false);
        var (wd, life) = Build(probe, Opts(enabled: false));
        await wd.RunAsync(CancellationToken.None); // must not loop/probe
        Assert.Equal(0, probe.Calls);
        life.Verify(l => l.StopApplication(), Times.Never);
    }

    [Fact]
    public async Task Run_ReturnsImmediately_WhenHardwareIdMissing()
    {
        var probe = new FakeProbe(false, false);
        var (wd, life) = Build(probe, Opts(hardwareId: null));
        await wd.RunAsync(CancellationToken.None);
        Assert.Equal(0, probe.Calls);
        life.Verify(l => l.StopApplication(), Times.Never);
    }
}
