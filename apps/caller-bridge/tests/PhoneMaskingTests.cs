using RestoranPos.CallerBridge.Logging;
using Xunit;

namespace RestoranPos.CallerBridge.Tests;

public class PhoneMaskingTests
{
    [Theory]
    [InlineData("05551234567", "055******67")]
    [InlineData("02161234567", "021******67")]
    [InlineData("4412345678",  "441*****78")]
    public void Mask_LongPhone_RetainsPrefix3AndSuffix2(string input, string expected)
    {
        Assert.Equal(expected, PhoneMasking.Mask(input));
    }

    [Fact]
    public void Mask_Empty_ReturnsPlaceholder()
    {
        Assert.Equal("(empty)", PhoneMasking.Mask(""));
        Assert.Equal("(empty)", PhoneMasking.Mask(null));
        Assert.Equal("(empty)", PhoneMasking.Mask("   "));
    }

    [Theory]
    [InlineData("12", "**")]
    [InlineData("123", "***")]
    [InlineData("12345", "*****")]
    public void Mask_ShortPhone_FullyMasked(string input, string expected)
    {
        Assert.Equal(expected, PhoneMasking.Mask(input));
    }

    [Fact]
    public void Mask_DoesNotLeakMiddleDigits()
    {
        var masked = PhoneMasking.Mask("05551234567");
        // The middle "1234" must not appear in the masked output (KVKK).
        Assert.DoesNotContain("1234", masked);
        Assert.DoesNotContain("5512", masked);
    }
}
