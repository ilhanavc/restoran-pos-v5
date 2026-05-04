using System.Threading.Channels;
using RestoranPos.CallerBridge.Devices;
using RestoranPos.CallerBridge.Http;
using RestoranPos.CallerBridge.Logging;

namespace RestoranPos.CallerBridge.Workers;

/// <summary>
/// Hosts the caller-id device, queues raw events into a bounded channel, and forwards
/// each event to the API via <see cref="IBridgeApiClient"/>. Decoupling via channel
/// keeps the device poll thread responsive when the network is slow.
/// </summary>
public sealed class CallerBridgeWorker : BackgroundService
{
    private readonly ICallerIdDevice _device;
    private readonly IBridgeApiClient _api;
    private readonly ILogger<CallerBridgeWorker> _logger;
    private readonly Channel<IncomingCallEvent> _queue;

    public CallerBridgeWorker(
        ICallerIdDevice device,
        IBridgeApiClient api,
        ILogger<CallerBridgeWorker> logger)
    {
        _device = device;
        _api = api;
        _logger = logger;
        _queue = Channel.CreateBounded<IncomingCallEvent>(new BoundedChannelOptions(128)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _device.CallReceived += OnCallReceived;
        await _device.StartAsync(stoppingToken);
        _logger.LogInformation("CallerBridgeWorker started");

        try
        {
            await foreach (var evt in _queue.Reader.ReadAllAsync(stoppingToken))
            {
                await _api.PostIncomingAsync(evt, stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // graceful shutdown
        }
        finally
        {
            _device.CallReceived -= OnCallReceived;
            await _device.StopAsync(CancellationToken.None);
            _logger.LogInformation("CallerBridgeWorker stopped");
        }
    }

    private void OnCallReceived(object? sender, IncomingCallEvent evt)
    {
        _logger.LogInformation(
            "Ring detected (phone={Masked} line={Line})",
            PhoneMasking.Mask(evt.RawPhone), evt.LineNumber);
        _queue.Writer.TryWrite(evt);
    }
}
