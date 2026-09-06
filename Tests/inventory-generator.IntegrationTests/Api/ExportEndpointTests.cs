using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
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
        public async Task GetHealth_ShouldReturnStatusAndRevision()
        {
            var client = _factory.CreateClient();

            var response = await client.GetAsync("/api/health");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            document.RootElement.GetProperty("status").GetString().Should().Be("ok");
            document.RootElement.GetProperty("revision").GetString().Should().NotBeNullOrWhiteSpace();
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

        [Fact]
        public async Task PostExport_ShouldRateLimitEachCloudflareClientIndependently()
        {
            var firstClient = _factory.CreateClient();
            firstClient.DefaultRequestHeaders.Add("CF-Connecting-IP", "198.51.100.10");
            var payload = CreatePayload();

            for (var request = 0; request < 30; request++)
            {
                using var response = await firstClient.PostAsJsonAsync("/api/export/html", payload);
                response.StatusCode.Should().Be(HttpStatusCode.OK);
            }

            using var limitedResponse = await firstClient.PostAsJsonAsync("/api/export/html", payload);
            limitedResponse.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);

            var secondClient = _factory.CreateClient();
            secondClient.DefaultRequestHeaders.Add("CF-Connecting-IP", "198.51.100.11");
            using var independentResponse = await secondClient.PostAsJsonAsync("/api/export/html", payload);
            independentResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        private static ExportPayload CreatePayload()
        {
            return new ExportPayload
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
        }
    }
}
