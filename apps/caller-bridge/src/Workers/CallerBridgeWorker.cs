using System.Threading.Channels;
using Microsoft.Extensions.Options;
using RestoranPos.CallerBridge.Configuration;
using RestoranPos.CallerBridge.Devices;
using RestoranPos.CallerBridge.Http;
using RestoranPos.CallerBridge.Logging;
using RestoranPos.CallerBridge.Usb;

namespace RestoranPos.CallerBridge.Workers;

/// <summary>
/// Hosts the caller-id device, queues raw events into a bounded channel, and forwards
/// each event to the API via <see cref="IBridgeApiClient"/>. Decoupling via channel
/// keeps the device poll thread responsive when the network is slow.
///
/// Also drives the ADR-016 §12 Amd4 USB-resilience layers: applies K1 selective-suspend
/// prevention at startup and runs the K2/K3 presence-poll watchdog alongside the queue reader.
/// The resilience dependencies are optional so existing unit tests can construct the worker
/// with just device+api+logger.
/// </summary>
public sealed class CallerBridgeWorker : BackgroundService
{
    private readonly ICallerIdDevice _device;
    private readonly IBridgeApiClient _api;
    private readonly ILogger<CallerBridgeWorker> _logger;
    private readonly IUsbPowerManager? _usbPowerManager;
    private readonly UsbWatchdog? _watchdog;
    private readonly BridgeOptions _options;
    private readonly Channel<IncomingCallEvent> _queue;

    public CallerBridgeWorker(
        ICallerIdDevice device,
        IBridgeApiClient api,
        ILogger<CallerBridgeWorker> logger,
        IUsbPowerManager? usbPowerManager = null,
        UsbWatchdog? watchdog = null,
        IOptions<BridgeOptions>? options = null)
    {
        _device = device;
        _api = api;
        _logger = logger;
        _usbPowerManager = usbPowerManager;
        _watchdog = watchdog;
        _options = options?.Value ?? new BridgeOptions();
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
        _device.NativeActivity += OnNativeActivity;
        try
        {
            // K1 — prevention runs BEFORE the device opens so the machine cannot suspend the
            // port during registration. Best-effort: never throws (see IUsbPowerManager).
            if (_usbPowerManager is not null && _options.UsbResilienceEnabled
                && _options.DisableUsbSelectiveSuspend)
            {
                await _usbPowerManager.ApplyResilienceSettingsAsync(_options.DeviceHardwareId, stoppingToken);
            }

            try
            {
                await _device.StartAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Normal durdurma sırasında StartAsync iptal edilirse (gelecekte
                // ct-duyarlı bir device) 'başlatılamadı' ERROR'u değil, dış
                // graceful-shutdown dalı devralsın.
                throw;
            }
            catch (Exception ex)
            {
                // C12-ROB-01 — interop/cid.dll başlatma hatası host'u SESSİZCE
                // öldürmesin: .NET 8 default StopHost host'u durdurur ama
                // Program.cs üst-catch bunu YAKALAMAZ (temiz-çıkış gibi döner) →
                // SCM restart etmeyebilir = sessiz-ölüm. Açık operatör-logu +
                // graceful çıkış; finally yine çalışır (cleanup).
                _logger.LogError(ex,
                    "Cihaz başlatılamadı — Caller Bridge çağrı yakalayamayacak (cid.dll/USB kontrol edin): {Message}",
                    ex.Message);
                return;
            }
            _logger.LogInformation("CallerBridgeWorker started");

            // K2/K3 — run the presence-poll watchdog alongside the queue reader. It self-gates
            // (no-op when resilience is off or no hardware-id) and stops the host on a detected
            // break so Windows Service recovery restarts the process (restart-only, K6).
            var watchdogTask = _watchdog?.RunAsync(stoppingToken) ?? Task.CompletedTask;

            await foreach (var evt in _queue.Reader.ReadAllAsync(stoppingToken))
            {
                await _api.PostIncomingAsync(evt, stoppingToken);
            }

            await watchdogTask;
        }
        catch (OperationCanceledException)
        {
            // graceful shutdown
        }
        finally
        {
            _device.CallReceived -= OnCallReceived;
            _device.NativeActivity -= OnNativeActivity;
            await _device.StopAsync(CancellationToken.None);
            _logger.LogInformation("CallerBridgeWorker stopped");
        }
    }

    // K2b — forward every native callback to the watchdog as a positive-liveness beat.
    private void OnNativeActivity(object? sender, EventArgs e) => _watchdog?.RecordNativeActivity();

    private void OnCallReceived(object? sender, IncomingCallEvent evt)
    {
        _logger.LogInformation(
            "Ring detected (phone={Masked} line={Line})",
            PhoneMasking.Mask(evt.RawPhone), evt.LineNumber);
        _queue.Writer.TryWrite(evt);
    }
}
