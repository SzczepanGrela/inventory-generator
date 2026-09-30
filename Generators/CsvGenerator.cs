using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using InventoryGenerator.Api.Models;
using InventoryGenerator.Api.Services;

namespace InventoryGenerator.Api.Generators
{
    public class CsvGenerator : IDocumentGenerator
    {
        private static readonly char[] FormulaCharacters = { '=', '+', '-', '@', '\t', '\r', '%' };

        public byte[] GenerateDocument(List<Dictionary<string, object?>> data, List<ProductAttribute> attributes)
        {
            var columnHeaders = attributes.Select(a => a.Name).ToList();
            var sb = new StringBuilder();

            // Header row with formula sanitization and escaping
            var escapedHeaders = columnHeaders.Select(h => EscapeCsvField(SanitizeFormula(h)));
            sb.AppendLine(string.Join(";", escapedHeaders));

            // Data rows
            foreach (var row in data)
            {
                var values = columnHeaders.Select(header =>
                {
                    object? val = row.TryGetValue(header, out var v) ? v : null;
                    string str = ValueHelper.ExtractScalarString(val);
                    string sanitized = SanitizeFormula(str, val);
                    return EscapeCsvField(sanitized);
                });
                sb.AppendLine(string.Join(";", values));
            }

            byte[] bom = Encoding.UTF8.GetPreamble();
            byte[] content = Encoding.UTF8.GetBytes(sb.ToString());
            return bom.Concat(content).ToArray();
        }

        public static string SanitizeFormula(string value, object? rawValue = null)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            char firstChar = value[0];
            if (FormulaCharacters.Contains(firstChar))
            {
                if (firstChar == '+' || firstChar == '-')
                {
                    if (IsLegitimateNumber(value, rawValue))
                    {
                        return value;
                    }
                }

                return "'" + value;
            }

            return value;
        }

        private static bool IsLegitimateNumber(string value, object? rawValue)
        {
            if (rawValue != null && ValueHelper.IsNumeric(rawValue))
            {
                return true;
            }

            return double.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out _)
                || decimal.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out _);
        }

        public static string EscapeCsvField(string field)
        {
            if (string.IsNullOrEmpty(field))
            {
                return string.Empty;
            }

            if (field.Contains(';') || field.Contains('"') || field.Contains('\n') || field.Contains('\r'))
            {
                return "\"" + field.Replace("\"", "\"\"") + "\"";
            }

            return field;
        }
    }
}
