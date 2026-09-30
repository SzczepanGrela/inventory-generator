using System.Collections.Generic;
using System.Text;
using FluentAssertions;
using InventoryGenerator.Api.Generators;
using InventoryGenerator.Api.Models;
using Xunit;

namespace InventoryGenerator.UnitTests.Generators
{
    public class CsvGeneratorTests
    {
        private readonly CsvGenerator _generator = new();

        [Fact]
        public void GenerateDocument_ShouldIncludeUtf8Bom()
        {
            var attributes = new List<ProductAttribute>
            {
                new ProductAttribute { Name = "Item", Type = AttributeType.String }
            };
            var data = new List<Dictionary<string, object?>>
            {
                new() { { "Item", "Test" } }
            };

            var bytes = _generator.GenerateDocument(data, attributes);

            bytes.Should().StartWith(new byte[] { 0xEF, 0xBB, 0xBF });
        }

        [Theory]
        [InlineData("=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0")]
        [InlineData("@SUM(A1:A10)", "'@SUM(A1:A10)")]
        [InlineData("+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0")]
        [InlineData("-cmd|' /C calc'!A0", "'-cmd|' /C calc'!A0")]
        [InlineData("\t=1+1", "'\t=1+1")]
        [InlineData("\r=1+1", "'\r=1+1")]
        [InlineData("%=1+1", "'%=1+1")]
        public void SanitizeFormula_ShouldNeutralizeDangerousFormulas(string input, string expected)
        {
            var sanitized = CsvGenerator.SanitizeFormula(input);
            sanitized.Should().Be(expected);
        }

        [Theory]
        [InlineData("-5", "-5")]
        [InlineData("-10.5", "-10.5")]
        [InlineData("-0.01", "-0.01")]
        [InlineData("+42", "+42")]
        [InlineData("+3.14159", "+3.14159")]
        public void SanitizeFormula_ShouldPreserveLegitimateNumbers(string input, string expected)
        {
            var sanitized = CsvGenerator.SanitizeFormula(input);
            sanitized.Should().Be(expected);
        }

        [Theory]
        [InlineData("simple", "simple")]
        [InlineData("field;with;semicolon", "\"field;with;semicolon\"")]
        [InlineData("field \"with\" quotes", "\"field \"\"with\"\" quotes\"")]
        [InlineData("field\nwith\nnewline", "\"field\nwith\nnewline\"")]
        [InlineData("field\rwith\rcarriage", "\"field\rwith\rcarriage\"")]
        public void EscapeCsvField_ShouldEscapeSpecialCharacters(string input, string expected)
        {
            var escaped = CsvGenerator.EscapeCsvField(input);
            escaped.Should().Be(expected);
        }

        [Fact]
        public void GenerateDocument_ShouldSanitizeAndEscapeHeaders()
        {
            var attributes = new List<ProductAttribute>
            {
                new ProductAttribute { Name = "=Formula;Header", Type = AttributeType.String },
                new ProductAttribute { Name = "Header with \"quotes\"", Type = AttributeType.String }
            };
            var data = new List<Dictionary<string, object?>>();

            var bytes = _generator.GenerateDocument(data, attributes);
            var content = Encoding.UTF8.GetString(bytes);

            content.Should().Contain("\"'=Formula;Header\"");
            content.Should().Contain("\"Header with \"\"quotes\"\"\"");
        }

        [Fact]
        public void GenerateDocument_ShouldPreservePolishCharacters()
        {
            var attributes = new List<ProductAttribute>
            {
                new ProductAttribute { Name = "Zażółć gęślą jaźń", Type = AttributeType.String }
            };
            var data = new List<Dictionary<string, object?>>
            {
                new() { { "Zażółć gęślą jaźń", "Pchnąć w tę łódź jeża lub ośm skrzyń fig" } }
            };

            var bytes = _generator.GenerateDocument(data, attributes);
            var content = Encoding.UTF8.GetString(bytes);

            content.Should().Contain("Zażółć gęślą jaźń");
            content.Should().Contain("Pchnąć w tę łódź jeża lub ośm skrzyń fig");
        }
    }
}
