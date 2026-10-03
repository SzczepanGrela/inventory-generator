using System;
using System.Collections.Generic;
using System.Diagnostics;
using FluentAssertions;
using InventoryGenerator.Api.Generators;
using InventoryGenerator.Api.Models;
using Xunit;
using Xunit.Abstractions;

namespace InventoryGenerator.UnitTests.Generators
{
    public class BenchmarkTests
    {
        private readonly ITestOutputHelper _output;

        public BenchmarkTests(ITestOutputHelper output)
        {
            _output = output;
        }

        [Fact]
        public void Benchmark_MaxCapacity_Docx_Csv_Html()
        {
            // Max allowed cells: 50,000
            int cols = 50;
            int rows = 1000;

            var attributes = new List<ProductAttribute>();
            for (int c = 0; c < cols; c++)
            {
                attributes.Add(new ProductAttribute
                {
                    Name = $"Column_{c + 1}",
                    Type = c % 2 == 0 ? AttributeType.String : AttributeType.Int,
                    ColumnWidth = 800
                });
            }

            var data = new List<Dictionary<string, object?>>(rows);
            for (int r = 0; r < rows; r++)
            {
                var row = new Dictionary<string, object?>(cols);
                for (int c = 0; c < cols; c++)
                {
                    row[$"Column_{c + 1}"] = c % 2 == 0 ? $"Val_{r}_{c}" : r * 10;
                }
                data.Add(row);
            }

            // CSV
            GC.Collect();
            var memBeforeCsv = GC.GetTotalMemory(true);
            var swCsv = Stopwatch.StartNew();
            var csvBytes = new CsvGenerator().GenerateDocument(data, attributes);
            swCsv.Stop();
            var memAfterCsv = GC.GetTotalMemory(false);
            _output.WriteLine($"CSV (50k cells): Time={swCsv.ElapsedMilliseconds}ms, Size={csvBytes.Length / 1024.0:F1}KB, AllocatedRAM={(memAfterCsv - memBeforeCsv) / (1024.0 * 1024.0):F2}MB");

            // HTML
            GC.Collect();
            var memBeforeHtml = GC.GetTotalMemory(true);
            var swHtml = Stopwatch.StartNew();
            var htmlBytes = new HtmlGenerator().GenerateDocument(data, attributes);
            swHtml.Stop();
            var memAfterHtml = GC.GetTotalMemory(false);
            _output.WriteLine($"HTML (50k cells): Time={swHtml.ElapsedMilliseconds}ms, Size={htmlBytes.Length / 1024.0:F1}KB, AllocatedRAM={(memAfterHtml - memBeforeHtml) / (1024.0 * 1024.0):F2}MB");

            // DOCX
            GC.Collect();
            var memBeforeDocx = GC.GetTotalMemory(true);
            var swDocx = Stopwatch.StartNew();
            var docxBytes = new DocxGenerator().GenerateDocument(data, attributes);
            swDocx.Stop();
            var memAfterDocx = GC.GetTotalMemory(false);
            _output.WriteLine($"DOCX (50k cells): Time={swDocx.ElapsedMilliseconds}ms, Size={docxBytes.Length / 1024.0:F1}KB, AllocatedRAM={(memAfterDocx - memBeforeDocx) / (1024.0 * 1024.0):F2}MB");

            csvBytes.Should().NotBeNullOrEmpty();
            htmlBytes.Should().NotBeNullOrEmpty();
            docxBytes.Should().NotBeNullOrEmpty();
        }
    }
}
