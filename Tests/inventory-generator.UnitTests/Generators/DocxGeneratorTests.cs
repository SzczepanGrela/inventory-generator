using System.Collections.Generic;
using System.IO;
using System.Linq;
using DocumentFormat.OpenXml.Packaging;
using FluentAssertions;
using InventoryGenerator.Api.Generators;
using InventoryGenerator.Api.Models;
using Xunit;

namespace InventoryGenerator.UnitTests.Generators
{
    public class DocxGeneratorTests
    {
        private readonly DocxGenerator _generator = new();

        [Fact]
        public void GenerateDocument_ShouldStripInvalidXmlControlCharacters_AndProduceReadableDocument()
        {
            var attributes = new List<ProductAttribute>
            {
                new ProductAttribute { Name = "Item\x00\x08Name", Type = AttributeType.String, ColumnWidth = 1000 }
            };
            var data = new List<Dictionary<string, object?>>
            {
                new() { { "Item\x00\x08Name", "Product\x00\x01\x0B\x0C\x1FValid" } }
            };

            var bytes = _generator.GenerateDocument(data, attributes);

            bytes.Should().NotBeNullOrEmpty();

            // Verify document can be opened and parsed by OpenXML SDK without corruption
            using var mem = new MemoryStream(bytes);
            using var doc = WordprocessingDocument.Open(mem, false);
            doc.MainDocumentPart.Should().NotBeNull();
            doc.MainDocumentPart!.Document.Should().NotBeNull();
            var body = doc.MainDocumentPart.Document.Body;
            body.Should().NotBeNull();
            var text = body!.InnerText;
            text.Should().Contain("ItemName");
            text.Should().Contain("ProductValid");
            text.Should().NotContain("\x00");
            text.Should().NotContain("\x08");
        }

        [Fact]
        public void GenerateDocument_ShouldPreservePolishCharacters()
        {
            var attributes = new List<ProductAttribute>
            {
                new ProductAttribute { Name = "Nazwa Towaru", Type = AttributeType.String, ColumnWidth = 1000 }
            };
            var data = new List<Dictionary<string, object?>>
            {
                new() { { "Nazwa Towaru", "Zażółć gęślą jaźń" } }
            };

            var bytes = _generator.GenerateDocument(data, attributes);

            using var mem = new MemoryStream(bytes);
            using var doc = WordprocessingDocument.Open(mem, false);
            doc.MainDocumentPart.Should().NotBeNull();
            doc.MainDocumentPart!.Document.Should().NotBeNull();
            var text = doc.MainDocumentPart.Document.Body?.InnerText;
            text.Should().Contain("Zażółć gęślą jaźń");
        }
    }
}
