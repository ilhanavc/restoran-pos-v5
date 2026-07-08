using System.Runtime.InteropServices;

namespace SpoolerRaw;

/// <summary>
/// ADR-004 Amendment 4 — Windows Spooler RAW pass-through yardımcısı.
///
/// stdin'den ham byte akışını okur, argv[0]'daki Windows print queue'suna
/// winspool RAW datatype ile yazar. Byte üretimi/format Print Agent (Node)
/// tarafında; bu yardımcı yalnız opaque byte'ları HAM yazar ("dumb writer",
/// ADR-004). Text decode YOK — CP857/ESC-POS byte'ları olduğu gibi geçer.
///
/// Win32 zinciri: OpenPrinter → StartDocPrinter(DOC_INFO_1{ pDatatype="RAW" })
/// → StartPagePrinter → WritePrinter(stdin) → EndPagePrinter → EndDocPrinter
/// → ClosePrinter. S87'de POS-80'de ampirik doğrulandı (davranış referans;
/// kod sıfırdan yazıldı, kopya değil).
///
/// Exit kodları (agent spooler-transport.ts §5 → SPOOLER_ERROR_* eşlemesi):
///   0 = başarı
///   1 = kullanım hatası (printerName argümanı yok)
///   2 = PRINTER_NOT_FOUND (OpenPrinter fail, Win32 != ACCESS_DENIED)
///   3 = ACCESS_DENIED     (Win32 ERROR_ACCESS_DENIED 5)
///   4 = WRITE             (StartDoc/StartPage/WritePrinter/EndDoc fail)
/// Win32 hata detayı stderr'e yazılır (agent mesaja ekler).
/// </summary>
internal static class Program
{
    private const int ExitOk = 0;
    private const int ExitUsage = 1;
    private const int ExitPrinterNotFound = 2;
    private const int ExitAccessDenied = 3;
    private const int ExitWrite = 4;

    private const int ErrorAccessDenied = 5;

    private static int Main(string[] args)
    {
        if (args.Length < 1 || string.IsNullOrWhiteSpace(args[0]))
        {
            Console.Error.WriteLine(
                "kullanim: spooler-raw.exe <printerName>  (byte'lar stdin'den)");
            return ExitUsage;
        }

        string printerName = args[0];

        // stdin'den TÜM byte'ları oku (fiş birkaç KB; binary — decode YOK).
        byte[] data;
        using (Stream stdin = Console.OpenStandardInput())
        using (var buffer = new MemoryStream())
        {
            stdin.CopyTo(buffer);
            data = buffer.ToArray();
        }

        if (!OpenPrinter(printerName, out IntPtr hPrinter, IntPtr.Zero))
        {
            int err = Marshal.GetLastWin32Error();
            Console.Error.WriteLine($"OpenPrinter('{printerName}') basarisiz, Win32={err}");
            return err == ErrorAccessDenied ? ExitAccessDenied : ExitPrinterNotFound;
        }

        try
        {
            var docInfo = new DocInfo1
            {
                pDocName = "Restoran POS RAW",
                pOutputFile = null,
                pDatatype = "RAW",
            };

            // StartDocPrinterW job id döner; 0 = başarısız.
            if (StartDocPrinter(hPrinter, 1, in docInfo) == 0)
            {
                return WriteFail("StartDocPrinter");
            }

            if (!StartPagePrinter(hPrinter))
            {
                int code = WriteFail("StartPagePrinter");
                EndDocPrinter(hPrinter);
                return code;
            }

            // WritePrinter kısmi yazabilir → tamamı gidene kadar döngü.
            GCHandle handle = GCHandle.Alloc(data, GCHandleType.Pinned);
            try
            {
                IntPtr basePtr = handle.AddrOfPinnedObject();
                int total = 0;
                while (total < data.Length)
                {
                    IntPtr chunk = IntPtr.Add(basePtr, total);
                    if (!WritePrinter(hPrinter, chunk, data.Length - total, out int written)
                        || written <= 0)
                    {
                        int code = WriteFail($"WritePrinter ({total}/{data.Length})");
                        EndPagePrinter(hPrinter);
                        EndDocPrinter(hPrinter);
                        return code;
                    }
                    total += written;
                }
            }
            finally
            {
                handle.Free();
            }

            EndPagePrinter(hPrinter);
            EndDocPrinter(hPrinter);
            return ExitOk;
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }

    /// <summary>Win32 hatasını stderr'e yazıp WRITE/ACCESS_DENIED exit'e çevirir.</summary>
    private static int WriteFail(string where)
    {
        int err = Marshal.GetLastWin32Error();
        Console.Error.WriteLine($"{where} basarisiz, Win32={err}");
        return err == ErrorAccessDenied ? ExitAccessDenied : ExitWrite;
    }

    // ----- winspool.drv P/Invoke (Unicode; NativeAOT compile-time marshalling) -----

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocInfo1
    {
        public string? pDocName;
        public string? pOutputFile;
        public string? pDatatype;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true,
        CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter,
        IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true,
        CharSet = CharSet.Unicode)]
    private static extern int StartDocPrinter(IntPtr hPrinter, int level,
        in DocInfo1 pDocInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBuf, int cbBuf,
        out int pcWritten);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);
}
