using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.Api.Generators
{
    public class HtmlGenerator : IDocumentGenerator
    {
        public byte[] GenerateDocument(List<Dictionary<string, object?>> data, List<ProductAttribute> attributes)
        {
            var columnHeaders = attributes.Select(a => a.Name).ToList();
            var columnWidths = attributes.Select(a => a.ColumnWidth).ToList();

            var sb = new StringBuilder();
            sb.AppendLine("<!DOCTYPE html>");
            sb.AppendLine("<html lang=\"en\">");
            sb.AppendLine("<head>");
            sb.AppendLine("  <meta charset=\"UTF-8\">");
            sb.AppendLine("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
            sb.AppendLine("  <title>Inventory Report</title>");
            sb.AppendLine("  <style>");
            sb.AppendLine("    body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; margin: 2rem; background-color: #f8f9fa; color: #333333; }");
            sb.AppendLine("    .container { max-width: 1000px; margin: 0 auto; background: #ffffff; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }");
            sb.AppendLine("    h1 { text-align: center; color: #2c3e50; margin-bottom: 1.5rem; font-weight: 600; }");
            sb.AppendLine("    .table-responsive { overflow-x: auto; }");
            sb.AppendLine("    table { width: 100%; border-collapse: collapse; margin-top: 1rem; table-layout: fixed; }");
            sb.AppendLine("    th, td { padding: 10px 14px; border: 1px solid #e0e0e0; text-align: left; word-wrap: break-word; font-size: 14px; }");
            sb.AppendLine("    th { background-color: #D9E2F3; color: #2c3e50; font-weight: 600; }");
            sb.AppendLine("    tr:nth-child(even) { background-color: #fcfcfc; }");
            sb.AppendLine("    tr:hover { background-color: #f1f5f9; }");
            sb.AppendLine("    .text-right { text-align: right; }");
            sb.AppendLine("    .bold { font-weight: bold; }");
            sb.AppendLine("    .italic { font-style: italic; }");
            sb.AppendLine("    .underline { text-decoration: underline; }");
            sb.AppendLine("  </style>");
            sb.AppendLine("</head>");
            sb.AppendLine("<body>");
            sb.AppendLine("  <div class=\"container\">");
            sb.AppendLine("    <h1>Inventory Report</h1>");
            sb.AppendLine("    <div class=\"table-responsive\">");
            sb.AppendLine("      <table>");
            sb.AppendLine("        <colgroup>");
            
            int totalInputWidth = columnWidths.Sum();
            foreach (int width in columnWidths)
            {
                double pct = totalInputWidth > 0 ? (double)width / totalInputWidth * 100 : 100.0 / columnWidths.Count;
                sb.AppendLine($"          <col style=\"width: {pct:F2}%;\">");
            }
            
            sb.AppendLine("        </colgroup>");
            
            sb.AppendLine("        <thead>");
            sb.AppendLine("          <tr>");
            foreach (var header in columnHeaders)
            {
                sb.AppendLine($"            <th>{WebUtility.HtmlEncode(header)}</th>");
            }
            sb.AppendLine("          </tr>");
            sb.AppendLine("        </thead>");
            
            sb.AppendLine("        <tbody>");
            foreach (var row in data)
            {
                sb.AppendLine("          <tr>");
                for (int i = 0; i < attributes.Count; i++)
                {
                    var attr = attributes[i];
                    string header = attr.Name;
                    object? val = row.ContainsKey(header) ? row[header] : "";
                    string str = val?.ToString() ?? string.Empty;
                    
                    bool alignRight = IsNumeric(val);
                    var classes = new List<string>();
                    if (alignRight) classes.Add("text-right");
                    if (attr.IsBold) classes.Add("bold");
                    if (attr.IsItalic) classes.Add("italic");
                    if (attr.IsUnderline) classes.Add("underline");
                    
                    string classAttr = classes.Count > 0 ? $"class=\"{string.Join(" ", classes)}\"" : "";
                    
                    sb.AppendLine($"            <td {classAttr}>{WebUtility.HtmlEncode(str)}</td>");
                }
                sb.AppendLine("          </tr>");
            }
            sb.AppendLine("        </tbody>");
            sb.AppendLine("      </table>");
            sb.AppendLine("    </div>");
            sb.AppendLine("  </div>");
            sb.AppendLine("</body>");
            sb.AppendLine("</html>");
            
            return Encoding.UTF8.GetBytes(sb.ToString());
        }

        private bool IsNumeric(object? value)
        {
            if (value == null) return false;
            if (value is int || value is double || value is float || value is decimal || value is long || value is short) return true;
            string str = value.ToString() ?? "";
            if (string.IsNullOrWhiteSpace(str)) return false;
            return double.TryParse(str, out _) || int.TryParse(str, out _);
        }
    }
}
