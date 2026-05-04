using Microsoft.Extensions.Options;
using RestoranPos.CallerBridge.Configuration;

namespace RestoranPos.CallerBridge.Devices;

/// <summary>
/// Mock device for development and unit tests.
/// Optionally emits a synthetic call every N seconds (configured via Bridge:MockEmitEverySeconds).
/// Tests can also call <see cref="EmitForTest"/> directly.
/// </summary>
public sealed class MockCallerIdDevice : ICallerIdDevice
{
    private readonly ILogger<MockCallerIdDevice> _logger;
    private readonly BridgeOptions _options;
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public MockCallerIdDevice(ILogger<MockCallerIdDevice> logger, IOptions<BridgeOptions> options)
    {
        _logger = logger;
        _options = options.Value;
    }

    public event EventHandler<IncomingCallEvent>? CallReceived;

    public Task StartAsync(CancellationToken ct)
    {
        _logger.LogInformation("MockCallerIdDevice started (lines={LineCount})", _options.LineCount);

        if (_options.MockEmitEverySeconds is int seconds && seconds > 0)
        {
            _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            _loop = Task.Run(() => EmitLoopAsync(seconds, _cts.Token), _cts.Token);
        }
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken ct)
    {
        if (_cts is not null)
        {
            await _cts.CancelAsync();
        }
        if (_loop is not null)
        {
            try { await _loop.WaitAsync(ct); } catch (OperationCanceledException) { }
        }
        _logger.LogInformation("MockCallerIdDevice stopped");
    }

    /// <summary>Test helper — synchronously raises a CallReceived event.</summary>
    public void EmitForTest(string rawPhone, int? lineNumber = 1)
    {
        CallReceived?.Invoke(this, new IncomingCallEvent(rawPhone, lineNumber, DateTimeOffset.UtcNow));
    }

    private async Task EmitLoopAsync(int seconds, CancellationToken ct)
    {
        var rng = new Random();
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(seconds), ct);
            }
            catch (OperationCanceledException) { return; }

            var phone = $"05{rng.Next(300000000, 599999999)}";
            EmitForTest(phone, lineNumber: 1);
        }
    }

    public ValueTask DisposeAsync()
    {
        _cts?.Dispose();
        return ValueTask.CompletedTask;
    }
}
