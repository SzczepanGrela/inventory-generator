using System;
using System.Globalization;
using System.Text.Json;

namespace InventoryGenerator.Api.Services
{
    public static class ValueHelper
    {
        public static string ExtractScalarString(object? value)
        {
            if (value == null)
            {
                return string.Empty;
            }

            if (value is JsonElement element)
            {
                return element.ValueKind switch
                {
                    JsonValueKind.String => element.GetString() ?? string.Empty,
                    JsonValueKind.Number => element.GetRawText(),
                    JsonValueKind.True => "true",
                    JsonValueKind.False => "false",
                    JsonValueKind.Null or JsonValueKind.Undefined => string.Empty,
                    _ => element.ToString()
                };
            }

            if (value is double d)
            {
                return d.ToString(CultureInfo.InvariantCulture);
            }
            if (value is float f)
            {
                return f.ToString(CultureInfo.InvariantCulture);
            }
            if (value is decimal dec)
            {
                return dec.ToString(CultureInfo.InvariantCulture);
            }

            return value.ToString() ?? string.Empty;
        }

        public static bool IsNumeric(object? value)
        {
            if (value == null)
            {
                return false;
            }

            if (value is JsonElement element)
            {
                if (element.ValueKind == JsonValueKind.Number)
                {
                    return true;
                }
                if (element.ValueKind == JsonValueKind.String)
                {
                    var s = element.GetString();
                    return !string.IsNullOrWhiteSpace(s) &&
                           double.TryParse(s, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out _);
                }
                return false;
            }

            if (value is int or long or short or byte or uint or ulong or ushort or sbyte or double or float or decimal)
            {
                return true;
            }

            string str = value.ToString() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(str))
            {
                return false;
            }

            return double.TryParse(str, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out _);
        }
    }
}
