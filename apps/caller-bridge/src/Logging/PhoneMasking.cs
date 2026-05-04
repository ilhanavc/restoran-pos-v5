namespace RestoranPos.CallerBridge.Logging;

/// <summary>
/// KVKK: never log full phone numbers. Mask all but first 3 and last 2 digits.
///   "05551234567" -> "055******67"
///   ""            -> "(empty)"
///   "12"          -> "**" (too short to identify)
/// </summary>
public static class PhoneMasking
{
    public static string Mask(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return "(empty)";
        var digits = phone.Trim();
        if (digits.Length <= 5) return new string('*', digits.Length);
        var prefix = digits[..3];
        var suffix = digits[^2..];
        var middle = new string('*', digits.Length - 5);
        return prefix + middle + suffix;
    }
}
