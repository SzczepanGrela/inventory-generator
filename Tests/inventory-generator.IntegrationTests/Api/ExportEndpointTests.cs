using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
using InventoryGenerator.Api.Models;

namespace InventoryGenerator.IntegrationTests.Api
{
    public class ExportEndpointTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly WebApplicationFactory<Program> _factory;

        public ExportEndpointTests(WebApplicationFactory<Program> factory)
        {
            _factory = factory;
        }

        [Fact]
        public async Task PostExportHtml_ShouldReturnFile_WhenPayloadIsValid()
        {
            // Arrange
            var client = _factory.CreateClient();
            var payload = new ExportPayload
            {
                Attributes = new List<ProductAttribute>
                {
                    new ProductAttribute { Name = "Product Name", Type = AttributeType.String }
                },
                Products = new List<DynamicProduct>
                {
                    new DynamicProduct
                    {
                        Id = 1,
                        Attributes = new Dictionary<string, object?> { { "Product Name", "Test Product" } }
                    }
                }
            };

            // Act
            var response = await client.PostAsJsonAsync("/api/export/html", payload);

            // Assert
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            response.Content.Headers.ContentType?.MediaType.Should().Be("text/html");
            var content = await response.Content.ReadAsStringAsync();
            content.Should().NotBeNullOrEmpty();
            content.Should().Contain("Test Product");
        }
    }
}
