using System;
using System.Collections.Generic;
using System.Text.Json;
using FluentAssertions;
using InventoryGenerator.Api.Models;
using InventoryGenerator.Api.Services;
using Xunit;

namespace InventoryGenerator.UnitTests.Services
{
    public class PayloadValidatorTests
    {
        [Fact]
        public void Validate_WithNullPayload_ReturnsError()
        {
            var result = PayloadValidator.Validate(null);
            result.Should().Be("Payload cannot be null.");
        }

        [Fact]
        public void Validate_WithNullOrEmptyAttributes_ReturnsError()
        {
            var payload = new ExportPayload { Attributes = null!, Products = new() };
            PayloadValidator.Validate(payload).Should().Be("Payload must contain at least one attribute.");

            payload = new ExportPayload { Attributes = new(), Products = new() };
            PayloadValidator.Validate(payload).Should().Be("Payload must contain at least one attribute.");
        }

        [Fact]
        public void Validate_WithNullProducts_ReturnsError()
        {
            var payload = new ExportPayload
            {
                Attributes = new() { new ProductAttribute { Name = "Col", Type = AttributeType.String } },
                Products = null!
            };
            PayloadValidator.Validate(payload).Should().Be("Products list cannot be null.");
        }

        [Fact]
        public void Validate_WithNullAttributeEntry_ReturnsError()
        {
            var payload = new ExportPayload
            {
                Attributes = new() { null! },
                Products = new()
            };
            PayloadValidator.Validate(payload).Should().Contain("Attribute definition at index 0 cannot be null.");
        }

        [Fact]
        public void Validate_WithNullProductEntry_ReturnsError()
        {
            var payload = new ExportPayload
            {
                Attributes = new() { new ProductAttribute { Name = "Col", Type = AttributeType.String } },
                Products = new() { null! }
            };
            PayloadValidator.Validate(payload).Should().Contain("Product entry at index 0 cannot be null.");
        }

        [Fact]
        public void Validate_WithOutOfRangeColumnWidth_ReturnsError()
        {
            var payload = new ExportPayload
            {
                Attributes = new() { new ProductAttribute { Name = "Col", Type = AttributeType.String, ColumnWidth = 30 } },
                Products = new()
            };
            PayloadValidator.Validate(payload).Should().Contain("column width must be between 50 and 5000");

            payload.Attributes[0].ColumnWidth = 6000;
            PayloadValidator.Validate(payload).Should().Contain("column width must be between 50 and 5000");
        }

        [Fact]
        public void Validate_WithInvalidAttributeTypeEnum_ReturnsError()
        {
            var payload = new ExportPayload
            {
                Attributes = new() { new ProductAttribute { Name = "Col", Type = (AttributeType)999 } },
                Products = new()
            };
            PayloadValidator.Validate(payload).Should().Contain("has an invalid type");
        }

        [Fact]
        public void Validate_WithFloatNaNOrInfinity_ReturnsError()
        {
            var payload = new ExportPayload
            {
                Attributes = new() { new ProductAttribute { Name = "Col", Type = AttributeType.Double } },
                Products = new()
                {
                    new DynamicProduct
                    {
                        Id = 1,
                        Attributes = new() { { "Col", double.NaN } }
                    }
                }
            };
            PayloadValidator.Validate(payload).Should().Contain("contains invalid floating point value");

            payload.Products[0].Attributes["Col"] = double.PositiveInfinity;
            PayloadValidator.Validate(payload).Should().Contain("contains invalid floating point value");
        }

        [Fact]
        public void Validate_WithValidPayload_ReturnsNull()
        {
            var payload = new ExportPayload
            {
                Attributes = new()
                {
                    new ProductAttribute { Name = "Col1", Type = AttributeType.String, ColumnWidth = 800 },
                    new ProductAttribute { Name = "Col2", Type = AttributeType.Enum, EnumValues = new() { "A", "B" }, ColumnWidth = 500 }
                },
                Products = new()
                {
                    new DynamicProduct
                    {
                        Id = 1,
                        Attributes = new() { { "Col1", "Value 1" }, { "Col2", "A" } }
                    }
                }
            };
            PayloadValidator.Validate(payload).Should().BeNull();
        }
    }
}
