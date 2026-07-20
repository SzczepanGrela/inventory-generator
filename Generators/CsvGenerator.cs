using System.Collections.Generic;
using System.Linq;
using System.Text;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.Api.Generators
{
    public class CsvGenerator : IDocumentGenerator
    {
        public byte[] GenerateDocument(List<Dictionary<string, object?>> data, List<ProductAttribute> attributes)
        {
            var columnHeaders = attributes.Select(a => a.Name).ToList();
            var sb = new StringBuilder();
            
            // Header
            sb.AppendLine(string.Join(";", columnHeaders));
            
            // Rows
            foreach (var row in data)
            {
                var values = columnHeaders.Select(header => {
                    object? val = row.ContainsKey(header) ? row[header] : "";
                    string str = val?.ToString() ?? string.Empty;
                    
                    if (str.Contains(";") || str.Contains("\"") || str.Contains("\n") || str.Contains("\r"))
                    {
                        str = "\"" + str.Replace("\"", "\"\"") + "\"";
                    }
                    return str;
                });
                sb.AppendLine(string.Join(";", values));
            }
            
            byte[] bom = Encoding.UTF8.GetPreamble();
            byte[] content = Encoding.UTF8.GetBytes(sb.ToString());
            return bom.Concat(content).ToArray();
        }
    }
}
