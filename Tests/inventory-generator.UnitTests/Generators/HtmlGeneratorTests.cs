using System.Collections.Generic;
using System.Text;
using FluentAssertions;
using InventoryGenerator.Api.Generators;
using InventoryGenerator.Api.Models;
using Xunit;

namespace InventoryGenerator.UnitTests.Generators
{
    public class HtmlGeneratorTests
    {
        [Fact]
        public void GenerateDocument_ShouldReturnValidHtmlBytes()
        {
            // Arrange
            var generator = new HtmlGenerator();
            
            var attributes = new List<ProductAttribute>
            {
                new ProductAttribute { Name = "Product Name", Type = AttributeType.String },
                new ProductAttribute { Name = "Quantity", Type = AttributeType.Int }
            };

            var data = new List<Dictionary<string, object?>>
            {
                new Dictionary<string, object?>
                {
                    { "id", 1 },
                    { "Product Name", "Apples" },
                    { "Quantity", 15 }
                }
            };

            // Act
            var resultBytes = generator.GenerateDocument(data, attributes);
            var htmlString = Encoding.UTF8.GetString(resultBytes);

            // Assert
            resultBytes.Should().NotBeNullOrEmpty();
            htmlString.Should().Contain("Product Name");
            htmlString.Should().Contain("Apples");
            htmlString.Should().Contain("Quantity");
            htmlString.Should().Contain("15");
            htmlString.Should().Contain("<!DOCTYPE html>");
        }
    }
}
