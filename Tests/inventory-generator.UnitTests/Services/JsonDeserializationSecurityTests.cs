using System.Collections.Generic;
using System.Text.Json;
using FluentAssertions;
using InventoryGenerator.Api.Models;
using InventoryGenerator.Api.Services;
using Xunit;

namespace InventoryGenerator.UnitTests.Services
{
    public class JsonDeserializationSecurityTests
    {
        [Fact]
        public void Validate_ShouldRejectNullPayload()
        {
            var error = PayloadValidator.Validate(null);
            error.Should().Be("Payload cannot be null.");
        }

        [Fact]
        public void Validate_ShouldRejectEmptyAttributes()
        {
            var payload = new ExportPayload
            {
                Attributes = new List<ProductAttribute>(),
                Products = new List<DynamicProduct>()
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().Contain("at least one attribute");
        }

        [Fact]
        public void Validate_ShouldRejectNestedObjectsInAttributes()
        {
            using var doc = JsonDocument.Parse("{\"nested\": {\"exploit\": 1}}");
            var payload = new ExportPayload
            {
                Attributes = new List<ProductAttribute>
                {
                    new() { Name = "Item", Type = AttributeType.String }
                },
                Products = new List<DynamicProduct>
                {
                    new()
                    {
                        Id = 1,
                        Attributes = new Dictionary<string, object?>
                        {
                            { "Item", doc.RootElement.GetProperty("nested") }
                        }
                    }
                }
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().NotBeNull();
            error.Should().Contain("scalar value");
            error.Should().Contain("Nested objects and arrays are forbidden");
        }

        [Fact]
        public void Validate_ShouldRejectNestedArraysInAttributes()
        {
            using var doc = JsonDocument.Parse("{\"list\": [1, 2, 3]}");
            var payload = new ExportPayload
            {
                Attributes = new List<ProductAttribute>
                {
                    new() { Name = "Item", Type = AttributeType.String }
                },
                Products = new List<DynamicProduct>
                {
                    new()
                    {
                        Id = 1,
                        Attributes = new Dictionary<string, object?>
                        {
                            { "Item", doc.RootElement.GetProperty("list") }
                        }
                    }
                }
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().NotBeNull();
            error.Should().Contain("scalar value");
            error.Should().Contain("Nested objects and arrays are forbidden");
        }

        [Theory]
        [InlineData("__proto__")]
        [InlineData("constructor")]
        [InlineData("prototype")]
        [InlineData("$type")]
        public void Validate_ShouldRejectForbiddenKeysInAttributes(string forbiddenKey)
        {
            var payload = new ExportPayload
            {
                Attributes = new List<ProductAttribute>
                {
                    new() { Name = forbiddenKey, Type = AttributeType.String }
                },
                Products = new List<DynamicProduct>()
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().NotBeNull();
            error.Should().Contain("is forbidden");
        }

        [Theory]
        [InlineData("__proto__")]
        [InlineData("constructor")]
        [InlineData("prototype")]
        [InlineData("$type")]
        public void Validate_ShouldRejectForbiddenKeysInProductAttributes(string forbiddenKey)
        {
            var payload = new ExportPayload
            {
                Attributes = new List<ProductAttribute>
                {
                    new() { Name = "Item", Type = AttributeType.String }
                },
                Products = new List<DynamicProduct>
                {
                    new()
                    {
                        Id = 1,
                        Attributes = new Dictionary<string, object?>
                        {
                            { forbiddenKey, "value" }
                        }
                    }
                }
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().NotBeNull();
            error.Should().Contain("is forbidden");
        }

        [Fact]
        public void Validate_ShouldEnforceColumnLimit()
        {
            var attributes = new List<ProductAttribute>();
            for (int i = 0; i < 51; i++)
            {
                attributes.Add(new ProductAttribute { Name = $"Col{i}", Type = AttributeType.String });
            }

            var payload = new ExportPayload
            {
                Attributes = attributes,
                Products = new List<DynamicProduct>()
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().NotBeNull();
            error.Should().Contain("maximum allowed columns (50)");
        }

        [Fact]
        public void Validate_ShouldEnforceRowLimit()
        {
            var products = new List<DynamicProduct>();
            for (int i = 0; i < 5001; i++)
            {
                products.Add(new DynamicProduct { Id = i, Attributes = new() });
            }

            var payload = new ExportPayload
            {
                Attributes = new List<ProductAttribute> { new() { Name = "Item", Type = AttributeType.String } },
                Products = products
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().NotBeNull();
            error.Should().Contain("maximum allowed rows (5000)");
        }

        [Fact]
        public void Validate_ShouldEnforceTotalCellsLimit()
        {
            var attributes = new List<ProductAttribute>();
            for (int i = 0; i < 20; i++)
            {
                attributes.Add(new ProductAttribute { Name = $"Col{i}", Type = AttributeType.String });
            }

            var products = new List<DynamicProduct>();
            for (int i = 0; i < 2600; i++) // 20 * 2600 = 52,000 cells > 50,000
            {
                products.Add(new DynamicProduct { Id = i, Attributes = new() });
            }

            var payload = new ExportPayload
            {
                Attributes = attributes,
                Products = products
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().NotBeNull();
            error.Should().Contain("maximum allowed total cells (50000)");
        }

        [Fact]
        public void Validate_ShouldEnforceCellValueLengthLimit()
        {
            var longString = new string('A', 1001);
            var payload = new ExportPayload
            {
                Attributes = new List<ProductAttribute> { new() { Name = "Item", Type = AttributeType.String } },
                Products = new List<DynamicProduct>
                {
                    new()
                    {
                        Id = 1,
                        Attributes = new Dictionary<string, object?> { { "Item", longString } }
                    }
                }
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().NotBeNull();
            error.Should().Contain("exceeds maximum length of 1000 characters");
        }

        [Fact]
        public void Validate_ShouldRejectDuplicateColumnNames()
        {
            var payload = new ExportPayload
            {
                Attributes = new List<ProductAttribute>
                {
                    new() { Name = "Item", Type = AttributeType.String },
                    new() { Name = "item", Type = AttributeType.String }
                },
                Products = new List<DynamicProduct>()
            };

            var error = PayloadValidator.Validate(payload);
            error.Should().NotBeNull();
            error.Should().Contain("Duplicate attribute name");
        }
    }
}
