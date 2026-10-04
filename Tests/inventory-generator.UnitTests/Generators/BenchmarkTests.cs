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
            // Note: GC.GetTotalMemory measures live managed heap difference, not total allocated bytes
            _output.WriteLine($"CSV (50k cells): Time={swCsv.ElapsedMilliseconds}ms, Size={csvBytes.Length / 1024.0:F1}KB, LiveManagedHeapDelta={(memAfterCsv - memBeforeCsv) / (1024.0 * 1024.0):F2}MB");

            // HTML
            GC.Collect();
            var memBeforeHtml = GC.GetTotalMemory(true);
            var swHtml = Stopwatch.StartNew();
            var htmlBytes = new HtmlGenerator().GenerateDocument(data, attributes);
            swHtml.Stop();
            var memAfterHtml = GC.GetTotalMemory(false);
            _output.WriteLine($"HTML (50k cells): Time={swHtml.ElapsedMilliseconds}ms, Size={htmlBytes.Length / 1024.0:F1}KB, LiveManagedHeapDelta={(memAfterHtml - memBeforeHtml) / (1024.0 * 1024.0):F2}MB");

            // DOCX (streaming OpenXmlWriter)
            GC.Collect();
            var memBeforeDocx = GC.GetTotalMemory(true);
            var swDocx = Stopwatch.StartNew();
            var docxBytes = new DocxGenerator().GenerateDocument(data, attributes);
            swDocx.Stop();
            var memAfterDocx = GC.GetTotalMemory(false);
            _output.WriteLine($"DOCX (50k cells): Time={swDocx.ElapsedMilliseconds}ms, Size={docxBytes.Length / 1024.0:F1}KB, LiveManagedHeapDelta={(memAfterDocx - memBeforeDocx) / (1024.0 * 1024.0):F2}MB");

            csvBytes.Should().NotBeNullOrEmpty();
            htmlBytes.Should().NotBeNullOrEmpty();
            docxBytes.Should().NotBeNullOrEmpty();
        }

        [Fact]
        public async Task Benchmark_ThreeConcurrentSlots_DistinctPayloads()
        {
            // Test 3 concurrent generations under the production 3-slot cap using separate datasets
            // Shapes tested:
            // 1. Wide table (50 cols x 1,000 rows = 50,000 cells)
            // 2. Long table (10 cols x 5,000 rows = 50,000 cells)
            // 3. Dense text table (25 cols x 1,000 rows = 25,000 cells with larger text)

            var (attrsWide, dataWide) = GenerateDataset(50, 1000, 20);
            var (attrsLong, dataLong) = GenerateDataset(10, 5000, 20);
            var (attrsDense, dataDense) = GenerateDataset(25, 1000, 200);

            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();

            var proc = Process.GetCurrentProcess();
            proc.Refresh();
            var wsBefore = proc.WorkingSet64;

            var sw = Stopwatch.StartNew();
            var task1 = Task.Run(() => new DocxGenerator().GenerateDocument(dataWide, attrsWide));
            var task2 = Task.Run(() => new DocxGenerator().GenerateDocument(dataLong, attrsLong));
            var task3 = Task.Run(() => new DocxGenerator().GenerateDocument(dataDense, attrsDense));

            var results = await Task.WhenAll(task1, task2, task3);
            sw.Stop();

            proc.Refresh();
            var wsAfter = proc.WorkingSet64;
            double wsAfterMb = wsAfter / (1024.0 * 1024.0);
            double wsDeltaMb = (wsAfter - wsBefore) / (1024.0 * 1024.0);

            _output.WriteLine($"3 CONCURRENT DOCX (Distinct legal shapes: wide 50x1k, long 10x5k, dense 25x1k): Time={sw.ElapsedMilliseconds}ms, ProcessWorkingSetAfterCompletion={wsAfterMb:F2}MB, WorkingSetDelta={wsDeltaMb:F2}MB");

            foreach (var docx in results)
            {
                docx.Should().NotBeNullOrEmpty();
            }
        }

        private static (List<ProductAttribute> attributes, List<Dictionary<string, object?>> data) GenerateDataset(int cols, int rows, int stringLength)
        {
            var attributes = new List<ProductAttribute>(cols);
            for (int c = 0; c < cols; c++)
            {
                attributes.Add(new ProductAttribute
                {
                    Name = $"Col_{c + 1}",
                    Type = c % 2 == 0 ? AttributeType.String : AttributeType.Int,
                    ColumnWidth = 800
                });
            }

            string sampleText = new string('x', Math.Max(1, stringLength));
            var data = new List<Dictionary<string, object?>>(rows);
            for (int r = 0; r < rows; r++)
            {
                var row = new Dictionary<string, object?>(cols);
                for (int c = 0; c < cols; c++)
                {
                    row[$"Col_{c + 1}"] = c % 2 == 0 ? $"{sampleText}_{r}_{c}" : r * 10;
                }
                data.Add(row);
            }

            return (attributes, data);
        }
    }
}
