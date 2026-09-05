using System.Runtime.InteropServices;
using Microsoft.Extensions.Hosting.WindowsServices;
using Polly;
using Polly.Extensions.Http;
using RestoranPos.CallerBridge.Configuration;
using RestoranPos.CallerBridge.Devices;
using RestoranPos.CallerBridge.Http;
using RestoranPos.CallerBridge.Usb;
using RestoranPos.CallerBridge.Workers;
using Serilog;

// Bootstrap logger so configuration errors surface to console.
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    // Windows Service olarak çalışırken working directory = C:\Windows\System32.
    // Serilog File sink görece yolları (logs/…) Directory.GetCurrentDirectory()'e
    // göre çözer → loglar System32\logs'a düşer (ContentRootPath'i kullanmaz).
    // CWD'yi exe klasörüne sabitle ki "logs/" servisin yanında (install-service.ps1'in
    // vaat ettiği yer) oluşsun.
    Directory.SetCurrentDirectory(AppContext.BaseDirectory);

    var options = new HostApplicationBuilderSettings
    {
        Args = args,
        ContentRootPath = AppContext.BaseDirectory,
    };

    var builder = Host.CreateApplicationBuilder(options);

    builder.Services.AddSerilog((sp, lc) => lc
        .ReadFrom.Configuration(builder.Configuration)
        .Enrich.FromLogContext());

    builder.Services.Configure<BridgeOptions>(
        builder.Configuration.GetSection(BridgeOptions.SectionName));

    builder.Services.AddHttpClient<IBridgeApiClient, BridgeApiClient>()
        .AddPolicyHandler(GetRetryPolicy());

    // Device + USB-resilience impls: real (Windows P/Invoke) vs mock/no-op (dev/test on Linux).
    // ADR-016 §12 Amd4: on non-Windows every resilience layer is a no-op.
    var useMock = builder.Configuration.GetValue<bool>("Bridge:UseMockDevice");
    if (useMock || !RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
    {
        builder.Services.AddSingleton<ICallerIdDevice, MockCallerIdDevice>();
        builder.Services.AddSingleton<IUsbPowerManager, NoOpUsbPowerManager>();
        builder.Services.AddSingleton<IDevicePresenceProbe, NoOpDevicePresenceProbe>();
    }
    else
    {
        builder.Services.AddSingleton<ICallerIdDevice, CidShowDevice>();
        builder.Services.AddSingleton<IUsbPowerManager, WindowsUsbPowerManager>();
        builder.Services.AddSingleton<IDevicePresenceProbe, WmiDevicePresenceProbe>();
    }

    builder.Services.AddSingleton<UsbWatchdog>();
    builder.Services.AddHostedService<CallerBridgeWorker>();

    // C12-ROB-01 — bir BackgroundService fault'u tüm host'u SESSİZCE durdurmasın
    // (.NET 8 default StopHost + üst-catch yakalamaz = sessiz-ölüm). Ignore ile
    // fault loglanır ve servis "Running" kalır (operatör log/health'ten görür).
    builder.Services.Configure<HostOptions>(o =>
        o.BackgroundServiceExceptionBehavior = BackgroundServiceExceptionBehavior.Ignore);

    // Windows Service support: name visible in services.msc.
    builder.Services.AddWindowsService(o =>
    {
        o.ServiceName = "restoran-pos-caller-bridge";
    });

    var host = builder.Build();
    await host.RunAsync();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Caller Bridge fatal startup error");
    throw;
}
finally
{
    await Log.CloseAndFlushAsync();
}

static IAsyncPolicy<HttpResponseMessage> GetRetryPolicy()
{
    // 3 retries with exponential backoff (1s, 2s, 4s) for transient HTTP errors.
    return HttpPolicyExtensions
        .HandleTransientHttpError()
        .WaitAndRetryAsync(3, attempt => TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)));
}
